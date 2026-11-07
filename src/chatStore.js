import { getContext } from "../../../../extensions.js";
import { saveChat, saveChatConditional, updateMessageBlock } from "../../../../../script.js";
import { escapeHtml, fixKreaImgQuotes } from "./utils.js";

// Repairs Krea <img> tags saved before quotes were escaped; true when the message changed.
export function repairKreaImgQuotes(msg) {
    let changed = false;
    const fix = (text) => {
        const next = fixKreaImgQuotes(text);
        if (next !== text) changed = true;
        return next;
    };
    msg.mes = fix(msg.mes);
    if (typeof msg.extra?.display_text === "string") msg.extra.display_text = fix(msg.extra.display_text);
    if (Array.isArray(msg.swipes)) msg.swipes = msg.swipes.map(fix);
    return changed;
}

export function cleanOrphanedStopButtons(chat = null) {
    const list = chat || getContext().chat || [];
    const stopBtnRegex = /<button\b[^>]*?class=["'][^"']*krea-ph-stop-btn[^"']*["'][\s\S]*?<\/button>/gi;
    const genericStopBtnRegex = /<button\b[^>]*title=["']Stop generation[^"']*["'][\s\S]*?<\/button>/gi;
    const loneStopBtnRegex = /<button[^>]*>\s*(?:<i[^>]*><\/i>\s*)?Stop\s*<\/button>/gi;
    let modified = false;

    for (let i = 0; i < list.length; i++) {
        const msg = list[i];
        // Only messages with Krea blocks: a card's own "Stop" button (players, HTML widgets) must survive.
        if (typeof msg.mes === "string" && /krea/i.test(msg.mes) && (stopBtnRegex.test(msg.mes) || genericStopBtnRegex.test(msg.mes) || loneStopBtnRegex.test(msg.mes))) {
            msg.mes = msg.mes.replace(stopBtnRegex, "").replace(genericStopBtnRegex, "").replace(loneStopBtnRegex, "").trim();
            if (msg.extra && typeof msg.extra.display_text === "string") {
                msg.extra.display_text = msg.extra.display_text.replace(stopBtnRegex, "").replace(genericStopBtnRegex, "").replace(loneStopBtnRegex, "").trim();
            }
            if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") {
                msg.swipes[msg.swipe_id] = msg.mes;
            }
            modified = true;
            if (typeof updateMessageBlock === "function") {
                updateMessageBlock(i, msg);
            }
        }
    }

    if (modified) {
        if (typeof saveChatConditional === "function") saveChatConditional();
        else saveChat();
    }
}

// ── Prompt persistence: keeps the prompt alive across failures / reloads ──────

export function rememberPrompt(msg, placeholderId, spec) {
    if (!msg || !placeholderId || !spec?.prompt) return;
    if (!msg.extra) msg.extra = {};
    if (!msg.extra.krea_prompts) msg.extra.krea_prompts = {};
    msg.extra.krea_prompts[placeholderId] = {
        prompt: spec.prompt,
        width: spec.width || null,
        height: spec.height || null,
        style: spec.style ?? ""
    };
}

export function getRememberedPrompt(msg, placeholderId, el = null) {
    const saved = msg?.extra?.krea_prompts?.[placeholderId];
    if (saved?.prompt) return saved;
    // Fallback: attributes baked into the failed placeholder itself
    const prompt = el?.getAttribute?.("data-krea-prompt");
    if (prompt) {
        return {
            prompt,
            width: parseInt(el.getAttribute("data-krea-w")) || null,
            height: parseInt(el.getAttribute("data-krea-h")) || null,
            style: ""
        };
    }
    return null;
}

export function buildFailedTag(placeholderId, msg, errorMsg) {
    const spec = msg?.extra?.krea_prompts?.[placeholderId];
    const oneLine = String(spec?.prompt || "").replace(/\s+/g, " ").trim();
    const attrs = oneLine
        ? ` data-krea-failed="1" data-krea-w="${spec.width || ""}" data-krea-h="${spec.height || ""}" data-krea-prompt="${escapeHtml(oneLine)}"`
        : ` data-krea-failed="1"`;
    const details = oneLine
        ? `<details class="krea-failed-prompt"><summary>Промт сохранён</summary>${escapeHtml(oneLine)}</details>`
        : "";
    return `<div id="${placeholderId}" class="krea-img-placeholder krea-failed"${attrs} style="color:#ef4444; border-color:rgba(239,68,68,0.4);"><i class="fa-solid fa-triangle-exclamation"></i> [Krea-2: ошибка рендера — ${escapeHtml(errorMsg)}]${details}</div>`;
}

export function placeholderRegex(placeholderId) {
    return new RegExp(`<div id="${placeholderId}"[\\s\\S]*?<\\/div>(?:\\s*<button[^>]*>.*?<\\/button>)?`, "gi");
}

// Turns spinners left behind by a reload / crash into retryable failed placeholders.
const STALE_SPINNER_REGEX = /<div id="(krea-img-[\w-]+)" class="krea-img-placeholder"[^>]*><i class="fa-solid fa-spinner fa-spin"><\/i> \[(?:Rendering|Generating|Рендер|Генерация)[\s\S]*?<\/div>/g;

export async function recoverStalePlaceholders() {
    const chat = getContext().chat || [];
    let modified = false;
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (typeof msg?.mes !== "string" || !msg.mes.includes("fa-spinner")) continue;
        const swap = (str) => str.replace(STALE_SPINNER_REGEX, (_all, id) => buildFailedTag(id, msg, "прервано"));
        const next = swap(msg.mes);
        if (next === msg.mes) continue;
        msg.mes = next;
        if (msg.extra && typeof msg.extra.display_text === "string") {
            msg.extra.display_text = swap(msg.extra.display_text);
        }
        if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") {
            msg.swipes[msg.swipe_id] = msg.mes;
        }
        modified = true;
        if (typeof updateMessageBlock === "function") updateMessageBlock(i, msg);
    }
    if (modified) {
        await (typeof saveChatConditional === "function" ? saveChatConditional() : saveChat());
        console.log("[Krea-ImageGen] Recovered interrupted renders as retryable placeholders.");
    }
}

export async function removePlaceholderFromChat(placeholderId) {
    const chat = getContext().chat || [];
    const phRegex = new RegExp(`[\\n\\s]*<div id="${placeholderId}"[\\s\\S]*?<\\/div>(?:\\s*<button[^>]*>.*?<\\/button>)*[\\n\\s]*`, "gi");

    let modified = false;
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (msg.mes && msg.mes.includes(placeholderId)) {
            msg.mes = msg.mes.replace(phRegex, "\n\n").trim();
            if (msg.extra && typeof msg.extra.display_text === "string") {
                msg.extra.display_text = msg.extra.display_text.replace(phRegex, "\n\n").trim();
            }
            if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") {
                msg.swipes[msg.swipe_id] = msg.mes;
            }
            modified = true;
            if (typeof updateMessageBlock === "function") {
                updateMessageBlock(i, msg);
            }
            break;
        }
    }

    try {
        $(`#${placeholderId}`).remove();
    } catch (e) {}

    if (modified) {
        await (typeof saveChatConditional === "function" ? saveChatConditional() : saveChat());
    }
}

/**
 * Edits one message of a chat that is no longer open: reads its file, applies `mutate` to the message
 * holding `placeholderId` and writes the file back. Never writes from memory — ST refills its global
 * `chat` array in place on a chat switch, so an in-memory copy may already hold another chat.
 */
export async function patchInactiveChat(snap, placeholderId, mutate) {
    try {
        if (!snap?.chatId || (!snap.groupId && !snap.charAvatar)) return false;
        const context = getContext();
        const headers = context.getRequestHeaders();
        const target = snap.groupId
            ? { get: "/api/chats/group/get", save: "/api/chats/group/save", body: { id: snap.chatId } }
            : { get: "/api/chats/get", save: "/api/chats/save", body: { ch_name: snap.charName, file_name: snap.chatId, avatar_url: snap.charAvatar } };

        const res = await fetch(target.get, { method: "POST", cache: "no-cache", headers, body: JSON.stringify(target.body) });
        if (!res.ok) return false;
        const data = await res.json();
        if (!Array.isArray(data) || data.length < 2) return false;

        // data[0] is the chat header
        const msg = data.slice(1).reverse().find(m => typeof m?.mes === "string" && m.mes.includes(placeholderId));
        if (!msg) return false;
        mutate(msg);

        const save = await fetch(target.save, {
            method: "POST",
            cache: "no-cache",
            headers,
            body: JSON.stringify({ ...target.body, chat: data, force: true }),
        });
        return save.ok;
    } catch (err) {
        console.warn("[Krea-ImageGen] Failed to update background chat:", err);
        return false;
    }
}
