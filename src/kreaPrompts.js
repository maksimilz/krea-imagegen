// ────────────────────────────────────────────────────────────────────────────
// Krea-2 Prompt Engine & 1-Pass Injection Builder
// Optimized specifically for Krea-2 (single-stream MMDiT + Qwen3-VL-4B).
// ────────────────────────────────────────────────────────────────────────────

export const KREA_PROMPTS = {
    rulesKreaCinematic: `You are generating a visual prompt for Krea-2 (single-stream MMDiT with Qwen3-VL-4B text encoder). Krea-2 excels with rich, natural-language prose descriptions and fails with comma-separated keyword lists or meta phrases. Build the prompt in this EXACT order as a cohesive, flowing natural-language paragraph:

1. **Cinematic Shot & Camera:** Start directly with the shot type and camera angle (e.g., 'A cinematic low-angle wide shot...', 'A dramatic medium close-up shot...'). Specify depth of field, focal length feel, and compositional balance.
2. **Main Subject(s), Action & Anti-Bleeding:** Clearly describe the main subjects, dynamic poses, body language, facial expressions, and actions. For multiple characters, clearly separate them into distinct sentences with explicit spatial positioning ('On the left side of the frame... while in the center...') to prevent feature bleeding.
3. **Fashion, Fabrics & Physical Textures:** Be precise about clothing materials (quilted leather, brushed linen, wet canvas, tailored velvet), accessories, hair styling, and surface textures.
4. **Props, Environment & World Details:** Describe the architecture, props, environmental conditions (rain-slicked streets, ancient stonework, swirling dust), and spatial depth.
5. **Lighting, Color Palette & Atmosphere:** Detail the lighting sources and direction (volumetric god rays, dramatic rim light, neon backlight, warm golden hour tones), shadow contrast, and emotional atmosphere.
6. **Text in Image:** Enclose any legible signs, typography, or lettering in double quotation marks (e.g., a billboard reading "NEO TOKYO").
7. **Aesthetic & Medium:** Conclude with the visual medium and artistic aesthetic (e.g., '35mm cinematic film still, atmospheric anamorphic lens flare, masterclass composition, rich tonal range').
8. **Dynamic Resolution Choice (Krea-2 Standards):** Pick the optimal resolution for the scene composition and specify it as width and height in the tag:
   - 1344x768 (16:9) or 1536x640 (21:9): cinematic wide shots, expansive vistas, multiple subjects
   - 1152x896 (4:3) or 1216x832 (3:2): standard cinematic shot, medium range
   - 1024x1024 (1:1): square focus, close-up framing
   - 896x1152 (3:4) or 832x1216 (2:3): vertical cinematic portrait, intimate drama
   - 768x1344 (9:16): full-body dynamic poses, vertical towering scale
   Always enclose the prompt in: <img prompt="[Prompt]" width="[W]" height="[H]" />`,

    examplesKreaCinematic: `EXAMPLE — Single Character Cinematic:
<img prompt="A cinematic low-angle full-body shot of a young warrior woman with sun-bronzed skin, piercing amber eyes, and wind-whipped silver-white hair standing at the edge of a crumbling sandstone cliff. She wears an off-white draped linen tunic fastened by an ornate brass belt, with leather wrist bracers and bare feet gripping the rock. Her expression is fierce and resolute, fists clenched firmly at her sides as desert winds catch the folds of her garment. In the background, sprawling ancient ruins stretch across a vast sun-drenched canyon. Golden hour sunlight creates brilliant volumetric god rays through floating dust particles, with strong rim lighting tracing her silhouette and deep dramatic shadows across the rock face. 35mm cinematic film still aesthetic, rich warm color grading." width="768" height="1344">

EXAMPLE — Multiple Characters Cinematic:
<img prompt="A cinematic wide shot of a rain-soaked cobblestone alleyway at night. On the left side of the frame, a tall elven ranger with long flowing silver hair, pointed ears, fair skin, and vivid emerald eyes leans against a stone pillar, dressed in weathered dark green leather armor under a hooded cloak with a longbow resting in her hand. In the center stands a stout dwarven warrior with tanned skin, hazel eyes, and thick braided auburn beard, clad in heavy dented iron plate armor with fur-trimmed pauldrons, resting a two-handed warhammer over his shoulder with a confident grin. Behind them, warm golden light spills from stained-glass tavern windows into the rainy darkness. Volumetric mist drifts above the ground, streetlamps cast sharp rim highlights on the wet stones, and deep puddles reflect the neon tavern sign reading \\"THE BOAR\\". Cinematic anamorphic film still, rich moody atmosphere." width="1344" height="768">`,

    rulesKreaPov: `You are generating a visual prompt for Krea-2 (single-stream MMDiT with Qwen3-VL-4B text encoder). Krea-2 excels with rich, natural-language prose descriptions and fails with comma-separated keyword lists or meta phrases. Build the prompt in this EXACT order as a cohesive, flowing natural-language paragraph:

1. **First-Person POV & Framing:** Start directly with the first-person perspective. Never use meta phrases like 'In this image' or 'The photo shows'.
   - *Passively observing:* Anchor the camera to the environment (e.g., 'A 1st-person point of view looking out over the edge of a polished wooden desk in the foreground...'). Never describe the user's face or body.
   - *Physically interacting:* Describe first-person hands actively engaged in the scene (e.g., 'A 1st-person point of view with male hands in the foreground holding a steaming porcelain cup...').
2. **Subject, Poses & Expressions:** Describe each character facing or interacting with the viewer in vivid, lifelike detail (age, ethnicity, eyes, facial expression, gaze locked on viewer, hair texture and movement, exact posture).
   - *Anti-Bleed Multi-Character Rule:* For multiple characters, describe each character in a distinct, separate sentence with clear spatial placement (e.g., 'The woman on the left is... while standing to the right is...'). Never lump character traits into a single list.
3. **Clothing, Textures & Materials:** Detail specific fabrics (distressed denim, fine silk, heavy knit, weathered leather), tailoring, and how light catches the weave.
4. **Environment, Props & Lighting:** Describe setting architecture, background depth, and lighting physics (volumetric light rays, soft directional window light, rim lighting, atmospheric haze, shallow depth of field).
5. **Text in Image:** If any legible signs, neon, or text are present, enclose the exact text in double quotation marks (e.g., a neon sign reading "OPEN").
6. **Aesthetic & Finish:** Conclude with the overall aesthetic finish (e.g., 'cinematic film photography, rich natural colors, shallow depth of field, high visual fidelity').
7. **Dynamic Resolution Choice (Krea-2 Standards):** Pick the optimal resolution for the scene composition and specify it as width and height in the tag:
   - 1344x768 (16:9) or 1152x896 (4:3): wide shot, multiple characters, rooms
   - 1024x1024 (1:1): square focus, close-up, balanced framing
   - 896x1152 (3:4) or 832x1216 (2:3): vertical bust/upper-body portrait
   - 768x1344 (9:16): full-body standing character, vertical framing
   - 1536x640 (21:9): ultrawide panorama
   Always enclose the prompt in: <img prompt="[Prompt]" width="[W]" height="[H]" />`,

    examplesKreaPov: `EXAMPLE — Single Character POV:
<img prompt="A 1st-person point of view shot from the passenger seat of a dark luxury SUV. In the foreground, the edge of a black leather seat and a subtle dashboard glow anchor the frame. A mature woman with fair skin, dark almond eyes, and long jet-black hair pulled into a loose high ponytail sits angled toward the viewer. She wears a heavy charcoal wool overcoat draped over an ivory silk blouse. Her expression is anxious and vulnerable with subtle tear streaks along her cheeks as she reaches one hand toward the viewer while clutching a soft grey cashmere blanket with the other. Through the rain-speckled tinted windows behind her, blurred amber city lights streak through the night. Warm ambient cabin lighting creates soft highlights on her face with cinematic shallow depth of field." width="1152" height="896">

EXAMPLE — Multiple Characters POV:
<img prompt="A 1st-person point of view shot looking out from a bed over rumpled white linen sheets in the foreground. Three distinct maid attendants stand at the foot of the bed. On the left stands a delicate rabbit kemonomimi with long platinum blonde hair, tall white rabbit ears, pale skin, and wide sky-blue eyes, wearing a short frilly monochrome French maid uniform while nervously clasping her hands near her chest. In the center stands a tall, composed human head maid with dark hair styled into a neat braided bun, warm brown eyes, wearing a traditional Victorian high-collared black maid gown and holding a silver tray with both hands. Standing to the right is a demon girl with porcelain skin, chin-length obsidian hair, sharp crimson eyes, and small polished black horns, wearing a navy maid dress with a crisp white apron. Behind them, an ornate sunlit bedchamber with antique mahogany furniture and a crystal chandelier glows under warm morning sunlight with subtle volumetric dust particles and cinematic depth of field." width="1344" height="768">`,

    rulesKreaPortrait: `You are generating a visual prompt for Krea-2 (single-stream MMDiT with Qwen3-VL-4B text encoder). Krea-2 excels with rich, natural-language prose descriptions and fails with comma-separated keyword lists or meta phrases. Build the prompt in this EXACT order as a cohesive, flowing natural-language paragraph focused on a single character:

1. **Portrait Framing & Angle:** Start directly with the portrait crop and perspective (e.g., 'An intimate upper-body portrait...', 'A close-up head-and-shoulders portrait at eye level...'). One character only.
2. **Subject, Face & Micro-Expressions:** Meticulously describe the character's facial features, age, ethnicity/species, skin texture (subtle freckles, natural skin glow, pores, soft flush), eye shape and color with catchlights, lip shape, and micro-expression. Detail hair style, strands catching light, and movement.
3. **Clothing, Collars & Accessories:** Detail visible garments, collar design, fabric textures (ribbed wool, silk ribbon, distressed leather jacket), delicate jewelry, or any object held near the chest/face.
4. **Lighting & Optical Bokeh:** Describe portrait lighting (soft diffused studio lighting, side-lit natural window light, subtle warm hair rim light), soft shadows shaping the jawline, and a beautifully blurred, non-distracting background (creamy bokeh).
5. **Aesthetic & Finish:** Conclude with the visual medium and aesthetic finish (e.g., 'editorial portrait photography, soft natural color grading, hyper-detailed textures, pristine focus').
6. **Dynamic Resolution Choice (Krea-2 Standards):** Pick the optimal portrait resolution and specify width and height in the tag:
   - 896x1152 (3:4) or 832x1216 (2:3): upper-body portrait, head and shoulders, classic vertical format
   - 1024x1024 (1:1): close-up face crop, square artistic portrait
   - 768x1344 (9:16): full-length or three-quarter vertical portrait
   Always enclose the prompt in: <img prompt="[Prompt]" width="[W]" height="[H]" />`,

    examplesKreaPortrait: `EXAMPLE — Character Portrait:
<img prompt="An intimate head-and-shoulders portrait of a young elf woman with alabaster skin and a dusting of delicate freckles across the bridge of her nose. She has luminous jade-green eyes with subtle specular catchlights and long wavy auburn hair loosely pinned with a silver filigree hairpin. A slight, knowing smile plays on her lips as she tilts her head subtly toward the viewer. She wears a moss-green boiled wool tunic with a high mandarin collar and a small etched bronze pendant resting against her collarbone. Soft directional window light illuminates one side of her face while leaving the other in gentle shadow, with a warm golden rim light defining her hair. The background is a soft, dreamlike blur of deep forest greens. Editorial portrait photography aesthetic, shallow depth of field, refined textures and pristine focus." width="896" height="1152">`
};

/**
 * Builds the 1-Pass system instruction to inject into the LLM prompt.
 * The model will directly generate the <img prompt="..." width="..." height="..."> tag in its response.
 */
export function buildKrea1PassInstruction(settings) {
    const tmpl = settings.promptTemplate || "krea_cinematic";
    let rules = KREA_PROMPTS.rulesKreaCinematic;
    let examples = KREA_PROMPTS.examplesKreaCinematic;

    if (tmpl === "krea_pov") {
        rules = KREA_PROMPTS.rulesKreaPov;
        examples = KREA_PROMPTS.examplesKreaPov;
    } else if (tmpl === "krea_portrait") {
        rules = KREA_PROMPTS.rulesKreaPortrait;
        examples = KREA_PROMPTS.examplesKreaPortrait;
    }

    const maxImages = Math.max(1, parseInt(settings.imageCount) || 1);
    let countInstruction = "";
    if (maxImages <= 1) {
        countInstruction = `Within your response, insert exactly 1 image tag (<img prompt="[Prompt]" width="[W]" height="[H]">) to illustrate the key visual moment of the scene. Place the tag immediately after the paragraph it illustrates.`;
    } else {
        countInstruction = `Within your response, insert ${maxImages} distinct image tags (<img prompt="[Prompt]" width="[W]" height="[H]">) distributed after different paragraphs to illustrate the progression of the scene. Never place tags consecutively without narrative text between them.`;
    }

    let conditionalText = "";
    if (settings.triggerMode === "conditional") {
        conditionalText = "CRITICAL INSTRUCTION: ONLY output the <img prompt=\"...\"> tag if the character is explicitly taking a photo, sharing a picture, or if a significant visual event is occurring in this exact moment. If not, do NOT output any image tags.\n\n";
    }

    let extraText = settings.promptExtra ? `\n\nExtra Visual Directives: ${settings.promptExtra}` : "";

    return `### KREA-2 IMAGE GENERATION DIRECTIVE:
${conditionalText}${countInstruction}

${rules}${extraText}

${examples}

CRITICAL: Output ONLY valid <img prompt="..." width="..." height="..."> tags with complete attributes. Place each tag directly in the story flow.`;
}
