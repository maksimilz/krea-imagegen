// ────────────────────────────────────────────────────────────────────────────
// Krea ImageGen — Configuration Defaults, Constants & Resolutions
// ────────────────────────────────────────────────────────────────────────────

export const EXTENSION_NAME = "krea_imagegen";
export const EXTENSION_FOLDER = "third-party/krea-imagegen";

export const KREA_RESOLUTIONS = [
    { label: "1344 x 768 (16:9 кино / несколько персонажей)", w: 1344, h: 768 },
    { label: "1152 x 896 (4:3 средний план)", w: 1152, h: 896 },
    { label: "1024 x 1024 (1:1 квадрат)", w: 1024, h: 1024 },
    { label: "896 x 1152 (3:4 вертикальный портрет)", w: 896, h: 1152 },
    { label: "832 x 1216 (2:3 камерный портрет)", w: 832, h: 1216 },
    { label: "768 x 1344 (9:16 в полный рост)", w: 768, h: 1344 },
    { label: "1536 x 640 (21:9 панорама)", w: 1536, h: 640 },
];

// The LLM sometimes invents sizes (2048x2048, 1920x1080) that are slow or crash the render:
// keep its aspect ratio but use the closest size from the list above.
export function snapToKreaResolution(width, height) {
    const w = parseInt(width), h = parseInt(height);
    if (!(w > 0 && h > 0)) return null;
    const exact = KREA_RESOLUTIONS.find(r => r.w === w && r.h === h);
    if (exact) return { width: w, height: h };
    const ratio = Math.log(w / h);
    let best = KREA_RESOLUTIONS[0];
    for (const r of KREA_RESOLUTIONS) {
        if (Math.abs(Math.log(r.w / r.h) - ratio) < Math.abs(Math.log(best.w / best.h) - ratio)) best = r;
    }
    return { width: best.w, height: best.h };
}

export const KAZUMA_PLACEHOLDERS = [
    { key: '"%prompt%"', desc: "Positive Prompt (Text)" },
    { key: '"%negative_prompt%"', desc: "Negative Prompt (Text)" },
    { key: '"%seed%"', desc: "Seed (Integer)" },
    { key: '"%steps%"', desc: "Sampling Steps (Integer)" },
    { key: '"%scale%"', desc: "CFG Scale (Float)" },
    { key: '"%denoise%"', desc: "Denoise Strength (Float)" },
    { key: '"%model%"', desc: "Checkpoint Name" },
    { key: '"%sampler%"', desc: "Sampler Name" },
    { key: '"%width%"', desc: "Image Width (px)" },
    { key: '"%height%"', desc: "Image Height (px)" },
    { key: '"%lora1%"', desc: "LoRA 1 Filename" },
    { key: '"%lorawt1%"', desc: "LoRA 1 Weight (Float)" },
    { key: '"%lora2%"', desc: "LoRA 2 Filename" },
    { key: '"%lorawt2%"', desc: "LoRA 2 Weight (Float)" },
    { key: '"%lora3%"', desc: "LoRA 3 Filename" },
    { key: '"%lorawt3%"', desc: "LoRA 3 Weight (Float)" },
    { key: '"%lora4%"', desc: "LoRA 4 Filename" },
    { key: '"%lorawt4%"', desc: "LoRA 4 Weight (Float)" },
    { key: '"%batch_size%"', desc: "Batch Size (Integer)" },
    { key: '"%style%"', desc: "Clio Style Name (from 398 styles library)" },
    { key: '"%clio_style%"', desc: "Clio Style Name (Alias)" },
    { key: '"%style_text%"', desc: "Style text of a Style Atlas style (empty for Clio)" },
    { key: '"%style_source%"', desc: "Style source: clio, atlas or none" }
];

export const DEFAULT_SETTINGS = {
    enabled: true,
    comfyUrl: "http://127.0.0.1:8188",
    currentWorkflowName: "",
    selectedModel: "",
    selectedSampler: "euler",
    steps: 20,
    cfg: 7.0,
    denoise: 1.0,
    customSeed: -1,
    customNegative: "bad quality, blurry, worst quality, low quality, artifacts, watermark",
    promptPrefix: "",
    promptExtra: "",
    promptTemplate: "krea_cinematic", // krea_cinematic, krea_pov, krea_portrait, anima_hybrid
    clioStyle: "✨ none", // a Clio style name, or "atlas:<name>" for a Style Atlas style (see styleLibrary.js)
    clioFavorites: [],
    clioRecent: [],
    styleMods: {},                    // Style Atlas modifiers: { "Lighting": name | "🎲 Random", … }
    atlasTextVersion: "short",        // Style Atlas text: "short" (what the previews were drawn with) or "long"
    softTone: false,                  // true = old calm wording for explicit moments (for strict APIs)
    perChatStyle: true,               // style + modifiers are stored in each chat's metadata (chatStyle.js)
    stylePickWishes: "",              // last wishes typed for the AI style pick
    stylePickPicOnly: true,           // AI style pick: offer only styles that have a preview
    triggerMode: "always",           // always, frequency, conditional, manual
    autoGenFreq: 3,
    imageCount: 1,
    autoCount: false,                 // model decides how many (1..imageCount)
    autoRetries: 2,                   // re-submit a crashed render this many times
    historyPrompts: 2,                // past image prompts kept in LLM context as <img prompt> tags
    injectMode: "inline",             // inline, gallery
    compressImages: true,
    previewPrompt: false,
    specialImageEnabled: false,
    specialImagePrompt: "",
    appearances: {},                  // legacy saved looks, only to expand {Name} tags in old prompts

    // LoRA Lab (up to 4 slots)
    lora1: "", lorawt1: 1.0, loraTrigger1: "",
    lora2: "", lorawt2: 1.0, loraTrigger2: "",
    lora3: "", lorawt3: 1.0, loraTrigger3: "",
    lora4: "", lorawt4: 1.0, loraTrigger4: "",
    savedLoraTriggers: {}, // Memory map: lora filename -> trigger words

    // Resolution
    hiRes: false,           // render at ~1.5 MP (same aspect) instead of ~1 MP
    workflowProfiles: {},   // per workflow: LoRA slots, sampler, steps, cfg (settingsUi.js)
    resolutionMode: "auto", // "auto" (AI chooses dynamically) or "fixed"
    imgWidth: 1344,
    imgHeight: 768
};
