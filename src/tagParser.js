// ── 2. Tag Extraction & ComfyUI Execution ────────────────────────────────────

function isInsideTag(text, index, tagName) {
    if (!text || index <= 0) return false;
    const sub = text.slice(0, index);
    let lastOpen = -1;
    let match;
    const openAll = new RegExp(`<${tagName}(?:[\\s>])`, "gi");
    while ((match = openAll.exec(sub)) !== null) {
        lastOpen = match.index;
    }
    if (lastOpen === -1) return false;

    let lastClose = -1;
    const closeAll = new RegExp(`</${tagName}[\\s>]`, "gi");
    while ((match = closeAll.exec(sub)) !== null) {
        lastClose = match.index;
    }
    return lastOpen > lastClose;
}

const REASONING_TAGS = ["think", "thinking", "thought", "reasoning", "analysis", "reason", "reflection"];
function isInsideReasoningTag(text, index) {
    return REASONING_TAGS.some(tag => isInsideTag(text, index, tag));
}

export function extractKreaTags(rawText) {
    if (!rawText || typeof rawText !== "string") return [];

    const found = [];

    const detectAspectFromPrompt = (promptText) => {
        if (!promptText) return null;
        const lower = promptText.toLowerCase();
        // 21:9 first: panoramas get the 1536x640 size the directive offers for them.
        if (/\b(?:21:9|ultrawide|panorama|panoramic)\b/i.test(lower)) {
            return { width: 1536, height: 640 };
        }
        if (/\b(?:16:9|landscape|wide shot|cinematic vista|expansive)\b/i.test(lower)) {
            return { width: 1344, height: 768 };
        }
        if (/\b(?:9:16|full-body|full body|standing full length|vertical scale|entire body)\b/i.test(lower)) {
            return { width: 768, height: 1344 };
        }
        if (/\b(?:3:4|2:3|portrait|bust shot|head and shoulders|upper-body|upper body)\b/i.test(lower)) {
            return { width: 896, height: 1152 };
        }
        if (/\b(?:1:1|square|close-up|close up|macro face|face focus)\b/i.test(lower)) {
            return { width: 1024, height: 1024 };
        }
        if (/\b(?:4:3|3:2|medium shot)\b/i.test(lower)) {
            return { width: 1152, height: 896 };
        }
        return null;
    };

    const parseDims = (str, promptText = "") => {
        let width = null, height = null;
        const wMatch = str.match(/\bwidth=["']?(\d+)["']?/i);
        const hMatch = str.match(/\bheight=["']?(\d+)["']?/i);
        if (wMatch) width = parseInt(wMatch[1]);
        if (hMatch) height = parseInt(hMatch[1]);

        if (!width || !height) {
            const resMatch = str.match(/\b(?:res|resolution)=["']?(\d+)[xX×](\d+)["']?/i);
            if (resMatch) {
                width = parseInt(resMatch[1]);
                height = parseInt(resMatch[2]);
            }
        }

        if (!width || !height) {
            const aspectMatch = str.match(/\b(?:aspect|aspect_ratio)=["']?(\d+:\d+)["']?/i);
            if (aspectMatch) {
                const asp = aspectMatch[1];
                if (asp === "16:9") { width = 1344; height = 768; }
                else if (asp === "9:16") { width = 768; height = 1344; }
                else if (asp === "1:1") { width = 1024; height = 1024; }
                else if (asp === "3:4" || asp === "2:3") { width = 896; height = 1152; }
                else if (asp === "4:3" || asp === "3:2") { width = 1152; height = 896; }
                else if (asp === "21:9") { width = 1536; height = 640; }
            }
        }

        // Auto-detect resolution from scene keywords if not explicitly specified in tag
        if ((!width || !height) && promptText) {
            const detected = detectAspectFromPrompt(promptText);
            if (detected) {
                width = detected.width;
                height = detected.height;
            }
        }

        // Quantize dimensions to multiples of 16 (minimum 64) for VAE safety
        if (width) width = Math.max(64, Math.round(width / 16) * 16);
        if (height) height = Math.max(64, Math.round(height / 16) * 16);

        return { width, height };
    };

    // 1. Standard HTML <img> tags: scan while tracking quotes to prevent premature termination on '>'
    const imgStartRegex = /<img\b/gi;
    let imgStartMatch;
    while ((imgStartMatch = imgStartRegex.exec(rawText)) !== null) {
        const start = imgStartMatch.index;
        // Ignore thoughts (<think>, <thinking>, <thought>, <reasoning>, <analysis>)
        if (isInsideReasoningTag(rawText, start)) {
            continue;
        }

        let inQuote = null;
        let end = -1;
        for (let i = start + imgStartMatch[0].length; i < rawText.length; i++) {
            const ch = rawText[i];
            if (inQuote) {
                if (ch === inQuote && rawText[i - 1] !== '\\') {
                    inQuote = null;
                }
            } else {
                if (ch === '"' || ch === "'") {
                    inQuote = ch;
                } else if (ch === '>') {
                    end = i + 1;
                    break;
                }
            }
        }
        if (end === -1) continue;

        const fullTag = rawText.slice(start, end);

        // Only ignore our own ALREADY RENDERED images
        if (fullTag.includes('alt="KreaInline"') || fullTag.includes("data-kreaid")) {
            continue;
        }

        if (!/\bprompt\s*=/i.test(fullTag)) {
            continue;
        }

        let prompt = "";
        const promptMatch = fullTag.match(/\bprompt\s*=\s*(["']?)/i);
        if (promptMatch) {
            const quote = promptMatch[1];
            let afterPrompt = fullTag.slice(promptMatch.index + promptMatch[0].length);
            afterPrompt = afterPrompt.replace(/[\s\/]*>$/, "");
            const attrMatch = afterPrompt.match(/\s+(?:width|height|res|resolution|aspect|aspect_ratio|style|alt)\s*=/i);
            if (attrMatch) {
                prompt = afterPrompt.slice(0, attrMatch.index);
            } else {
                prompt = afterPrompt;
            }
            prompt = prompt.trim();
            if (quote && prompt.endsWith(quote)) {
                prompt = prompt.slice(0, -quote.length);
            } else if (prompt.endsWith('"') || prompt.endsWith("'")) {
                prompt = prompt.slice(0, -1);
            }
            prompt = prompt.trim();
        }
        if (prompt) {
            const { width, height } = parseDims(fullTag, prompt);
            found.push({ index: start, length: fullTag.length, prompt, width, height, raw: fullTag });
        }
    }

    // 2. Fallback: [IMAGE: prompt] or [IMAGE: "prompt"] or [pic: prompt]
    const bracketRegex = /\[(?:IMAGE|pic|img)\b[:\s]+(?:prompt=)?(?:["']?)([\s\S]*?)(?:["']?)\s*\]/gi;
    for (const m of rawText.matchAll(bracketRegex)) {
        const fullTag = m[0];
        const index = m.index;
        // Ignore thoughts (<think>, <thinking>, <thought>, <reasoning>, <analysis>)
        if (isInsideReasoningTag(rawText, index)) {
            continue;
        }
        let prompt = (m[1] || "").trim().replace(/^["']|["']$/g, "").trim();
        if (prompt && !found.some(f => f.index === index)) {
            const { width, height } = parseDims(fullTag, prompt);
            found.push({ index, length: fullTag.length, prompt, width, height, raw: fullTag });
        }
    }

    found.sort((a, b) => a.index - b.index);

    // Filter overlaps
    const cleanMatches = [];
    let lastEnd = -1;
    for (const item of found) {
        if (item.index >= lastEnd) {
            cleanMatches.push(item);
            lastEnd = item.index + item.length;
        }
    }

    return cleanMatches;
}
