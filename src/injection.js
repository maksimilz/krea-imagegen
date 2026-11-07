import { getContext } from "../../../../extensions.js";
import { EXTENSION_NAME } from "./data.js";
import { buildKrea1PassInstruction, buildKreaReminder, KREA_DIRECTIVE_MARKER } from "./kreaPrompts.js";
import { getSettings } from "./utils.js";
import { expandAppearanceTags } from "./appearance.js";
import { ensureAtlas } from "./styleLibrary.js";

// ── 1. 1-Pass Prompt Injection ───────────────────────────────────────────────
// Injects Krea-2 rules directly into the character context before sending.
// The LLM writes its normal story and immediately outputs <img prompt="..." width="..." height="...">
// NO SECOND LLM GENERATION IS PERFORMED!

// Rendered images, spinners and failed placeholders as they are stored in chat messages.
const KREA_BLOCK_REGEX = /<!-- krea-inline-start:[^>]+ -->[\s\S]*?<!-- krea-inline-end:[^>]+ -->|<div\b[^>]*?class=["'][^"']*krea-img-(?:wrapper|placeholder)[^"']*["'][\s\S]*?<\/div>/gi;
// Only our own image reminders, current "[Illustrations — …]" and the older "[System Note: Illustrations — …]";
// any other [System Note: …] from the preset or lorebooks stays intact.
const REMINDER_REGEX = /\n*\[(?:System Note:\s*)?Illustrations\b[^\]]*?(?:<img|image tag)[^\]]*\]/gi;

function unescapeAttr(str) {
    return str
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

// Turns a stored image block back into the compact tag the model originally wrote.
function blockToTag(block) {
    const promptMatch = block.match(/data-(?:rawprompt|krea-prompt)="([^"]*)"/i);
    if (!promptMatch) return "";
    // Old prompts may hold {Name} tags from saved looks: show the model the full text, not the tag.
    const prompt = expandAppearanceTags(unescapeAttr(promptMatch[1])).replace(/"/g, "'").replace(/\s+/g, " ").trim();
    if (!prompt) return "";
    const w = block.match(/data-(?:width|krea-w)="(\d+)"/i)?.[1];
    const h = block.match(/data-(?:height|krea-h)="(\d+)"/i)?.[1];
    return `<img prompt="${prompt}"${w && h ? ` width="${w}" height="${h}"` : ""}>`;
}

/**
 * Removes all image HTML from the outgoing history and returns the newest `keep` prompts
 * as <img prompt> tags (oldest first). The history is stripped the same way on every turn,
 * so it stays byte-identical and the provider's prompt cache survives; the recent prompts
 * travel inside the directive instead, which is rebuilt every turn anyway.
 */
function stripImageHistory(messages, keep) {
    const recent = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (typeof msg.content !== "string") continue;
        let text = msg.content.replace(REMINDER_REGEX, "");
        const blocks = text.match(KREA_BLOCK_REGEX) || [];
        if (blocks.length) {
            // Right-to-left so the latest images in the latest message win the budget.
            for (let j = blocks.length - 1; j >= 0 && recent.length < keep; j--) {
                const tag = blockToTag(blocks[j]);
                if (tag && !recent.includes(tag)) recent.push(tag);
            }
            text = text.replace(KREA_BLOCK_REGEX, "").replace(/\n{3,}/g, "\n\n");
        }
        msg.content = text.trim();
    }
    return recent.reverse();
}

// Insert point for the directive: just before the last user message (depth 1, like an Author's Note),
// so the preset's own post-history block keeps the final word.
function findDirectiveIndex(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return i;
    }
    let idx = messages.length;
    while (idx > 0 && messages[idx - 1].role === "assistant") idx--;
    return idx;
}

// CHAT_COMPLETION_PROMPT_READY doesn't say what is being generated, so the type comes from GENERATION_STARTED.
let generationType = "normal";
const NO_IMAGE_TYPES = new Set(["quiet", "impersonate"]); // summaries, other extensions, user's own lines

export function trackGenerationType(type, _params, dryRun) {
    if (!dryRun) generationType = type || "normal";
}

export async function handlePromptInjection(data) {
    const s = getSettings();
    if (!s.enabled) return;
    if (data?.dryRun) return;
    if (NO_IMAGE_TYPES.has(generationType)) return;

    const messages = data?.chat || data?.messages || (Array.isArray(data) ? data : null);
    if (!messages || !Array.isArray(messages) || messages.length === 0) return;
    if (messages.some(m => typeof m.content === "string" && m.content.includes(KREA_DIRECTIVE_MARKER))) return;

    let wantImages = s.triggerMode !== "manual";
    if (wantImages && s.triggerMode === "frequency") {
        const chat = getContext().chat || [];
        const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length;
        const freq = Math.max(1, parseInt(s.autoGenFreq) || 3);
        // A swipe/continue rewrites the last reply instead of adding one, so it keeps that reply's turn number.
        const replacesLast = generationType === "swipe" || generationType === "continue";
        wantImages = (aiMsgCount + (replacesLast ? 0 : 1)) % freq === 0;
    }

    // Images are always stripped from the history; on turns without images the model
    // doesn't see past prompts at all — otherwise it copies them on its own.
    const keep = wantImages ? Math.max(0, parseInt(s.historyPrompts ?? 2) || 0) : 0;
    const recentTags = stripImageHistory(messages, keep);
    if (!wantImages) return;

    // The directive names the chosen Atlas style; a short wait so a late ComfyUI doesn't hold up the reply.
    await ensureAtlas(s, 1500);

    messages.splice(findDirectiveIndex(messages), 0, {
        role: "system",
        content: buildKrea1PassInstruction(s, recentTags),
    });

    // Recency boost: a one-line count reminder at the very end, never inside an assistant prefill.
    const reminder = buildKreaReminder(s);
    const last = messages[messages.length - 1];
    if (last.role !== "assistant" && typeof last.content === "string") {
        last.content += `\n\n${reminder}`;
    } else {
        let idx = messages.length;
        while (idx > 0 && messages[idx - 1].role === "assistant") idx--;
        messages.splice(idx, 0, { role: "system", content: reminder });
    }

    const maxImages = Math.max(1, parseInt(s.imageCount) || 1);
    console.log(`[${EXTENSION_NAME}] ⚡ 1-Pass Krea-2 directive (${s.autoCount ? "auto, up to " : ""}${maxImages} image${maxImages > 1 ? "s" : ""}, ${recentTags.length} past prompt${recentTags.length === 1 ? "" : "s"} attached) injected into context.`);
}
