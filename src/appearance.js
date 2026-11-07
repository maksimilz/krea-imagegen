// ────────────────────────────────────────────────────────────────────────────
// Legacy saved looks. Earlier versions let the LLM write {Name} / {Name:look} tags that were
// swapped for a saved description; the model now describes everyone itself. Old chats still
// hold such tags in their stored prompts, so ↻ and the recent-prompts block keep expanding them.
//   {Name}       → look + usual outfit
//   {Name:look}  → look only
// ────────────────────────────────────────────────────────────────────────────

import { EXTENSION_NAME } from "./data.js";
import { getSettings } from "./utils.js";

const normName = (name) => String(name || "").replace(/\s+/g, " ").trim().toLowerCase();

// s.appearances: { "char:<avatar>" | "persona:<avatar>": { card, people: [{ name, text, outfit }] } }
// (the oldest format was a single { name, text } per card)
function savedLooks() {
    const byName = new Map();
    const appearances = getSettings().appearances;
    if (!appearances || typeof appearances !== "object") return byName;
    for (const entry of Object.values(appearances)) {
        const people = Array.isArray(entry?.people) ? entry.people : [entry];
        for (const p of people) {
            const n = normName(p?.name);
            const text = p?.text?.trim();
            if (n && text && !byName.has(n)) byName.set(n, { text, outfit: p.outfit?.trim() || "" });
        }
    }
    return byName;
}

/** Replaces old {Name} / {Name:look} tags with the saved looks; unknown tags become the plain name. */
export function expandAppearanceTags(prompt) {
    if (!prompt || !prompt.includes("{")) return prompt;
    const byName = savedLooks();

    const used = new Set();
    return prompt
        // 'a {Name}' / 'the {Name}': the saved look brings its own article.
        .replace(/\b(?:a|an|the)\s+(?=\{[^{}\n]{1,60}\})/gi, "")
        .replace(/\{([^{}\n]{1,60})\}/g, (all, inner, offset, whole) => {
            const m = inner.match(/^(.*?)\s*:\s*look\s*$/i);
            const name = m ? m[1] : inner;
            const saved = byName.get(normName(name));
            if (!saved) {
                console.warn(`[${EXTENSION_NAME}] No saved appearance for ${all} — tag left as a plain name.`);
                return name;
            }
            const before = whole.slice(0, offset);
            const after = whole.slice(offset + all.length).trimStart();
            const startsSentence = !before.trim() || /[.!?]\s*$/.test(before);
            const cap = (str) => (startsSentence ? str.charAt(0).toUpperCase() + str.slice(1) : str);

            // A second full description would paint the same person twice.
            if (used.has(normName(name))) return cap(`the same ${personNoun(saved.text)}`);
            used.add(normName(name));

            // '{Name} wearing …': the model described the clothes itself, so the usual outfit would clash.
            const ownClothes = /^,?\s*(?:wearing|dressed|clad|in (?:a|an|her|his|their|only|nothing)\b|naked|nude|undressed|shirtless|topless)/i.test(after);
            let text = (m || ownClothes || !saved.outfit) ? saved.text : `${saved.text}, wearing ${saved.outfit}`;
            // '{Name} leans…' → '…, leans…' so the long phrase doesn't run straight into the verb.
            if (/^[a-z]/i.test(after) && !/^(?:and|or|with|in|on|at|by|beside|near|next)\b/i.test(after)) text += ",";
            return cap(text);
        });
}

// 'a slim woman in her twenties …' → 'woman', for 'the same woman' on a repeated tag.
function personNoun(look) {
    return look.match(/\b(woman|man|girl|boy|lady|gentleman|person)\b/i)?.[1].toLowerCase() || "person";
}
