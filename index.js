/* ────────────────────────────────────────────────────────────────────────────
   Krea ImageGen (ComfyUI) — Main Extension Controller (bootstrap only)
   Single-Pass (In-Context) Image Generation with Krea-2 Architecture
   ──────────────────────────────────────────────────────────────────────────── */

import { getContext } from "../../../extensions.js";
import { event_types, eventSource, saveChatConditional, updateMessageBlock } from "../../../../script.js";

import { EXTENSION_NAME } from "./src/data.js";
import { getSettings } from "./src/utils.js";
import { handlePromptInjection, trackGenerationType } from "./src/injection.js";
import { kreaRetrySweep, observeKreaChat } from "./src/chatUi.js";
import { cleanOrphanedStopButtons, recoverStalePlaceholders, repairKreaImgQuotes } from "./src/chatStore.js";
import { handleIncomingMessage, handleRegenerate, isGeneratingNow } from "./src/generation.js";
import { mountQuickGenButton } from "./src/quickButton.js";
import { initSettingsUi } from "./src/settingsUi.js";
import { restoreChatStyle } from "./src/chatStyle.js";
import { refreshStyleUi } from "./src/clioStyles.js";

// ── 6. Extension Bootstrap ───────────────────────────────────────────────────

jQuery(async () => {
    console.log(`[${EXTENSION_NAME}] Initializing Krea ImageGen (ComfyUI)...`);

    // 1. Hook 1-Pass Prompt Injection (skipped for quiet/impersonate generations)
    eventSource.on(event_types.GENERATION_STARTED, trackGenerationType);
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handlePromptInjection);

    // 2. Hook incoming message to detect <img prompt="..."> tags
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => handleIncomingMessage(messageId));

    // 3. Attach retry & swipe buttons and clean any legacy stop buttons
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        // Each chat brings back the style it was drawn with; the card redraws either way
        // (its "style of this chat" note depends on the chat too).
        restoreChatStyle(getSettings());
        refreshStyleUi();
        cleanOrphanedStopButtons();
        if (!isGeneratingNow()) await recoverStalePlaceholders();
        const chat = getContext().chat || [];
        let repaired = false;
        chat.forEach((m, idx) => {
            if (m.mes && (m.mes.includes("KreaInline") || m.mes.includes("krea-failed"))) {
                if (repairKreaImgQuotes(m)) {
                    updateMessageBlock(idx, m);
                    repaired = true;
                }
                kreaRetrySweep(idx, getSettings(), handleRegenerate, () => isGeneratingNow());
            }
        });
        if (repaired) await saveChatConditional();
    });

    eventSource.on(event_types.MESSAGE_UPDATED, (idx) => {
        cleanOrphanedStopButtons();
        kreaRetrySweep(idx, getSettings(), handleRegenerate, () => isGeneratingNow());
    });

    observeKreaChat(getSettings, handleRegenerate, () => isGeneratingNow());

    // 4. Mount Quick Gen Button
    mountQuickGenButton();

    // 5. Mount Settings Panel
    await initSettingsUi();

    // 6. Clean any legacy orphaned in-text buttons from current chat
    cleanOrphanedStopButtons();
    if (!isGeneratingNow()) await recoverStalePlaceholders();

    console.log(`[${EXTENSION_NAME}] Ready! 1-Pass Krea-2 engine active.`);
});
