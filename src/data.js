// ────────────────────────────────────────────────────────────────────────────
// Krea ImageGen — Configuration Defaults, Constants & Resolutions
// ────────────────────────────────────────────────────────────────────────────

export const EXTENSION_NAME = "krea_imagegen";
export const EXTENSION_FOLDER = "third-party/krea-imagegen";

export const KREA_RESOLUTIONS = [
    { label: "1344 x 768 (16:9 Cinematic Landscape / Multi-char)", w: 1344, h: 768 },
    { label: "1152 x 896 (4:3 Standard Medium Range)", w: 1152, h: 896 },
    { label: "1024 x 1024 (1:1 Square Artistic Focus)", w: 1024, h: 1024 },
    { label: "896 x 1152 (3:4 Classic Vertical Portrait)", w: 896, h: 1152 },
    { label: "832 x 1216 (2:3 Intimate Bust Portrait)", w: 832, h: 1216 },
    { label: "768 x 1344 (9:16 Full-Body Vertical Scale)", w: 768, h: 1344 },
    { label: "1536 x 640 (21:9 Ultrawide Cinematic Vista)", w: 1536, h: 640 },
];

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
    { key: '"%batch_size%"', desc: "Batch Size (Integer)" }
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
    promptTemplate: "krea_cinematic", // krea_cinematic, krea_pov, krea_portrait
    triggerMode: "always",           // always, frequency, conditional, manual
    autoGenFreq: 3,
    imageCount: 1,
    injectMode: "inline",             // inline, gallery
    compressImages: true,
    previewPrompt: false,
    
    // LoRA Lab (up to 4 slots)
    lora1: "", lorawt1: 1.0, loraTrigger1: "",
    lora2: "", lorawt2: 1.0, loraTrigger2: "",
    lora3: "", lorawt3: 1.0, loraTrigger3: "",
    lora4: "", lorawt4: 1.0, loraTrigger4: "",
    savedLoraTriggers: {}, // Memory map: lora filename -> trigger words

    // Resolution
    resolutionMode: "auto", // "auto" (AI chooses dynamically) or "fixed"
    imgWidth: 1344,
    imgHeight: 768
};
