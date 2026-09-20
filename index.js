/* ────────────────────────────────────────────────────────────────────────────
   Krea ImageGen (ComfyUI) — Main Extension Controller
   Single-Pass (In-Context) Image Generation with Krea-2 Architecture
   ──────────────────────────────────────────────────────────────────────────── */

import { extension_settings, getContext } from "../../../extensions.js";
import {
    saveSettingsDebounced,
    event_types,
    eventSource,
    saveChat,
    saveChatConditional,
    reloadCurrentChat,
    updateMessageBlock
} from "../../../../script.js";
import { Popup, POPUP_TYPE } from "../../../popup.js";

import {
    EXTENSION_NAME,
    EXTENSION_FOLDER,
    DEFAULT_SETTINGS,
    KREA_RESOLUTIONS
} from "./src/data.js";

import { buildKrea1PassInstruction } from "./src/kreaPrompts.js";
import {
    testComfyConnection,
    fetchComfyObjectInfo,
    fetchAvailableWorkflows,
    executeComfyWorkflow
} from "./src/comfy.js";

import {
    showKreaProgress,
    hideKreaProgress,
    addKreaRetryButtons,
    kreaRetrySweep
} from "./src/chatUi.js";

function getSettings() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    return extension_settings[EXTENSION_NAME];
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function decodeHtml(str) {
    if (!str) return "";
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
}

// ── 1. 1-Pass Prompt Injection ───────────────────────────────────────────────
// Injects Krea-2 rules directly into the character context before sending.
// The LLM writes its normal story and immediately outputs <img prompt="..." width="..." height="...">
// NO SECOND LLM GENERATION IS PERFORMED!

function handlePromptInjection(data) {
    const s = getSettings();
    if (!s.enabled || s.triggerMode === "manual") return;
    if (data?.dryRun) return;

    const messages = data?.chat || data?.messages || (Array.isArray(data) ? data : null);
    if (!messages || !Array.isArray(messages) || messages.length === 0) return;

    // Clean any previously injected inline HTML or fake image tags from LLM context
    // so the LLM doesn't hallucinate raw <div> and <img src="/user/images/..."> markup!
    const inlineHtmlRegex = /<!-- krea-inline-start:[^>]+ -->[\s\S]*?<!-- krea-inline-end:[^>]+ -->/gi;
    const rawWrapperRegex = /<div\b[^>]*?class=["'][^"']*krea-img-wrapper[^"']*["'][\s\S]*?<\/div>/gi;
    for (const msg of messages) {
        if (typeof msg.content === "string") {
            msg.content = msg.content.replace(inlineHtmlRegex, "").replace(rawWrapperRegex, "").trim();
        }
    }

    // Check frequency mode
    if (s.triggerMode === "frequency") {
        const chat = getContext().chat || [];
        const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length;
        const freq = Math.max(1, parseInt(s.autoGenFreq) || 3);
        if ((aiMsgCount + 1) % freq !== 0) {
            return; // Not this turn
        }
    }

    const instruction = buildKrea1PassInstruction(s);

    // Inject into the system prompt or append as system directive
    let injected = false;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "system") {
            if (typeof messages[i].content === "string") {
                if (!messages[i].content.includes("### KREA-2 IMAGE GENERATION DIRECTIVE")) {
                    messages[i].content += `\n\n${instruction}`;
                }
                injected = true;
                break;
            }
        }
    }

    if (!injected) {
        messages.unshift({
            role: "system",
            content: instruction
        });
    }

    console.log(`[${EXTENSION_NAME}] ⚡ 1-Pass Krea-2 directive injected into character context.`);
}

// ── 2. Tag Extraction & ComfyUI Execution ────────────────────────────────────

function isInsideTag(text, index, tagName) {
    const openTag = `<${tagName}`;
    const closeTag = `</${tagName}>`;
    const lastOpen = text.lastIndexOf(openTag, index);
    if (lastOpen === -1) return false;
    const lastClose = text.lastIndexOf(closeTag, index);
    return lastOpen > lastClose;
}

function extractKreaTags(rawText) {
    if (!rawText || typeof rawText !== "string") return [];

    const found = [];

    const detectAspectFromPrompt = (promptText) => {
        if (!promptText) return null;
        const lower = promptText.toLowerCase();
        if (/\b(?:16:9|landscape|wide shot|cinematic vista|expansive|panorama|panoramic)\b/i.test(lower)) {
            return { width: 1344, height: 768 };
        }
        if (/\b(?:21:9|ultrawide)\b/i.test(lower)) {
            return { width: 1536, height: 640 };
        }
        if (/\b(?:9:16|full-body|full body|standing full length|vertical scale|entire body)\b/i.test(lower)) {
            return { width: 768, height: 1344 };
        }
        if (/\b(?:3:4|2:3|portrait|bust shot|head and shoulders|upper-body|upper body)\b/i.test(lower)) {
            return { width: 896, height: 1152 };
        }
        if (/\b(?:1:1|square|close-up|close up|macro face|face focus)\b/i.test(lower)) {
            return { width: 1024, height: 1024 };
        }
        if (/\b(?:4:3|3:2|medium shot)\b/i.test(lower)) {
            return { width: 1152, height: 896 };
        }
        return null;
    };

    const parseDims = (str, promptText = "") => {
        let width = null, height = null;
        const wMatch = str.match(/\bwidth=["']?(\d+)["']?/i);
        const hMatch = str.match(/\bheight=["']?(\d+)["']?/i);
        if (wMatch) width = parseInt(wMatch[1]);
        if (hMatch) height = parseInt(hMatch[1]);

        if (!width || !height) {
            const resMatch = str.match(/\b(?:res|resolution)=["']?(\d+)[xX×](\d+)["']?/i);
            if (resMatch) {
                width = parseInt(resMatch[1]);
                height = parseInt(resMatch[2]);
            }
        }

        if (!width || !height) {
            const aspectMatch = str.match(/\b(?:aspect|aspect_ratio)=["']?(\d+:\d+)["']?/i);
            if (aspectMatch) {
                const asp = aspectMatch[1];
                if (asp === "16:9") { width = 1344; height = 768; }
                else if (asp === "9:16") { width = 768; height = 1344; }
                else if (asp === "1:1") { width = 1024; height = 1024; }
                else if (asp === "3:4" || asp === "2:3") { width = 896; height = 1152; }
                else if (asp === "4:3" || asp === "3:2") { width = 1152; height = 896; }
                else if (asp === "21:9") { width = 1536; height = 640; }
            }
        }

        // Auto-detect resolution from scene keywords if not explicitly specified in tag
        if ((!width || !height) && promptText) {
            const detected = detectAspectFromPrompt(promptText);
            if (detected) {
                width = detected.width;
                height = detected.height;
            }
        }

        return { width, height };
    };

    // 1. Standard HTML <img> tags: <img ... prompt="..." ...>
    const imgHtmlRegex = /<img\b(?=[^>]*?\bprompt=(["'])([\s\S]*?)\1)[^>]*?>/gi;
    for (const m of rawText.matchAll(imgHtmlRegex)) {
        const fullTag = m[0];
        const index = m.index;
        // Ignore thoughts (<think> or <thought>)
        if (isInsideTag(rawText, index, "think") || isInsideTag(rawText, index, "thought")) {
            continue;
        }
        // Only ignore our own ALREADY RENDERED images
        if (fullTag.includes('alt="KreaInline"') || fullTag.includes("data-kreaid")) {
            continue;
        }
        const promptMatch = fullTag.match(/\bprompt=(["'])([\s\S]*?)\1/i);
        let prompt = (promptMatch ? promptMatch[2] : "").trim().replace(/^["']|["']$/g, "").trim();
        if (prompt) {
            const { width, height } = parseDims(fullTag, prompt);
            found.push({ index, length: fullTag.length, prompt, width, height, raw: fullTag });
        }
    }

    // 2. Fallback: [IMAGE: prompt] or [IMAGE: "prompt"] or [pic: prompt]
    const bracketRegex = /\[(?:IMAGE|pic|img)\b[:\s]+(?:prompt=)?(?:["']?)([\s\S]*?)(?:["']?)\s*\]/gi;
    for (const m of rawText.matchAll(bracketRegex)) {
        const fullTag = m[0];
        const index = m.index;
        // Ignore thoughts (<think> or <thought>)
        if (isInsideTag(rawText, index, "think") || isInsideTag(rawText, index, "thought")) {
            continue;
        }
        let prompt = (m[1] || "").trim().replace(/^["']|["']$/g, "").trim();
        if (prompt && !found.some(f => f.index === index)) {
            const { width, height } = parseDims(fullTag, prompt);
            found.push({ index, length: fullTag.length, prompt, width, height, raw: fullTag });
        }
    }

    found.sort((a, b) => a.index - b.index);

    // Filter overlaps
    const cleanMatches = [];
    let lastEnd = -1;
    for (const item of found) {
        if (item.index >= lastEnd) {
            cleanMatches.push(item);
            lastEnd = item.index + item.length;
        }
    }

    return cleanMatches;
}

let isProcessingIncoming = false;

async function handleIncomingMessage(messageId) {
    if (isProcessingIncoming) return;
    const s = getSettings();
    if (!s.enabled) return;

    const chat = getContext().chat;
    if (!chat || !chat.length) return;

    const msgIndex = (typeof messageId === "number" && messageId >= 0 && messageId < chat.length)
        ? messageId
        : chat.length - 1;
    const lastMsg = chat[msgIndex];
    if (!lastMsg || lastMsg.is_user || lastMsg.is_system) return;

    const matches = extractKreaTags(lastMsg.mes);
    if (!matches || matches.length === 0) return;

    isProcessingIncoming = true;
    try {

    const maxImages = Math.max(1, parseInt(s.imageCount) || 1);
    const activeMatches = matches.slice(0, maxImages);
    const batchId = Date.now();

    let modifiedMes = lastMsg.mes;

    // Replace tags from right to left so indices remain stable
    for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        if (i < maxImages) {
            const placeholderId = `krea-img-${batchId}-${i}`;
            const placeholder = `<div id="${placeholderId}" class="krea-img-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> [Rendering Krea-2 Scene...]</div>`;
            modifiedMes = modifiedMes.substring(0, m.index) + placeholder + modifiedMes.substring(m.index + m.length);
        } else {
            // Cut surplus tags exceeding limit
            modifiedMes = modifiedMes.substring(0, m.index) + modifiedMes.substring(m.index + m.length);
        }
    }

    lastMsg.mes = modifiedMes.trim();
    if (lastMsg.extra && typeof lastMsg.extra.display_text === "string") {
        lastMsg.extra.display_text = modifiedMes.trim();
    }
    if (Array.isArray(lastMsg.swipes) && typeof lastMsg.swipe_id === "number") {
        lastMsg.swipes[lastMsg.swipe_id] = modifiedMes.trim();
    }
    await (typeof saveChatConditional === "function" ? saveChatConditional() : saveChat());

    if (typeof updateMessageBlock === "function") {
        updateMessageBlock(msgIndex, lastMsg);
    } else {
        reloadCurrentChat();
    }

    // Sequentially process each active match with ComfyUI
    for (let idx = 0; idx < activeMatches.length; idx++) {
        const item = activeMatches[idx];
        const placeholderId = `krea-img-${batchId}-${idx}`;
        let promptText = item.prompt;

        // Preview prompt popup if requested
        if (s.previewPrompt) {
            const $content = $(`
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <div style="font-size:0.85rem; color:var(--text-muted);">Inspect or edit the Krea-2 prompt:</div>
                    <textarea class="text_pole krea-preview-area" style="height:140px; resize:vertical; font-family:monospace; font-size:0.85rem;">${promptText}</textarea>
                </div>
            `);
            let liveText = promptText;
            $content.find(".krea-preview-area").on("input", function() { liveText = $(this).val(); });

            const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Preview Krea-2 Prompt", { okButton: "Render in ComfyUI", cancelButton: "Skip", wide: true });
            const confirmed = await popup.show();
            if (!confirmed) {
                // Cancel placeholder
                if (lastMsg.mes.includes(placeholderId)) {
                    const specificRegex = new RegExp(`<div id="${placeholderId}"[\\s\\S]*?<\\/div>`, "g");
                    lastMsg.mes = lastMsg.mes.replace(specificRegex, "");
                    if (lastMsg.extra && typeof lastMsg.extra.display_text === "string") {
                        lastMsg.extra.display_text = lastMsg.extra.display_text.replace(specificRegex, "");
                    }
                    if (Array.isArray(lastMsg.swipes) && typeof lastMsg.swipe_id === "number") {
                        lastMsg.swipes[lastMsg.swipe_id] = lastMsg.mes;
                    }
                    try {
                        const $ph = $(`#${placeholderId}`);
                        if ($ph.length) $ph.remove();
                    } catch (domErr) {}
                    await (typeof saveChatConditional === "function" ? saveChatConditional() : saveChat());
                    updateMessageBlock(msgIndex, lastMsg);
                }
                continue;
            }
            promptText = liveText.trim();
        }

        showKreaProgress(`[${idx + 1}/${activeMatches.length}] Preparing Krea-2...`);

        try {
            const dims = (item.width && item.height) ? { width: item.width, height: item.height } : null;
            const result = await executeComfyWorkflow({
                promptText,
                dimensions: dims,
                settings: s,
                onProgress: (lbl, pct) => showKreaProgress(`[${idx + 1}/${activeMatches.length}] ${lbl}`, pct)
            });

            // Re-fetch message in case it shifted
            const curMsg = getContext().chat[msgIndex] || lastMsg;
            if (!curMsg.extra) curMsg.extra = {};
            if (!curMsg.extra.krea_history) curMsg.extra.krea_history = {};

            let historyArray = curMsg.extra.krea_history[placeholderId];
            if (!Array.isArray(historyArray)) historyArray = [];
            if (!historyArray.includes(result.savedPath)) {
                historyArray.push(result.savedPath);
            }
            curMsg.extra.krea_history[placeholderId] = historyArray;
            const activeIndex = historyArray.indexOf(result.savedPath);

            const imgTag = `<!-- krea-inline-start:${placeholderId} --><div id="${placeholderId}" class="krea-img-wrapper">
<img src="${result.savedPath}" title="${escapeHtml(result.finalPrompt)}" alt="KreaInline" data-kreaid="${placeholderId}" data-width="${result.width}" data-height="${result.height}" data-active-index="${activeIndex}" style="max-width:100%; border-radius:8px; display:block; cursor:zoom-in;" />
</div><!-- krea-inline-end:${placeholderId} -->`;

            const specificRegex = new RegExp(`<div id="${placeholderId}"[\\s\\S]*?<\\/div>`, "g");
            if (curMsg.mes && curMsg.mes.match(specificRegex)) {
                curMsg.mes = curMsg.mes.replace(specificRegex, imgTag);
            } else {
                curMsg.mes += `\n\n${imgTag}`;
            }

            if (curMsg.extra && typeof curMsg.extra.display_text === "string") {
                if (curMsg.extra.display_text.match(specificRegex)) {
                    curMsg.extra.display_text = curMsg.extra.display_text.replace(specificRegex, imgTag);
                } else {
                    curMsg.extra.display_text = curMsg.mes;
                }
            }
            if (Array.isArray(curMsg.swipes) && typeof curMsg.swipe_id === "number") {
                curMsg.swipes[curMsg.swipe_id] = curMsg.mes;
            }

            // Direct DOM replacement so user immediately sees the image even if updateMessageBlock caches or delays
            try {
                const $ph = $(`#${placeholderId}`);
                if ($ph.length) {
                    $ph.replaceWith(imgTag);
                }
            } catch (domErr) {
                console.warn("[Krea-ImageGen] DOM replace error:", domErr);
            }

            await (typeof saveChatConditional === "function" ? saveChatConditional() : saveChat());
            if (typeof updateMessageBlock === "function") {
                updateMessageBlock(msgIndex, curMsg);
            } else {
                reloadCurrentChat();
            }

            kreaRetrySweep(msgIndex, s, handleRegenerate);
            toastr.success("Krea-2 image rendered!");
        } catch (e) {
            console.error("[Krea-ImageGen] Render failed:", e);
            toastr.error(`Krea Error: ${e.message}`);
            hideKreaProgress();

            const curMsg = getContext().chat[msgIndex] || lastMsg;
            const failTag = `<div id="${placeholderId}" class="krea-img-placeholder" style="color:#ef4444; border-color:rgba(239,68,68,0.4);"><i class="fa-solid fa-triangle-exclamation"></i> [Krea-2 Render Failed: ${escapeHtml(e.message)}]</div>`;
            const specificRegex = new RegExp(`<div id="${placeholderId}"[\\s\\S]*?<\\/div>`, "g");
            if (curMsg.mes && curMsg.mes.match(specificRegex)) {
                curMsg.mes = curMsg.mes.replace(specificRegex, failTag);
            }
            if (curMsg.extra && typeof curMsg.extra.display_text === "string") {
                curMsg.extra.display_text = curMsg.extra.display_text.replace(specificRegex, failTag);
            }
            if (Array.isArray(curMsg.swipes) && typeof curMsg.swipe_id === "number") {
                curMsg.swipes[curMsg.swipe_id] = curMsg.mes;
            }
            try {
                const $ph = $(`#${placeholderId}`);
                if ($ph.length) $ph.replaceWith(failTag);
            } catch (domErr) {}
            await (typeof saveChatConditional === "function" ? saveChatConditional() : saveChat());
            if (typeof updateMessageBlock === "function") {
                updateMessageBlock(msgIndex, curMsg);
            }
        } finally {
            hideKreaProgress();
        }
    }
    } finally {
        isProcessingIncoming = false;
    }
}

// ── 3. Direct Regeneration (↻) — NO LLM CALL! ─────────────────────────────────

async function handleRegenerate({ message, msgIndex, placeholderId, prompt, width, height }) {
    const s = getSettings();
    showKreaProgress("Regenerating Krea-2 variant in ComfyUI...");

    try {
        const result = await executeComfyWorkflow({
            promptText: prompt,
            dimensions: { width, height },
            settings: s,
            onProgress: (lbl, pct) => showKreaProgress(lbl, pct)
        });

        if (!message.extra) message.extra = {};
        if (!message.extra.krea_history) message.extra.krea_history = {};

        let historyArray = message.extra.krea_history[placeholderId];
        if (!Array.isArray(historyArray)) historyArray = [];
        if (!historyArray.includes(result.savedPath)) {
            historyArray.push(result.savedPath);
        }
        message.extra.krea_history[placeholderId] = historyArray;
        const activeIndex = historyArray.indexOf(result.savedPath);

        const imgTag = `<!-- krea-inline-start:${placeholderId} --><div id="${placeholderId}" class="krea-img-wrapper">
<img src="${result.savedPath}" title="${escapeHtml(result.finalPrompt)}" alt="KreaInline" data-kreaid="${placeholderId}" data-width="${result.width}" data-height="${result.height}" data-active-index="${activeIndex}" style="max-width:100%; border-radius:8px; display:block; cursor:zoom-in;" />
</div><!-- krea-inline-end:${placeholderId} -->`;

        const specificRegex = new RegExp(`<div id="${placeholderId}"[\\s\\S]*?<\\/div>`, "g");
        if (message.mes && message.mes.match(specificRegex)) {
            message.mes = message.mes.replace(specificRegex, imgTag);
        } else {
            message.mes += `\n\n${imgTag}`;
        }

        if (message.extra && typeof message.extra.display_text === "string") {
            if (message.extra.display_text.match(specificRegex)) {
                message.extra.display_text = message.extra.display_text.replace(specificRegex, imgTag);
            } else {
                message.extra.display_text = message.mes;
            }
        }
        if (Array.isArray(message.swipes) && typeof message.swipe_id === "number") {
            message.swipes[message.swipe_id] = message.mes;
        }

        try {
            const $ph = $(`#${placeholderId}`);
            if ($ph.length) {
                $ph.replaceWith(imgTag);
            }
        } catch (domErr) {}

        await (typeof saveChatConditional === "function" ? saveChatConditional() : saveChat());
        if (typeof updateMessageBlock === "function") {
            updateMessageBlock(msgIndex, message);
        } else {
            reloadCurrentChat();
        }

        kreaRetrySweep(msgIndex, s, handleRegenerate);
        toastr.success(`New Krea-2 variant ready (${historyArray.length} in history)!`);
    } catch (e) {
        toastr.error(`Regeneration failed: ${e.message}`);
    } finally {
        hideKreaProgress();
    }
}

// ── 4. Quick Gen Button (🪄) near input bar ───────────────────────────────────

function mountQuickGenButton() {
    if (document.getElementById("krea_quick_btn")) return;
    const sendBtn = document.getElementById("send_button");
    if (!sendBtn || !sendBtn.parentNode) return;

    const quickBtn = document.createElement("div");
    quickBtn.id = "krea_quick_btn";
    quickBtn.className = "krea-quick-btn";
    quickBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
    quickBtn.title = "Krea-2: Generate image for current scene (Manual trigger)";
    quickBtn.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        margin: 0 4px;
        border-radius: 8px;
        background: rgba(6, 182, 212, 0.15);
        border: 1px solid rgba(6, 182, 212, 0.35);
        color: #06b6d4;
        cursor: pointer;
        transition: all 0.15s ease;
        font-size: 14px;
    `;
    quickBtn.onmouseenter = () => { quickBtn.style.background = "rgba(6, 182, 212, 0.3)"; };
    quickBtn.onmouseleave = () => { quickBtn.style.background = "rgba(6, 182, 212, 0.15)"; };

    quickBtn.onclick = async () => {
        const s = getSettings();
        const chat = getContext().chat;
        if (!chat || !chat.length) return toastr.warning("Chat is empty.");

        toastr.info("Krea-2 Quick Gen: Triggering scene visualization...");
        const lastMsg = chat[chat.length - 1];
        if (lastMsg) {
            // Append directive tag so handleIncomingMessage picks it up, or directly execute
            const defaultPrompt = s.promptExtra || "A cinematic scene capturing the character's emotional atmosphere";
            const w = parseInt(s.imgWidth) || 1344;
            const h = parseInt(s.imgHeight) || 768;
            lastMsg.mes += `\n\n<img prompt="${defaultPrompt}" width="${w}" height="${h}">`;
            await handleIncomingMessage();
        }
    };

    sendBtn.parentNode.insertBefore(quickBtn, sendBtn);
}

// ── 5. Settings Panel UI Mounting & Binding ──────────────────────────────────

async function initSettingsUi() {
    const $container = $("#extensions_settings");
    if (!$container.length) return;

    try {
        const html = await $.get(`/scripts/extensions/${EXTENSION_FOLDER}/settings.html`);
        $container.append(html);

        const s = getSettings();

        // Bind fields
        $("#krea_enabled").prop("checked", s.enabled).on("change", function() {
            s.enabled = $(this).is(":checked");
            saveSettingsDebounced();
            updateBadge();
        });

        $("#krea_url").val(s.comfyUrl).on("change", function() {
            s.comfyUrl = $(this).val().trim();
            saveSettingsDebounced();
        });

        $("#krea_template").val(s.promptTemplate).on("change", function() {
            s.promptTemplate = $(this).val();
            saveSettingsDebounced();
        });

        $("#krea_trigger_mode").val(s.triggerMode).on("change", function() {
            s.triggerMode = $(this).val();
            $("#krea_freq_wrapper").toggle(s.triggerMode === "frequency");
            saveSettingsDebounced();
        });
        $("#krea_freq_wrapper").toggle(s.triggerMode === "frequency");

        $("#krea_auto_freq").val(s.autoGenFreq).on("change", function() {
            s.autoGenFreq = parseInt($(this).val()) || 3;
            saveSettingsDebounced();
        });

        $("#krea_image_count").val(String(s.imageCount)).on("change", function() {
            s.imageCount = parseInt($(this).val()) || 1;
            saveSettingsDebounced();
        });

        $("#krea_inject_mode").val(s.injectMode).on("change", function() {
            s.injectMode = $(this).val();
            saveSettingsDebounced();
        });

        $("#krea_extra").val(s.promptExtra).on("input", function() {
            s.promptExtra = $(this).val();
            saveSettingsDebounced();
        });

        $("#krea_preview").prop("checked", s.previewPrompt).on("change", function() {
            s.previewPrompt = $(this).is(":checked");
            saveSettingsDebounced();
        });

        $("#krea_compress").prop("checked", s.compressImages).on("change", function() {
            s.compressImages = $(this).is(":checked");
            saveSettingsDebounced();
        });

        $("#krea_steps").val(s.steps).on("change", function() {
            s.steps = parseInt($(this).val()) || 20;
            saveSettingsDebounced();
        });

        $("#krea_cfg").val(s.cfg).on("change", function() {
            s.cfg = parseFloat($(this).val()) || 7.0;
            saveSettingsDebounced();
        });

        $("#krea_denoise").val(s.denoise).on("change", function() {
            s.denoise = parseFloat($(this).val()) || 1.0;
            saveSettingsDebounced();
        });

        $("#krea_seed").val(s.customSeed).on("change", function() {
            s.customSeed = parseInt($(this).val()) || -1;
            saveSettingsDebounced();
        });

        $("#krea_seed_dice").on("click", function() {
            s.customSeed = -1;
            $("#krea_seed").val(-1);
            saveSettingsDebounced();
            toastr.info("Seed set to Random (-1).");
        });

        $("#krea_prefix").val(s.promptPrefix).on("input", function() {
            s.promptPrefix = $(this).val();
            saveSettingsDebounced();
        });

        $("#krea_negative").val(s.customNegative).on("input", function() {
            s.customNegative = $(this).val();
            saveSettingsDebounced();
        });

        // Resolutions Preset & Mode
        const $resSelect = $("#krea_res_preset");
        $resSelect.empty();
        $resSelect.append('<option value="auto">✨ Auto (AI chooses optimal resolution per scene)</option>');
        KREA_RESOLUTIONS.forEach(r => {
            $resSelect.append(`<option value="${r.w}x${r.h}">${r.label}</option>`);
        });

        const syncResUi = () => {
            const isAuto = (s.resolutionMode === "auto" || !s.resolutionMode);
            if (isAuto) {
                $resSelect.val("auto");
                $("#krea_w").prop("disabled", true).css("opacity", "0.5").val(s.imgWidth || 1344);
                $("#krea_h").prop("disabled", true).css("opacity", "0.5").val(s.imgHeight || 768);
            } else {
                $resSelect.val(`${s.imgWidth}x${s.imgHeight}`);
                $("#krea_w").prop("disabled", false).css("opacity", "1.0").val(s.imgWidth);
                $("#krea_h").prop("disabled", false).css("opacity", "1.0").val(s.imgHeight);
            }
        };
        syncResUi();

        $resSelect.off("change").on("change", function() {
            const val = $(this).val();
            if (val === "auto") {
                s.resolutionMode = "auto";
                toastr.info("Resolution: Auto (AI selects width & height per scene).");
            } else {
                s.resolutionMode = "fixed";
                const [w, h] = val.split("x").map(Number);
                s.imgWidth = w;
                s.imgHeight = h;
            }
            syncResUi();
            saveSettingsDebounced();
        });

        $("#krea_w").off("change").on("change", function() {
            s.imgWidth = parseInt($(this).val()) || 1344;
            s.resolutionMode = "fixed";
            syncResUi();
            saveSettingsDebounced();
        });
        $("#krea_h").off("change").on("change", function() {
            s.imgHeight = parseInt($(this).val()) || 768;
            s.resolutionMode = "fixed";
            syncResUi();
            saveSettingsDebounced();
        });

        // LoRA Slots Binding
        [1, 2, 3, 4].forEach(i => {
            $(`#krea_lora_${i}`).val(s[`lora${i}`]).on("change", function() {
                const selected = $(this).val();
                s[`lora${i}`] = selected;
                // Auto-fill remembered trigger words
                if (selected && s.savedLoraTriggers?.[selected]) {
                    s[`loraTrigger${i}`] = s.savedLoraTriggers[selected];
                    $(`#krea_lora_trig_${i}`).val(s.savedLoraTriggers[selected]);
                }
                saveSettingsDebounced();
            });

            $(`#krea_lora_trig_${i}`).val(s[`loraTrigger${i}`]).on("input", function() {
                const trig = $(this).val();
                s[`loraTrigger${i}`] = trig;
                const activeLora = s[`lora${i}`];
                if (activeLora) {
                    if (!s.savedLoraTriggers) s.savedLoraTriggers = {};
                    s.savedLoraTriggers[activeLora] = trig;
                }
                saveSettingsDebounced();
            });

            $(`#krea_lorawt_${i}`).val(s[`lorawt${i}`]).on("input", function() {
                const val = parseFloat($(this).val()) || 1.0;
                s[`lorawt${i}`] = val;
                $(`#krea_lorawt_lbl_${i}`).text(val.toFixed(1));
                saveSettingsDebounced();
            });
            $(`#krea_lorawt_lbl_${i}`).text(parseFloat(s[`lorawt${i}`] || 1.0).toFixed(1));
        });

        // Test connection & load dropdowns
        $("#krea_test_btn").on("click", async function() {
            $(this).prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Testing...');
            const ok = await testComfyConnection(s.comfyUrl);
            $(this).prop("disabled", false).html('<i class="fa-solid fa-wifi"></i> Test Connection');
            if (ok) {
                toastr.success("Connected to ComfyUI successfully!");
                await populateComfyDropdowns();
            } else {
                toastr.error("Could not connect to ComfyUI. Check URL and server status.");
            }
            updateBadge(ok);
        });

        $("#krea_refresh_wf").on("click", async function() {
            await populateWorkflows();
            toastr.info("Workflows refreshed.");
        });

        await populateWorkflows();
        await populateComfyDropdowns();
        updateBadge();

    } catch (err) {
        console.error("[Krea-ImageGen] Failed to initialize settings panel:", err);
    }
}

async function populateWorkflows() {
    const s = getSettings();
    const list = await fetchAvailableWorkflows();
    const $sel = $("#krea_workflow");
    $sel.empty();

    if (!list || list.length === 0) {
        $sel.append('<option value="">No workflows found in SillyTavern</option>');
        return;
    }

    list.forEach(name => {
        $sel.append(`<option value="${escapeHtml(name)}" ${s.currentWorkflowName === name ? "selected" : ""}>${escapeHtml(name)}</option>`);
    });

    if (!s.currentWorkflowName && list.length > 0) {
        // Auto-select Krea workflow if available
        const kreaWf = list.find(w => w.toLowerCase().includes("krea")) || list[0];
        s.currentWorkflowName = kreaWf;
        $sel.val(kreaWf);
        saveSettingsDebounced();
    }

    $sel.off("change").on("change", function() {
        s.currentWorkflowName = $(this).val();
        saveSettingsDebounced();
    });
}

async function populateComfyDropdowns() {
    const s = getSettings();
    const info = await fetchComfyObjectInfo(s.comfyUrl);
    if (!info) return;

    // Checkpoints
    const $modelSel = $("#krea_model");
    $modelSel.empty().append('<option value="">Default from workflow</option>');
    (info.models || []).forEach(m => {
        $modelSel.append(`<option value="${escapeHtml(m)}" ${s.selectedModel === m ? "selected" : ""}>${escapeHtml(m)}</option>`);
    });
    $modelSel.off("change").on("change", function() {
        s.selectedModel = $(this).val();
        saveSettingsDebounced();
    });

    // Samplers
    const $samplerSel = $("#krea_sampler");
    $samplerSel.empty();
    (info.samplers || []).forEach(sm => {
        $samplerSel.append(`<option value="${escapeHtml(sm)}" ${s.selectedSampler === sm ? "selected" : ""}>${escapeHtml(sm)}</option>`);
    });
    $samplerSel.off("change").on("change", function() {
        s.selectedSampler = $(this).val();
        saveSettingsDebounced();
    });

    // LoRAs
    [1, 2, 3, 4].forEach(i => {
        const $loraSel = $(`#krea_lora_${i}`);
        $loraSel.empty().append('<option value="">None</option>');
        (info.loras || []).forEach(l => {
            $loraSel.append(`<option value="${escapeHtml(l)}" ${s[`lora${i}`] === l ? "selected" : ""}>${escapeHtml(l)}</option>`);
        });
    });
}

function updateBadge(connected = null) {
    const s = getSettings();
    const $badge = $("#krea_status_badge");
    if (!s.enabled) {
        $badge.css({ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)", borderColor: "var(--border-color)" })
              .html('<i class="fa-solid fa-circle-xmark"></i> Disabled');
    } else {
        $badge.css({ background: "rgba(16,185,129,0.15)", color: "#10b981", borderColor: "rgba(16,185,129,0.3)" })
              .html('<i class="fa-solid fa-circle-check"></i> Enabled (1-Pass)');
    }
}

// ── 6. Extension Bootstrap ───────────────────────────────────────────────────

jQuery(async () => {
    console.log(`[${EXTENSION_NAME}] Initializing Krea ImageGen (ComfyUI)...`);

    // 1. Hook 1-Pass Prompt Injection
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handlePromptInjection);

    // 2. Hook incoming message to detect <img prompt="..."> tags
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => handleIncomingMessage(messageId));

    // 3. Attach retry & swipe buttons whenever messages render or chat changes
    eventSource.on(event_types.CHAT_CHANGED, () => {
        const chat = getContext().chat || [];
        chat.forEach((m, idx) => {
            if (m.mes && m.mes.includes("KreaInline")) {
                kreaRetrySweep(idx, getSettings(), handleRegenerate);
            }
        });
    });

    eventSource.on(event_types.MESSAGE_UPDATED, (idx) => {
        kreaRetrySweep(idx, getSettings(), handleRegenerate);
    });

    // 4. Mount Quick Gen Button
    mountQuickGenButton();

    // 5. Mount Settings Panel
    await initSettingsUi();

    console.log(`[${EXTENSION_NAME}] Ready! 1-Pass Krea-2 engine active.`);
});
