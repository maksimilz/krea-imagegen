// ────────────────────────────────────────────────────────────────────────────
// Krea-2 Prompt Engine & 1-Pass Injection Builder
// The directive rides along with a (often large) text preset, so it stays compact,
// calm in tone, and explicitly leaves the story's language, length and format alone.
// ────────────────────────────────────────────────────────────────────────────

import { getActiveStyleInfo, getModsLabel } from "./styleLibrary.js";

export const KREA_DIRECTIVE_MARKER = "## Illustrations (Krea image tags)";

// Prose templates follow the Krea 2 Turbo shape: shot and lens → light → people → setting → medium.
// Example prompts keep the medium sentence and the lens words separate ({lens}), so both can be
// dropped when a visual style is active and would fight it.
const TEMPLATES = {
    krea_cinematic: {
        words: "80–160",
        framing: "Open with the shot size and the camera height and angle (e.g. 'A low-angle medium shot looking up at…', 'A wide eye-level shot of…'). Frame it like a film camera, not first person.",
        lens: "Add the lens feel to the opening sentence (e.g. 'on a 35mm lens').",
        light: "Second sentence: the light — one or two real sources with their direction and color (e.g. 'warm lamp light from the left, cool moonlight through the window behind'). Don't stack effects like god rays, lens flare, fog and bloom.",
        order: "shot and camera → light → each person: look, clothing, expression, gaze, pose → setting with a few concrete objects and materials",
        medium: "End with one short sentence on medium and finish (e.g. 'Shot as a cinematic film still with natural skin texture and fine film grain.').",
        resolutions: [
            ["1344x768", "wide scenes, several people"],
            ["1536x640", "panoramas"],
            ["1152x896", "medium shots"],
            ["1024x1024", "close-ups"],
            ["896x1152", "upper body"],
            ["768x1344", "full body, tall subjects"],
        ],
        example: {
            prompt: "A wide eye-level shot{lens} of a narrow cobblestone street at night in steady rain. Warm orange light spills from tavern windows on the right, and a cold blue streetlamp behind the figures throws long reflections across the wet stones. On the left stands a tall woman in her late twenties with pale skin, green eyes, pointed elven ears and long straight silver hair, wearing dark oiled leather armor under a charcoal wool cloak with the hood pushed back. She watches the alley with a wary frown, weight on her front foot, a longbow held low in her left hand. On the right stands a short, broad woman in her forties with tan freckled skin, brown eyes and thick red hair in two long braids, wearing dented iron plate armor with fur-lined pauldrons. She grins wide, feet planted apart, a heavy warhammer resting on her right shoulder. A painted sign above the door reads 'THE BOAR'.",
            lens: " on a 35mm lens",
            medium: "Shot as a cinematic film still with natural skin texture and fine film grain.",
            width: 1344, height: 768,
        },
    },
    krea_pov: {
        words: "80–160",
        framing: "Open with 'A first-person view from…' and say where the viewer is and what they look at. The viewer is the camera: never describe the viewer's face; when only watching, anchor the frame with something in the foreground (sheets, a table edge, a steering wheel); show the viewer's own hands only when they physically do something.",
        lens: "Add the lens feel to the opening sentence (e.g. 'on a 35mm lens').",
        light: "Second sentence: the light — one or two real sources with their direction and color. Don't stack effects like god rays, lens flare, fog and bloom.",
        order: "viewpoint and foreground → light → each person facing or reacting to the viewer: look, clothing, expression, gaze, pose, distance to the camera → setting with a few concrete objects",
        medium: "End with one short sentence on medium and finish (e.g. 'Shot as a candid photograph with shallow depth of field and natural skin texture.').",
        resolutions: [
            ["1344x768", "rooms, several people"],
            ["1152x896", "medium distance"],
            ["1024x1024", "close and balanced"],
            ["896x1152", "upper body"],
            ["768x1344", "full body standing"],
            ["1536x640", "panoramas"],
        ],
        example: {
            prompt: "A first-person view{lens} from the back seat of a dark car at night, the camera at seat height looking across black leather toward the far door. Soft amber dome light from above fills the cabin, and blurred white and red city lights streak past the rain-speckled window. A woman in her late thirties with pale skin, dark brown eyes and long black hair in a messy high ponytail sits sideways on the seat, wearing a charcoal wool coat open over a white silk blouse. Faint tear streaks mark her cheeks; she leans toward the viewer and reaches out with her right hand, her left hand clutching a grey blanket to her chest.",
            lens: " on a 35mm lens",
            medium: "Shot as a candid photograph with shallow depth of field and natural skin texture.",
            width: 1152, height: 896,
        },
    },
    krea_portrait: {
        words: "70–140",
        framing: "Exactly one person. Open with the crop (face close-up, head and shoulders, upper body or full body) and the camera height and angle (e.g. 'A head-and-shoulders portrait at eye level of…').",
        lens: "Add the lens feel to the opening sentence (e.g. 'on an 85mm lens').",
        light: "Second sentence: one or two light sources with direction and quality (soft window light from the left, warm candlelight from below) and where the shadows fall.",
        order: "crop and camera → light → face: age, skin texture and marks, eyes, expression, gaze, head angle → hair → clothing, collar, jewelry, what the hands hold → one simple, softly blurred background",
        medium: "End with one short sentence on medium and finish (e.g. 'Shot as a natural-light portrait photograph with natural skin texture and fine film grain.').",
        resolutions: [
            ["896x1152", "head and shoulders, upper body"],
            ["832x1216", "taller upper-body crop"],
            ["1024x1024", "tight face close-up"],
            ["768x1344", "three-quarter or full length"],
        ],
        example: {
            prompt: "A head-and-shoulders portrait at eye level{lens}, the camera close and straight on. Soft window light from the left falls across her face and leaves a gentle shadow under the right side of her jaw. She is a woman in her early twenties with pale skin, a light dusting of freckles across her nose, bright green eyes, pointed elven ears and long auburn hair in a loose side braid over her left shoulder, with small silver leaf-shaped earrings. She wears a dark green wool tunic under a fitted brown leather vest with a high collar. She smiles gently and looks straight at the viewer, head tilted slightly to the right, holding a small glowing blue flower just below her chin. Behind her is a soft out-of-focus blur of green forest.",
            lens: " on an 85mm lens",
            medium: "Shot as a natural-light portrait photograph with natural skin texture and fine film grain.",
            width: 896, height: 1152,
        },
    },
    // Anima understands Danbooru tags and natural language at once, so its prompt is a short
    // tag head followed by plain sentences. In the Krea→Anima workflow both models read the same
    // text: Krea builds the pose from the sentences, Anima redraws the characters from the tags.
    anima_hybrid: {
        hybrid: true,
        words: "40–90",
        framing: "Open the sentences with the shot type and camera angle (e.g. 'A low-angle medium shot of…').",
        order: "shot and camera → each person: name or look, pose, action, expression, gaze → clothing → setting and props → lighting and atmosphere",
        medium: "If it fits the scene, add one meta tag to the tag head: 'anime screenshot' for a TV-anime frame or 'official art' for a polished illustration.",
        resolutions: [
            ["1344x768", "wide scenes, several people"],
            ["1536x640", "panoramas"],
            ["1152x896", "medium shots"],
            ["1024x1024", "close-ups"],
            ["896x1152", "upper body"],
            ["832x1216", "taller upper-body crop"],
            ["768x1344", "full body, tall subjects"],
        ],
        example: {
            prompt: "masterpiece, best quality, safe, 1girl, 1boy, yor briar, loid forger, spy x family, night, balcony, city lights, standing, wine glass, black dress, suit, smile. A medium shot at eye level of Yor Forger from Spy x Family, a tall woman in her late twenties with long black hair, red eyes and a gold hairband, leaning on a stone balcony railing in a black evening dress with a wine glass in her hand. Beside her on the right, Loid Forger from Spy x Family, a man in his late twenties with neat blond hair and green eyes in a dark grey suit, turns toward her with a faint smile. Warm light from the ballroom behind them meets the cool blue glow of the city below.",
            medium: "",
            width: 1344, height: 768,
        },
    },
    // MOSS-Image reads Danbooru tags and long English sentences (up to 4K tokens). OpenMOSS's tag order is
    // quality → score → meta → year → character → series → artist → general, and it has no rating tags.
    // Its strength is lettering, so signs, notes and screens get their exact words.
    moss_hybrid: {
        hybrid: true,
        words: "60–140",
        tagHead: "'best quality, highres' → people count → canon character and series tags → 2–3 look tags for each original character (hair color and length, eye color, e.g. 'long silver hair, green eyes') → 5–12 key tags for pose, setting, clothing, mood",
        metaTag: "if it fits, add 'anime screenshot' (a TV-anime frame) or 'official art' (a polished illustration) right after 'best quality, highres'",
        noRating: true,
        extraRules: [
            "- Lettering: when a sign, note, label, screen or title is part of the moment, write its exact words in single quotes and say where it is and how it looks, e.g. a chalkboard menu reads 'HONEY LATTE' in white chalk letters. Keep it to a few short words or lines.",
        ],
        framing: "Open the sentences with the shot type and camera angle (e.g. 'A low-angle medium shot of…').",
        order: "shot and camera → each person: name or look, pose, action, expression, gaze → clothing → setting, props and any lettering → lighting and atmosphere",
        medium: "",
        resolutions: [
            ["1344x768", "wide scenes, several people"],
            ["1536x640", "panoramas"],
            ["1152x896", "medium shots"],
            ["1024x1024", "close-ups"],
            ["896x1152", "upper body"],
            ["832x1216", "taller upper-body crop"],
            ["768x1344", "full body, tall subjects"],
        ],
        example: {
            prompt: "best quality, highres, 2girls, long silver hair, green eyes, short black hair, red eyes, cafe, night, rain, window, coffee cup, sitting, smile, leather jacket, sweater, chalkboard. A medium shot at eye level inside a small cafe at night. On the left, a woman in her early twenties with long silver hair, green eyes and an oversized cream knit sweater sits by a rain-streaked window, cupping a coffee mug in both hands and smiling at her friend. On the right, a woman in her late twenties with short black hair, red eyes and a dark leather jacket leans forward on her elbows, laughing. Behind them a chalkboard menu reads 'TODAY: HONEY LATTE' in white chalk letters. Warm pendant lamps glow against the blue city lights outside.",
            medium: "",
            width: 1344, height: 768,
        },
    },
};

// Wording rules shared by all templates. Ambiguous ages are what provider filters react to most,
// so every person gets an adult age.
const ADULTS_RULE = "- People are adults unless the story clearly says otherwise: in the prose call them women and men with an adult age ('a woman in her late twenties'), not girls or boys, and never 'small', 'petite' or 'childlike' for a person. A scene with a minor stays fully clothed and non-suggestive.";
// Default: explicit moments are drawn as they are. Image models only draw what the prompt names,
// so softened wording ('intimate moment', 'barely covered') produces a vague, clothed picture.
const DIRECT_RULE = "- Describe what is visible plainly and concretely, like a caption for an explicit illustration: when the moment shows nudity or sex, name the body parts, sexual acts, positions and fluids directly in neutral visual words. The story's slang, sounds and dialogue never go into the prompt.";
// Optional fallback ("Мягкие формулировки"): for providers whose filter blocks the whole 1-pass reply.
const TONE_RULE = "- Keep the wording calm and visual, like a film still description: show intimate or revealing moments through pose, framing, lighting and what is covered, in neutral terms, without graphic anatomical detail.";
const wordingRule = settings => (settings.softTone ? TONE_RULE : DIRECT_RULE);

// A story told in Russian sometimes leaks a word into the prompt ('pale голубой glow').
const ENGLISH_RULE = "- Every word of the prompt is English: translate what you take from the story (colors, clothing, objects, places) instead of copying the story's own words.";

// Modifiers without a base style: the story model should keep its light and mood in line with them.
function modsRule(settings, styleOn) {
    const mods = styleOn ? "" : getModsLabel(settings);
    return mods ? `- Added to the prompt automatically: ${mods}. Keep the light and mood consistent with it.` : null;
}

// Krea 2 Turbo has no working negative prompt: a negated word ('no hat') gets drawn.
const NO_NEGATION_RULE = "- Describe only what is visible. Never use negations ('no hat', 'without people', 'not smiling'): the image model has no working negative prompt, so negated words get drawn.";
const NO_QUALITY_RULE = "- No quality words (masterpiece, best quality, 8k, ultra detailed, hyperrealistic, award-winning) and no weight syntax like (word:1.2).";

// Hybrid models read Danbooru tags: for explicit images the tag head names what is shown.
const NSFW_TAGS_RULE = "add 3–8 plain Danbooru tags to the tag head for what is shown: nudity (nude, topless, bottomless, nipples, pussy, penis), the act and position (sex, vaginal, anal, fellatio, paizuri, missionary, cowgirl position, doggystyle, straddling) and visible state or fluids (blush, sweat, open mouth, saliva, cum).";

// What every person needs in every prompt: the look stays word-for-word stable (the recent tags
// in the directive are the reference), the clothes follow the story.
// Tested on Krea 2 Turbo + LoRAs and RedCraft (2026-11-07): a person whose clothes go unnamed is drawn
// bare-chested, and 'shirt open' without saying where the shirt is turns into fully naked with some LoRAs.
const PERSON_LOOK = "adult age and gender, build in one or two neutral words, skin tone, hair (color, length, style), eye color, distinctive marks, then what they wear right now and its state: name every garment that is open, pulled aside, half off or still on, and where it sits (e.g. 'her white shirt open and hanging off both shoulders, plaid skirt still on'). Keep a person's look wording the same from image to image (take it from the character card, the persona and the recent tags); the clothes follow the exact moment of the scene.";

// Same tests: an ageless 'slender person beside her' came out as a child. Everyone in frame gets age and gender.
const EVERYONE_RULE = "- Everyone in the frame, even only partly (a hand, someone beside or behind), gets an adult age and gender, e.g. 'the hand of a man in his twenties'. Never write just 'a person', 'someone' or 'a figure'.";

// The style itself is added to the prompt for the image model; the story model only learns which one it is,
// so its scene suits it (no '35mm film still' for a watercolor style).
function styleLockedRule(styleInfo, hybrid) {
    const which = styleInfo?.label
        ? `A visual style is applied automatically: '${styleInfo.label}'${styleInfo.desc ? ` (${styleInfo.desc})` : ""}${styleInfo.mods ? `, plus ${styleInfo.mods}` : ""}. Describe the scene so it suits this style. `
        : "A visual style preset is applied automatically. ";
    return hybrid
        ? `${which}No style, medium or meta tags (no anime screenshot, official art, painting, render) and no @artist tags.`
        : `${which}Do not name any medium or art style yourself (no film, lens, photography, anime, painting or render terms). End with the setting instead.`;
}

const ANIMA_TAG_HEAD = "'masterpiece, best quality' → one rating tag → people count → canon character and series tags → 2–3 look tags for each original character (hair color and length, eye color, e.g. 'long silver hair, green eyes') → 5–12 key tags for pose, setting, clothing, mood";

// Hybrid rules (Anima, MOSS): tag head first, then sentences. Canon characters are named, because
// these models know them from Danbooru; original roleplay characters are only described.
function buildAnimaRules(t, settings, styleInfo) {
    const styleOn = !!styleInfo;
    return [
        "- The prompt has two parts in this order: a tag head, then sentences. Start the sentences right after the tag head's final period.",
        `- Tag head: comma-separated Danbooru tags in lowercase, spaces instead of underscores, no weights or brackets except a series qualifier like 'fern (sousou no frieren)', no score_ tags. Order: ${t.tagHead || ANIMA_TAG_HEAD}. End the tag head with a period.`,
        !t.noRating && "- Rating tag: one of safe, sensitive, nsfw, explicit — the one that matches what the image shows.",
        !settings.softTone && (t.noRating
            ? `- Explicit images: ${NSFW_TAGS_RULE}`
            : `- For an nsfw or explicit image, ${NSFW_TAGS_RULE}`),
        !styleOn && t.metaTag && `- Meta tag: ${t.metaTag}.`,
        "- People count tags: 1girl / 2girls / 1boy / 1girl, 1boy and so on, plus solo for a single person; no humans when nobody is visible. Keep it to 3 people or fewer per image.",
        "- Canon characters (a known anime, manga or game character, e.g. from the character card or the story's setting): put their Danbooru tag and series tag in the tag head ('shiina mahiru, otonari no tenshi-sama') and in the sentences call them by their name with the series in normal capitalization ('Mahiru Shiina from Otonari no Tenshi-sama'), then still describe hair, eyes and outfit.",
        `- Original characters (roleplay names the image model can't know): never write their names. Describe them in full every time: ${PERSON_LOOK}`,
        ADULTS_RULE,
        EVERYONE_RULE,
        wordingRule(settings),
        `- Sentences: ${t.words} words of plain English, at least 2 sentences. They carry the pose, action, camera and composition (tags alone won't), so spell out who is where, what they do, their expression and gaze. No meta phrases like 'this image shows', no story references ('as before'), no double quotes (put visible lettering in single quotes).`,
        ENGLISH_RULE,
        "- Several people: give each one their own sentence with a clear position ('On the left…', 'Behind her…').",
        ...(t.extraRules || []),
        `- ${t.framing}`,
        `- Order of the sentences: ${t.order}.`,
        `- ${styleOn ? styleLockedRule(styleInfo, true) : `${t.medium} Only use @artist tags if asked below.`.trim()}`,
        modsRule(settings, styleOn),
    ].filter(Boolean);
}

function buildProseRules(t, settings, styleInfo) {
    const styleOn = !!styleInfo;
    return [
        "- One flowing English paragraph of " + t.words + " words in plain, grammatically complete sentences, like a photographer describing the shot. No keyword lists, no meta phrases like 'this image shows', no double quotes (put any visible lettering in single quotes).",
        ENGLISH_RULE,
        `- Never use names or story references ('as before', 'the same room'). Describe every person in full every time so they stay recognizable: ${PERSON_LOOK}`,
        ADULTS_RULE,
        EVERYONE_RULE,
        wordingRule(settings),
        "- Use the full length: short prompts lose clothing and background details.",
        "- Show the exact moment just written: who is where, the pose as concrete body states (where the weight rests, what each hand does, the head tilt), the action, expression, gaze and objects in hand. Add one detail of motion if the scene has it (hair in the wind, steam, rain).",
        "- Several people: give each one their own sentences with a clear position ('On the left…', 'Behind her…').",
        `- ${t.framing}`,
        !styleOn && t.lens && `- ${t.lens}`,
        `- ${t.light}`,
        `- Order: ${t.order}.`,
        NO_NEGATION_RULE,
        NO_QUALITY_RULE,
        `- ${styleOn ? styleLockedRule(styleInfo, false) : t.medium}`,
        modsRule(settings, styleOn),
    ].filter(Boolean);
}

// The finished example prompt for a template: lens words and the medium sentence drop out under a style.
function examplePrompt(t, styleOn) {
    const ex = t.example;
    const body = ex.prompt.replace("{lens}", styleOn ? "" : (ex.lens || ""));
    return styleOn || !ex.medium ? body : `${body} ${ex.medium}`;
}

function imgTag(prompt, autoRes, width, height) {
    return autoRes ? `<img prompt="${prompt}" width="${width}" height="${height}">` : `<img prompt="${prompt}">`;
}

// Shown only when a reply gets several images: models otherwise tend to stack the tags together
// at the end. Story lines are a short made-up scene; each tag has its own shot and size.
function buildPlacementExample(t, styleOn, autoRes) {
    let first, second;
    if (t.hybrid) {
        const head = t.noRating ? "best quality, highres" : "masterpiece, best quality, safe";
        first = `${head}, 1girl, solo, tavern, doorway, night, rain, hooded cloak, wet hair, standing. A medium shot at eye level of a tall woman in her thirties with pale skin, grey eyes and damp dark hair, standing in the open doorway of a rustic tavern and shaking rain from the edge of her hooded wool cloak. Firelight from the hearth warms her face while rain falls in the dark behind her.`;
        second = `${head}, 1boy, solo, tavern, bar counter, tankard, beard, apron, upper body. A close-up of a burly man in his fifties with a short grey beard and a scarred jaw behind a worn oak bar, his weathered hands resting on a wooden tankard as he stares across the room, shoulders tense. Orange firelight from the left carves shadows across his face.`;
    } else {
        const lens = styleOn ? "" : " on a 50mm lens";
        first = `A medium shot at eye level${lens} of a tall woman in her thirties standing in the open doorway of a rustic tavern at night. Firelight from the hearth on the right warms her face while cold rain falls in the dark behind her. She has pale skin, sharp grey eyes and damp dark hair under a hooded wool travel cloak, and shakes water from its edge with her left hand, her weight on her back foot.`;
        second = `A close-up${styleOn ? "" : " on an 85mm lens"} of a burly man in his fifties behind a worn oak bar. Orange firelight from the left catches his wary dark eyes and carves shadows along his scarred jaw. He has a short grey beard and a stained linen shirt, and his weathered hands rest on a wooden tankard, shoulders tense.`;
        if (!styleOn && t.example.medium) {
            first += ` ${t.example.medium}`;
            second += ` ${t.example.medium}`;
        }
    }
    return `

Placement with several tags (made-up scene, story shortened; your story keeps its own language):
The tavern door swung open and a tall ranger stepped in, shaking rain from her cloak.
${imgTag(first, autoRes, 896, 1152)}
Across the room the innkeeper set down a tankard, his eyes fixed on her.
${imgTag(second, autoRes, 1024, 1024)}`;
}

function getCounts(settings) {
    const maxImages = Math.max(1, parseInt(settings.imageCount) || 1);
    const special = (settings.specialImageEnabled && settings.specialImagePrompt && settings.specialImagePrompt.trim()) || "";
    // Auto count: phrased as "one per visual beat" with 1 as a rare exception —
    // a plain "up to N" makes models settle on a single image every time.
    const auto = !!settings.autoCount && maxImages > 1;
    const regular = special ? maxImages - 1 : maxImages;
    const conditional = settings.triggerMode === "conditional";
    return { maxImages, special, auto, regular, conditional };
}

function buildCountRule(settings) {
    const { special, auto, regular, conditional } = getCounts(settings);
    const lines = [];

    if (conditional) {
        // Binary choice on purpose: letting the model pick a count makes it always pick 1.
        lines.push("When: only if this turn has a strongly visual event (a photo is taken or shared, a new location, a dramatic action or reveal). If not, include no tags at all; if yes, follow the count below in full.");
    }

    if (auto) {
        lines.push(`How many: 1–${regular} story tags, one per visual beat — a new place or lighting, someone entering or leaving, a significant action or pose change, an emotional peak, an important object or outfit. Most replies have 2–3 beats; use a single tag only when the whole reply is one short static moment. Don't settle on 1 out of habit.`);
    } else if (regular === 1) {
        lines.push("How many: exactly 1 story tag, after the most visual moment of the reply.");
    } else if (regular > 1) {
        lines.push(`How many: exactly ${regular} story tags, each after a different moment (e.g. the setting, an action, a reaction close-up). If the reply is short, find ${regular} distinct moments within it rather than lengthening the story.`);
    }

    if (special) {
        lines.push(`${regular > 0 ? "Then one more tag, the last one in the prose" : "How many: exactly 1 tag"} — a special image that follows these instructions:
"""
${special}
"""`);
    }
    return lines.join("\n");
}

/**
 * Builds the 1-Pass system instruction to inject into the LLM prompt.
 * The model will directly generate the <img prompt="..." width="..." height="..."> tag in its response.
 */
export function buildKrea1PassInstruction(settings, recentTags = []) {
    const t = TEMPLATES[settings.promptTemplate] || TEMPLATES.krea_cinematic;
    // null when no style is active; otherwise its name and a short description for the story model.
    const styleInfo = getActiveStyleInfo(settings);
    const styleOn = !!styleInfo;
    const autoRes = settings.resolutionMode !== "fixed";
    const tagSyntax = autoRes ? '<img prompt="..." width="W" height="H">' : '<img prompt="...">';

    const rules = t.hybrid ? buildAnimaRules(t, settings, styleInfo) : buildProseRules(t, settings, styleInfo);
    if (autoRes) {
        rules.push(`- Pick width and height to fit the composition: ${t.resolutions.map(([r, d]) => `${r} ${d}`).join(" · ")}.`);
    }
    if (settings.promptExtra && settings.promptExtra.trim()) {
        rules.push(`- Also apply: ${settings.promptExtra.trim()}`);
    }

    const ex = t.example;
    const exTag = imgTag(examplePrompt(t, styleOn), autoRes, ex.width, ex.height);
    const { auto, regular } = getCounts(settings);
    const placement = (auto || regular > 1) ? buildPlacementExample(t, styleOn, autoRes) : "";

    // Past prompts live here rather than in the chat history, so the history stays cache-stable.
    const recent = recentTags.length
        ? `\n\nRecent tags from this chat, oldest first — reuse their wording for how each person looks so they stay recognizable, but compose every new prompt fresh for the new moment, never copy one:\n${recentTags.join("\n")}`
        : "";

    return `${KREA_DIRECTIVE_MARKER}
Besides writing your reply as usual, illustrate it with image tags: ${tagSyntax}

${buildCountRule(settings)}

Placement:
- Put each tag on its own line inside the story prose, right after the paragraph it shows. Never two tags in a row, and never inside reasoning, trackers, status/HUD blocks, headers or HTML widgets.
- The story keeps its usual language, length and format; only the prompt text is written in English.
- The prompt is a separate caption for the illustrator, not part of the story: the story's own style rules (explicit or blunt language, slang, sounds, colors, typography, HTML) shape the prose only. Prompts follow only the rules below.

Writing the prompt — the image model sees ONLY this text: no story, ${t.hybrid ? "no roleplay context" : "no names"}, no earlier images.
${rules.join("\n")}

Example tag:
${exTag}${placement}${recent}`;
}

/**
 * One-line recency reminder appended to the end of the payload.
 * Must contain "image tag" and no "]" so the injection cleanup can recognise it.
 */
export function buildKreaReminder(settings) {
    const { special, auto, regular, conditional } = getCounts(settings);
    let count;
    if (auto) count = `one <img prompt> image tag per visual beat (1–${regular}, usually 2–3)`;
    else if (regular === 1) count = "exactly 1 <img prompt> image tag, after the most visual moment";
    else if (regular > 1) count = `exactly ${regular} <img prompt> image tags, each after its own moment`;
    else count = "exactly 1 <img prompt> image tag";
    if (special) count += regular > 0 ? ", plus the special image tag last" : " (the special one)";
    const when = conditional ? "only if this turn has a strongly visual event, otherwise none; if yes, " : "";
    const t = TEMPLATES[settings.promptTemplate] || TEMPLATES.krea_cinematic;
    if (t.hybrid) {
        const rating = t.noRating ? "" : " one rating tag,";
        return `[Illustrations — ${when}${count}. Each prompt in English: lowercase Danbooru tag head (quality,${rating} people count, canon character + series tags, hair and eye tags) ending with a period, then 2+ ${settings.softTone ? "calm" : "plain"} sentences on pose, action and camera, everyone in frame with an adult age; canon characters named, original characters described the same way as in the recent tags, never named; the story's own style rules do not apply to prompts, and the story itself stays in its usual language.]`;
    }
    const tone = settings.softTone ? "Calm" : "Plain, concrete";
    return `[Illustrations — ${when}${count}. ${tone} prompts in English with everyone's look described the same way as in the recent tags, everyone in frame with an adult age and what they wear right now, no names, no negations; the story's own style rules do not apply to prompts, and the story itself stays in its usual language.]`;
}
