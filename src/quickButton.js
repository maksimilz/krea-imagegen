import { getContext } from "../../../../extensions.js";
import { saveChatConditional, updateMessageBlock } from "../../../../../script.js";
import { handleIncomingMessage, renderSinglePlaceholder, stopCurrentGeneration, isGeneratingNow, isProcessingNow } from "./generation.js";
import { extractKreaTags } from "./tagParser.js";
import { rememberPrompt } from "./chatStore.js";
import { getSettings } from "./utils.js";

// ── 4. Quick Gen Button (🪄) near input bar ───────────────────────────────────
// Renders the last character message: its unprocessed <img prompt> tags if there are any,
// otherwise the whole message text goes to ComfyUI as the prompt.

// Rendered/failed Krea blocks, reasoning and any markup — only the story text is kept.
const KREA_BLOCK_REGEX = /<!-- krea-inline-start:[^>]+ -->[\s\S]*?<!-- krea-inline-end:[^>]+ -->|<div\b[^>]*?class=["'][^"']*krea-img-(?:wrapper|placeholder)[^"']*["'][\s\S]*?<\/div>/gi;
const REASONING_REGEX = /<(think|thinking|thought|reasoning|analysis|reflection)\b[^>]*>[\s\S]*?<\/\1>/gi;

function messageToPrompt(mes) {
    const box = document.createElement("div");
    box.innerHTML = String(mes || "")
        .replace(KREA_BLOCK_REGEX, " ")
        .replace(REASONING_REGEX, " ")
        .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
    return (box.textContent || "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n")
        .trim();
}

async function renderWholeMessage(msgIndex) {
    const msg = getContext().chat[msgIndex];
    const prompt = messageToPrompt(msg.mes);
    if (!prompt) return toastr.warning("В последнем ответе нет текста для картинки.");

    const placeholderId = `krea-img-${Date.now()}-0`;
    rememberPrompt(msg, placeholderId, { prompt, width: null, height: null, style: getSettings().clioStyle });
    const placeholder = `<div id="${placeholderId}" class="krea-img-placeholder"><i class="fa-solid fa-spinner fa-spin"></i> [Рендер сцены Krea-2…]</div>`;
    msg.mes = `${msg.mes}\n\n${placeholder}`;
    if (msg.extra && typeof msg.extra.display_text === "string") {
        msg.extra.display_text += `\n\n${placeholder}`;
    }
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") {
        msg.swipes[msg.swipe_id] = msg.mes;
    }
    await saveChatConditional();
    updateMessageBlock(msgIndex, msg);

    await renderSinglePlaceholder(placeholderId, prompt, null, null);
}

export function mountQuickGenButton() {
    if (document.getElementById("krea_quick_btn")) return;
    // ST's send button is #send_but; #send_button is kept for older/forked builds.
    const sendBtn = document.getElementById("send_but") || document.getElementById("send_button");
    if (!sendBtn || !sendBtn.parentNode) return;

    const quickBtn = document.createElement("div");
    quickBtn.id = "krea_quick_btn";
    quickBtn.className = "krea-quick-btn";
    quickBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
    quickBtn.title = "Krea-2: сгенерировать картинку для текущей сцены";
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
    quickBtn.onmouseenter = () => { if (!isGeneratingNow()) quickBtn.style.background = "rgba(6, 182, 212, 0.3)"; };
    quickBtn.onmouseleave = () => { if (!isGeneratingNow()) quickBtn.style.background = "rgba(6, 182, 212, 0.15)"; };

    quickBtn.onclick = async () => {
        if (isGeneratingNow()) {
            await stopCurrentGeneration();
            return;
        }
        if (isProcessingNow()) {
            toastr.warning("Картинка уже генерируется. Подожди.");
            return;
        }
        const chat = getContext().chat;
        if (!chat || !chat.length) return toastr.warning("Чат пуст.");

        // Find the latest AI (character) message in the chat
        let targetIndex = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user && !chat[i].is_system) {
                targetIndex = i;
                break;
            }
        }
        if (targetIndex === -1) {
            return toastr.warning("Нет сообщения персонажа, к которому можно добавить картинку.");
        }

        toastr.info("Krea-2: запускаю визуализацию сцены…");
        if (extractKreaTags(chat[targetIndex].mes).length) {
            await handleIncomingMessage(targetIndex, { force: true });
        } else {
            await renderWholeMessage(targetIndex);
        }
    };

    sendBtn.parentNode.insertBefore(quickBtn, sendBtn);
}
