import { extension_settings } from "../../../../extensions.js";
import { EXTENSION_NAME, DEFAULT_SETTINGS } from "./data.js";

let defaultsFilled = false;

export function getSettings() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    const s = extension_settings[EXTENSION_NAME];
    // Settings saved by an older version miss the newer keys: give them their defaults once.
    if (!defaultsFilled) {
        defaultsFilled = true;
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            if (!(key in s)) s[key] = JSON.parse(JSON.stringify(value));
        }
    }
    return s;
}

// Like `parseFloat(v) || def`, but keeps a real 0 (LoRA weight 0, seed 0).
export function numOr(value, def) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : def;
}

// SillyTavern wraps «…», “…”, 「…」 etc. in <q> even inside tag attributes (it only shields "),
// which breaks <img src> when a card name or prompt contains them. Numeric entities survive that pass.
const ST_QUOTE_CHARS = /[«»“”「」『』＂]/g;

export function escapeQuoteChars(str) {
    return String(str ?? "").replace(ST_QUOTE_CHARS, (c) => `&#${c.codePointAt(0)};`);
}

// Re-escapes those quotes in already-saved Krea <img> tags.
export function fixKreaImgQuotes(text) {
    if (typeof text !== "string") return text;
    return text.replace(/<img\b[^>]*?alt="KreaInline"[^>]*>/g, escapeQuoteChars);
}

export function escapeHtml(str) {
    if (!str) return "";
    return escapeQuoteChars(String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;"));
}

export function decodeHtml(str) {
    if (!str) return "";
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
}
