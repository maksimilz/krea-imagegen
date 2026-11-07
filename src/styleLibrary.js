// ────────────────────────────────────────────────────────────────────────────
// One style library from two sources:
//   • Clio (398 styles written for Krea 2 as dense prose; ComfyUI node "ClioStyle",
//     previews at /clio_style/thumb)
//   • Style Atlas (≈1500 styles + modifiers for light, mood, palette…, read through the
//     megumin_style_atlas_bridge route; previews at /megumin/style_atlas/thumb)
//
// The same style often exists in both. Names are compared loosely and the Clio version
// wins, because it was written for Krea 2; the Atlas copy is dropped.
//
// A selected style is stored as one string in settings.clioStyle: a Clio name as before,
// or "atlas:<name>" for an Atlas style. Clio styles go through the ClioStyle node; Atlas
// styles and modifiers are written into the prompt text (applyStyleToPrompt).
//
// No SillyTavern imports here: everything gets the settings passed in.
// ────────────────────────────────────────────────────────────────────────────

export const NO_STYLE = "✨ none";
export const ATLAS_PREFIX = "atlas:";
export const RANDOM = "🎲 Random";
// Atlas modifier categories that make sense for story images (vehicle, product and architecture design are left out).
export const MOD_CATEGORIES = ["Lighting", "Mood & Atmosphere", "Palette", "Composition & Shot", "Genre", "Quality"];

export const isNoStyle = id => !id || id === NO_STYLE;
export const isAtlasId = id => typeof id === "string" && id.startsWith(ATLAS_PREFIX);
export const styleLabel = id => (isNoStyle(id) ? "" : isAtlasId(id) ? id.slice(ATLAS_PREFIX.length) : id);
/** What the ClioStyle node gets: an Atlas style is applied in the text, so the node passes through. */
export const clioNodeStyle = id => (isNoStyle(id) || isAtlasId(id) ? NO_STYLE : id);

const FILLER = new Set(["style", "styles", "art", "artwork", "illustration", "aesthetic", "the"]);
/** Loose name key: "Anime Style" and "Anime" match, "Yu-Gi-Oh! Style" and "Yu Gi Oh" match. */
export function normKey(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
        .split(" ").filter(w => w && !FILLER.has(w)).join(" ");
}

export const comfyBaseOf = url => String(url || "").trim().replace(/\/+$/, "");

const state = {
    clio: [],
    atlasUrl: null,
    atlasRows: null,     // base styles
    atlasMods: [],       // modifiers
    atlasThumbs: new Set(),
    atlasError: null,
    atlasPending: null,
    unified: null,
};

// The settings panel redraws when the library changes (Atlas arrives later, new previews appear).
const listeners = [];
export const onLibraryChange = fn => { if (typeof fn === "function") listeners.push(fn); };
const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.warn("[Krea-ImageGen] style library listener:", e); } });

export function setClioStyles(list) {
    state.clio = Array.isArray(list) ? list : [];
    state.unified = null;
}

async function getJson(url, ms) {
    const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
}

/**
 * Reads Style Atlas through the bridge once per ComfyUI address. Without the bridge the
 * library stays empty and only Clio is shown (error says why).
 */
export function loadAtlas(comfyUrl, { force = false } = {}) {
    const base = comfyBaseOf(comfyUrl);
    if (!base) return Promise.resolve({ ok: false, error: "нет адреса ComfyUI" });
    if (!force && state.atlasUrl === base) {
        if (state.atlasRows) return Promise.resolve({ ok: true, error: null });
        if (state.atlasPending) return state.atlasPending;
    }
    state.atlasUrl = base;
    const job = (async () => {
        try {
            const data = await getJson(`${base}/megumin/style_atlas`, 20000);
            if (!data?.rows?.length) throw new Error(data?.error || "библиотека пуста");
            let thumbs = [];
            try { thumbs = (await getJson(`${base}/megumin/style_atlas/thumbs`, 10000)).styles || []; } catch (e) { /* no previews yet */ }
            state.atlasThumbs = new Set(thumbs);
            state.atlasRows = data.rows.filter(r => !r.m).map(r => ({
                name: r.n, cat: r.c || "", sub: r.s || "", short: r.short || "", long: r.long || "",
            }));
            state.atlasMods = data.rows.filter(r => r.m && MOD_CATEGORIES.includes(r.c)).map(r => ({
                name: r.n, cat: r.c, short: r.short || "", long: r.long || "",
            }));
            state.atlasError = null;
        } catch (e) {
            state.atlasRows = null;
            state.atlasMods = [];
            state.atlasThumbs = new Set();
            state.atlasError = "Style Atlas недоступен (нужны Style_Atlas и megumin_style_atlas_bridge в ComfyUI, и ComfyUI должен быть запущен)";
        }
        state.unified = null;
        notify();
        return { ok: !!state.atlasRows, error: state.atlasError };
    })().finally(() => { if (state.atlasPending === job) state.atlasPending = null; });
    state.atlasPending = job;
    return job;
}

export const atlasStatus = () => ({
    loaded: !!state.atlasRows,
    error: state.atlasError,
    styles: state.atlasRows?.length || 0,
    mods: state.atlasMods.length,
    thumbs: state.atlasThumbs.size,
});

/** Atlas text without its "Name:" lead (the prompt template puts the name in front itself). */
export function descriptionOf(text) {
    const t = String(text || "").trim();
    const at = t.indexOf(":");
    return at > 0 && at <= 80 ? t.slice(at + 1).trim() : t;
}

export function atlasTextOf(row, version = "short") {
    if (!row) return "";
    const raw = version === "long" ? (row.long || row.short) : (row.short || row.long);
    return descriptionOf(raw).replace(/\s+/g, " ").trim().replace(/\.$/, "");
}

/** First clause of a long style text, for the story model and the cards. */
export function shortDesc(text, max = 150) {
    const t = descriptionOf(text).replace(/\s+/g, " ").trim();
    if (t.length <= max) return t.replace(/\.$/, "");
    const cut = t.slice(0, max);
    const at = Math.max(cut.lastIndexOf(","), cut.lastIndexOf(";"));
    return (at > 60 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(" "))).trim() + "…";
}

/**
 * Every style once: Clio first (all have previews), then Atlas styles with a preview, then the rest.
 * Entry: { id, name, section, sub, prompt, source: "clio"|"atlas", hasThumb, alsoInAtlas }
 */
export function getUnifiedStyles() {
    if (state.unified) return state.unified;
    const clioKeys = new Set(state.clio.map(c => normKey(c.name)));
    const atlasKeys = new Set((state.atlasRows || []).map(r => normKey(r.name)));
    const clio = state.clio.map(c => ({
        id: c.name, name: c.name, section: c.section || "", sub: "", prompt: c.prompt || "",
        source: "clio", hasThumb: true, alsoInAtlas: atlasKeys.has(normKey(c.name)),
    }));
    const atlas = (state.atlasRows || [])
        .filter(r => !clioKeys.has(normKey(r.name)))
        .map((r, i) => ({
            id: ATLAS_PREFIX + r.name, name: r.name, section: r.cat, sub: r.sub, prompt: descriptionOf(r.short || r.long),
            source: "atlas", hasThumb: state.atlasThumbs.has(r.name), alsoInAtlas: false, _i: i,
        }))
        .sort((a, b) => (b.hasThumb - a.hasThumb) || (a._i - b._i));
    state.unified = [...clio, ...atlas];
    return state.unified;
}

export function findStyle(id) {
    if (isNoStyle(id)) return null;
    if (isAtlasId(id)) {
        const name = styleLabel(id);
        const row = (state.atlasRows || []).find(r => r.name === name);
        return row ? { source: "atlas", name, row, section: row.cat, prompt: descriptionOf(row.short || row.long) } : { source: "atlas", name, row: null };
    }
    const c = state.clio.find(x => x.name === id);
    return { source: "clio", name: id, row: c || null, section: c?.section || "", prompt: c?.prompt || "" };
}

export function thumbUrlFor(id, comfyUrl) {
    const base = comfyBaseOf(comfyUrl);
    if (!base || isNoStyle(id)) return "";
    return isAtlasId(id)
        ? `${base}/megumin/style_atlas/thumb?style=${encodeURIComponent(styleLabel(id))}`
        : `${base}/clio_style/thumb?style=${encodeURIComponent(id)}`;
}

export const modsFor = cat => state.atlasMods.filter(m => m.cat === cat).map(m => m.name).sort();

/** The modifiers for one image; a Random slot picks here, so each image can get a different one. */
export function resolveMods(settings) {
    const picks = settings?.styleMods && typeof settings.styleMods === "object" ? settings.styleMods : {};
    const out = [];
    for (const cat of MOD_CATEGORIES) {
        const want = picks[cat];
        if (!want) continue;
        const pool = state.atlasMods.filter(m => m.cat === cat);
        const row = want === RANDOM
            ? (pool.length ? pool[Math.floor(Math.random() * pool.length)] : null)
            : pool.find(m => m.name === want) || null;
        if (!row && want === RANDOM) continue;
        out.push({ cat, name: row ? row.name : want, text: row ? atlasTextOf(row, settings.atlasTextVersion) : want });
    }
    return out;
}

/**
 * The prompt the image model gets. Clio styles are added by the ClioStyle node, so only the
 * modifiers are written here; an Atlas style uses Clio's style-first template in the text.
 */
export function applyStyleToPrompt(prompt, settings) {
    const id = settings?.clioStyle;
    const mods = resolveMods(settings).map(m => m.text).filter(Boolean);
    const modText = mods.length ? mods.join(". ") : "";
    if (isAtlasId(id)) {
        const st = findStyle(id);
        const text = st?.row ? atlasTextOf(st.row, settings.atlasTextVersion) : `in the style of ${st?.name || styleLabel(id)}`;
        return `Style: ${styleLabel(id)}: ${text}${modText ? `. ${modText}` : ""}. Subject: ${prompt}`;
    }
    return modText ? `${prompt} ${modText}.` : prompt;
}

/** The chosen modifiers as words for the story model ("Golden Hour, a random palette"), or "". */
export function getModsLabel(settings) {
    const picks = settings?.styleMods && typeof settings.styleMods === "object" ? settings.styleMods : {};
    return MOD_CATEGORIES.filter(c => picks[c])
        .map(c => (picks[c] === RANDOM ? `a random ${c.toLowerCase()}` : picks[c]))
        .join(", ");
}

/** For the story model: which style the picture will be in, so the scene suits it. null = no style. */
export function getActiveStyleInfo(settings) {
    const id = settings?.clioStyle;
    if (isNoStyle(id)) return null;
    const st = findStyle(id);
    return {
        label: styleLabel(id),
        desc: st?.prompt ? shortDesc(st.prompt) : "",
        mods: getModsLabel(settings),
    };
}

// ── Lazy loading ────────────────────────────────────────────────────────────

/** Atlas is needed for an Atlas style and for any modifier. */
export function needsAtlas(settings) {
    if (isAtlasId(settings?.clioStyle)) return true;
    const picks = settings?.styleMods;
    return !!picks && typeof picks === "object" && Object.values(picks).some(Boolean);
}

/**
 * Loads Atlas when this render or prompt needs it and it isn't there yet (ComfyUI started after
 * SillyTavern). Waits at most `waitMs`; the load keeps going in the background after that.
 */
export async function ensureAtlas(settings, waitMs = 20000) {
    if (!needsAtlas(settings) || state.atlasRows) return;
    const job = loadAtlas(settings.comfyUrl);
    await Promise.race([job, new Promise(r => setTimeout(r, waitMs))]);
}

/** Re-reads which Atlas styles have a preview (make_thumbs.py adds them while ST runs). true = list changed. */
export async function refreshAtlasThumbs(comfyUrl) {
    const base = comfyBaseOf(comfyUrl);
    if (!base || !state.atlasRows) return false;
    try {
        const list = (await getJson(`${base}/megumin/style_atlas/thumbs`, 10000)).styles || [];
        if (list.length === state.atlasThumbs.size) return false;
        state.atlasThumbs = new Set(list);
        state.unified = null;
        notify();
        return true;
    } catch (e) {
        return false;
    }
}

// ── Style suggestions by the story model ────────────────────────────────────

export const PICK_COUNT = 6;

/**
 * The quiet-prompt task: pick styles for this story from the library. The chat itself (card, history)
 * comes with the quiet generation; only names go in the list, grouped by category, to keep it short.
 */
export function buildStylePickPrompt(wishes, styles, favoriteIds = []) {
    const bySection = new Map();
    for (const s of styles) {
        const sec = s.section || "Other";
        if (!bySection.has(sec)) bySection.set(sec, []);
        bySection.get(sec).push(s.name);
    }
    const list = [...bySection.entries()].map(([sec, names]) => `${sec}: ${names.join("; ")}`).join("\n");
    const favs = favoriteIds.map(styleLabel).filter(Boolean);
    const wish = String(wishes || "").trim();
    return [
        "[Pause the roleplay. This is a one-off out-of-character task; do not continue the story.]",
        "",
        `Choose the ${PICK_COUNT} visual styles from the library below that would make the best illustrations for this story: its setting, genre, mood and characters as shown in the character card and the chat so far.`,
        wish ? `The user's wishes for the look (follow them first): ${wish}` : "The user gave no extra wishes: judge by the story.",
        favs.length ? `Styles the user liked before (a hint, not a must): ${favs.join("; ")}` : null,
        "Pick different directions rather than near-duplicates, best match first.",
        "",
        "<style_library>",
        list,
        "</style_library>",
        "",
        `Answer with exactly ${PICK_COUNT} lines and nothing else, in this format:`,
        "<exact style name from the list> — <why it fits, one short phrase in Russian>",
    ].filter(l => l !== null).join("\n");
}

/** Finds the library styles named in the model's answer, in order: [{ id, name, why }]. */
export function parseStylePickAnswer(text, styles) {
    const lower = styles.map(s => ({ s, n: s.name.toLowerCase(), k: normKey(s.name) }));
    const out = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
        const line = raw.replace(/^[\s>*\-•\d.)]+/, "").trim();
        if (!line) continue;
        const [head, ...rest] = line.split(/\s+[—–-]{1,2}\s+|:\s+/);
        const why = rest.join(" — ").replace(/^["'«»*\s]+|["'«»*\s]+$/g, "").trim();
        const ln = line.toLowerCase();
        // The longest library name inside the line wins ("Anime Key Visual" over "Anime").
        let best = null;
        for (const x of lower) {
            if (x.n.length > 2 && ln.includes(x.n) && (!best || x.n.length > best.n.length)) best = x;
        }
        if (!best) {
            const hk = normKey(head.replace(/["'«»*`]/g, ""));
            best = lower.find(x => x.k && x.k === hk) || null;
        }
        if (best && !out.some(o => o.id === best.s.id)) out.push({ id: best.s.id, name: best.s.name, why });
        if (out.length >= PICK_COUNT) break;
    }
    return out;
}
