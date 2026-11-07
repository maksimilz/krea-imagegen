// ────────────────────────────────────────────────────────────────────────────
// Style per chat: the style and the Atlas modifiers live in the chat's metadata
// (chat_metadata.krea_style) and come back when that chat is opened again. A chat
// without one keeps whatever style is current, and stores it on its first image.
// ────────────────────────────────────────────────────────────────────────────

import { getContext } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";

const KEY = "krea_style";

function chatMeta() {
    const ctx = getContext();
    // No chat open (welcome screen): nothing to remember into.
    if (!ctx.chatId && !(typeof ctx.getCurrentChatId === "function" && ctx.getCurrentChatId())) return null;
    return ctx.chatMetadata || null;
}

const sameMods = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

/** The style stored in the open chat, or null. */
export function getChatStyle() {
    const saved = chatMeta()?.[KEY];
    return saved && typeof saved.style === "string" ? saved : null;
}

/** Writes the current style and modifiers into the open chat. */
export function saveChatStyle(s) {
    if (!s.perChatStyle) return;
    const meta = chatMeta();
    if (!meta) return;
    const next = { style: s.clioStyle || "", mods: { ...(s.styleMods || {}) } };
    const cur = meta[KEY];
    if (cur && cur.style === next.style && sameMods(cur.mods, next.mods)) return;
    meta[KEY] = next;
    getContext().saveMetadataDebounced();
}

/** Takes the open chat's stored style into the settings. true = the settings changed. */
export function restoreChatStyle(s) {
    if (!s.perChatStyle) return false;
    const saved = getChatStyle();
    if (!saved) return false;
    if (saved.style === (s.clioStyle || "") && sameMods(saved.mods, s.styleMods)) return false;
    s.clioStyle = saved.style;
    s.styleMods = { ...(saved.mods || {}) };
    saveSettingsDebounced();
    return true;
}

/** On the first image of a chat that has no stored style: remember the one it is drawn with. */
export function rememberChatStyleIfMissing(s) {
    if (s.perChatStyle && !getChatStyle()) saveChatStyle(s);
}
