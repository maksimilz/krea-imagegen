// ────────────────────────────────────────────────────────────────────────────
// ComfyUI REST API & Workflow Execution Engine
// ────────────────────────────────────────────────────────────────────────────

import { getRequestHeaders } from "../../../../../script.js";
import { saveBase64AsFile } from "../../../../utils.js";
import { humanizedDateTime } from "../../../../RossAscends-mods.js";
import { getContext } from "../../../../extensions.js";
import { makeComfyClientId, openComfyProgressSocket } from "./websocket.js";
import { numOr } from "./utils.js";
import { expandAppearanceTags } from "./appearance.js";
import { snapToKreaResolution } from "./data.js";
import { applyStyleToPrompt, clioNodeStyle, findStyle, atlasTextOf, isAtlasId, isNoStyle, ensureAtlas } from "./styleLibrary.js";

export async function testComfyConnection(comfyUrl) {
    try {
        const base = String(comfyUrl || "").trim().replace(/\/+$/, "");
        const res = await fetch(`${base}/system_stats`, { method: "GET" });
        return res.ok;
    } catch (e) {
        return false;
    }
}

export async function fetchComfyObjectInfo(comfyUrl) {
    try {
        const base = String(comfyUrl || "").trim().replace(/\/+$/, "");
        const res = await fetch(`${base}/object_info`, { method: "GET" });
        if (!res.ok) return null;
        const data = await res.json();

        const models = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
        const samplers = data?.KSampler?.input?.required?.sampler_name?.[0] || [];
        const loras = data?.LoraLoader?.input?.required?.lora_name?.[0] || [];

        return { models, samplers, loras };
    } catch (e) {
        console.warn("[Krea-ImageGen] Failed to fetch /object_info from ComfyUI", e);
        return null;
    }
}

export async function fetchAvailableWorkflows() {
    try {
        const res = await fetch('/api/sd/comfy/workflows', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({})
        });
        if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list)) return list;
        }
    } catch (e) { /* ignore */ }
    return [];
}

export async function loadWorkflowJson(workflowName) {
    const res = await fetch('/api/sd/comfy/workflow', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ file_name: workflowName })
    });
    if (!res.ok) throw new Error(`Could not load workflow: ${workflowName}`);
    const raw = await res.json();
    return (typeof raw === 'string') ? JSON.parse(raw) : raw;
}

// Cancels only our own job: drops it from the pending queue and interrupts it if it is the one running
// (ComfyUI ignores a prompt_id interrupt for any other job, so renders queued from elsewhere survive).
export async function cancelComfyJob(comfyUrl, promptId) {
    try {
        const base = String(comfyUrl || "").trim().replace(/\/+$/, "");
        if (!base || !promptId) return false;
        const headers = { "Content-Type": "application/json" };
        await Promise.allSettled([
            fetch(`${base}/queue`, { method: "POST", headers, body: JSON.stringify({ delete: [promptId] }) }),
            fetch(`${base}/interrupt`, { method: "POST", headers, body: JSON.stringify({ prompt_id: promptId }) })
        ]);
        return true;
    } catch (e) {
        return false;
    }
}

export async function interruptComfy(comfyUrl) {
    try {
        const base = String(comfyUrl || "").trim().replace(/\/+$/, "");
        if (!base) return false;
        const intPromise = fetch(`${base}/interrupt`, { method: "POST" }).catch(() => {});
        const clearPromise = fetch(`${base}/queue`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clear: true })
        }).catch(() => {});
        await Promise.allSettled([intPromise, clearPromise]);
        return true;
    } catch (e) {
        console.warn("[Krea-ImageGen] Failed to interrupt ComfyUI:", e);
        return false;
    }
}

function bypassLoraNodes(wf, nodeIdsToBypass) {
    if (!nodeIdsToBypass) return;
    const bypassMap = new Map();
    for (const id of nodeIdsToBypass) {
        const node = wf[id];
        if (node?.inputs) {
            bypassMap.set(String(id), {
                model: node.inputs.model,
                clip: node.inputs.clip
            });
        }
    }
    if (bypassMap.size === 0) return;

    function resolveLink(link) {
        const visited = new Set();
        while (Array.isArray(link) && bypassMap.has(String(link[0]))) {
            const currentId = String(link[0]);
            if (visited.has(currentId)) break;
            visited.add(currentId);
            const bypassed = bypassMap.get(currentId);
            const slot = link[1];
            if (slot === 0 && bypassed.model) {
                link = bypassed.model;
            } else if (slot === 1 && bypassed.clip) {
                link = bypassed.clip;
            } else {
                break;
            }
        }
        return link;
    }

    for (const otherId in wf) {
        if (bypassMap.has(String(otherId))) continue;
        const otherNode = wf[otherId];
        if (!otherNode?.inputs) continue;
        for (const inputKey in otherNode.inputs) {
            otherNode.inputs[inputKey] = resolveLink(otherNode.inputs[inputKey]);
        }
    }

    for (const id of bypassMap.keys()) {
        delete wf[id];
    }
}

// If the selected workflow lacks a ClioStyle node, wrap the positive CLIPTextEncode text
// with PrimitiveStringMultiline -> ClioStyle so the chosen style is actually applied.
function ensureClioStyleNode(wf, style, finalPrompt) {
    if (!style || style === "✨ none") return;
    if (Object.values(wf).some(n => n?.class_type === "ClioStyle")) return;

    const positiveIds = new Set();
    for (const n of Object.values(wf)) {
        const p = n?.inputs?.positive;
        if (Array.isArray(p)) positiveIds.add(String(p[0]));
    }
    let target = null;
    for (const id of positiveIds) {
        const n = wf[id];
        if (n?.class_type === "CLIPTextEncode" && typeof n.inputs?.text === "string") {
            target = n;
            break;
        }
    }
    if (!target) {
        target = Object.values(wf).find(n => n?.class_type === "CLIPTextEncode" && n.inputs?.text === finalPrompt);
    }
    if (!target) {
        console.warn("[Krea-ImageGen] Could not find positive CLIPTextEncode to inject Clio style.");
        return;
    }

    const ids = Object.keys(wf).map(Number).filter(n => !isNaN(n));
    const base = (ids.length ? Math.max(...ids) : 0) + 1;
    const primId = String(base);
    const clioId = String(base + 1);
    wf[primId] = { class_type: "PrimitiveStringMultiline", inputs: { value: target.inputs.text } };
    wf[clioId] = {
        class_type: "ClioStyle",
        inputs: {
            prompt: [primId, 0],
            style,
            template: "Style: {name}: {style}. Subject: {prompt}"
        }
    };
    target.inputs.text = [clioId, 0];
    console.log(`[Krea-ImageGen] Injected ClioStyle node for style "${style}".`);
}

export async function executeComfyWorkflow({
    promptText,
    dimensions = null,
    settings,
    onProgress = null,
    onPreview = null,
    signal = null
}) {
    if (signal?.aborted) {
        throw new DOMException("Generation aborted by user", "AbortError");
    }
    const s = settings;
    // {Name} tags → saved looks; the stored prompt keeps the tags, so ↻ picks up later edits.
    let finalPrompt = expandAppearanceTags(promptText.trim());
    let resolvedWidth = parseInt(s.imgWidth) || 1344;
    let resolvedHeight = parseInt(s.imgHeight) || 768;

    // Use AI-chosen dynamic dimensions unless user forced a fixed resolution mode
    if (s.resolutionMode !== "fixed" && dimensions) {
        const snapped = snapToKreaResolution(dimensions.width, dimensions.height);
        if (snapped) {
            if (snapped.width !== parseInt(dimensions.width) || snapped.height !== parseInt(dimensions.height)) {
                console.log(`[Krea-ImageGen] ${dimensions.width}x${dimensions.height} → ${snapped.width}x${snapped.height} (closest supported size).`);
            }
            resolvedWidth = snapped.width;
            resolvedHeight = snapped.height;
        }
    }

    // "Повышенное разрешение": the same aspect at ~1.5 MP instead of ~1 MP. Krea 2 Turbo handles up to 2 MP;
    // in tests hair, skin and fabric came out clearly finer for ~25–35% more render time.
    if (s.hiRes) {
        const k = Math.sqrt(1.5);
        resolvedWidth = (parseInt(resolvedWidth) || 1344) * k;
        resolvedHeight = (parseInt(resolvedHeight) || 768) * k;
    }

    // Snap dimensions to multiple of 16 (minimum 64) to prevent PyTorch VAE tensor mismatch crashes
    resolvedWidth = Math.max(64, Math.round((parseInt(resolvedWidth) || 1344) / 16) * 16);
    resolvedHeight = Math.max(64, Math.round((parseInt(resolvedHeight) || 768) / 16) * 16);

    // 1. Prepend LoRA Triggers
    const loraTriggers = [];
    if (s.lora1 && s.loraTrigger1) loraTriggers.push(s.loraTrigger1.trim());
    if (s.lora2 && s.loraTrigger2) loraTriggers.push(s.loraTrigger2.trim());
    if (s.lora3 && s.loraTrigger3) loraTriggers.push(s.loraTrigger3.trim());
    if (s.lora4 && s.loraTrigger4) loraTriggers.push(s.loraTrigger4.trim());

    // Old images without data-rawprompt fall back to the already-prefixed title — strip it so ↻ doesn't double it.
    let pfx = "";
    if (s.promptPrefix && s.promptPrefix.trim() !== "") {
        pfx = s.promptPrefix.trim();
        if (!pfx.endsWith(",")) pfx += ",";
    }
    const combined = loraTriggers.length ? loraTriggers.join(", ").replace(/,?$/, ",") : "";
    if (pfx && finalPrompt.startsWith(pfx)) finalPrompt = finalPrompt.slice(pfx.length).trimStart();
    if (combined && finalPrompt.startsWith(combined)) finalPrompt = finalPrompt.slice(combined.length).trimStart();

    if (combined) finalPrompt = combined + " " + finalPrompt;
    if (pfx) finalPrompt = pfx + " " + finalPrompt;

    // 2. Style: a Style Atlas style and the modifiers go into the text; a Clio style goes through
    //    the ClioStyle node below (clioNodeStyle is "✨ none" for anything that isn't Clio).
    //    Atlas may not be loaded yet when ComfyUI was started after SillyTavern.
    await ensureAtlas(s, 20000);
    finalPrompt = applyStyleToPrompt(finalPrompt, s);
    const nodeStyle = clioNodeStyle(s.clioStyle);
    const styleSource = isNoStyle(s.clioStyle) ? "none" : isAtlasId(s.clioStyle) ? "atlas" : "clio";
    const atlasStyle = styleSource === "atlas" ? findStyle(s.clioStyle) : null;
    const styleText = atlasStyle?.row ? atlasTextOf(atlasStyle.row, s.atlasTextVersion) : "";

    // 3. Load Workflow JSON
    if (!s.currentWorkflowName) {
        throw Object.assign(new Error("No ComfyUI workflow selected in Krea ImageGen settings."), { retryable: false });
    }
    const workflow = await loadWorkflowJson(s.currentWorkflowName);

    // 4. Inject Parameters into Graph
    let finalSeed = parseInt(s.customSeed);
    if (finalSeed === -1 || isNaN(finalSeed)) {
        finalSeed = Math.floor(Math.random() * 1000000000);
    }

    const loraSlots = {
        "%lora1%": { file: s.lora1, wt: s.lorawt1 },
        "%lora2%": { file: s.lora2, wt: s.lorawt2 },
        "%lora3%": { file: s.lora3, wt: s.lorawt3 },
        "%lora4%": { file: s.lora4, wt: s.lorawt4 },
    };

    const nodesToBypass = new Set();
    let seedInjected = false;

    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node.inputs) {
            let hasUnconfiguredLora = false;
            let hasConfiguredLora = false;

            for (const key in node.inputs) {
                const val = node.inputs[key];
                if (val === "%prompt%") node.inputs[key] = finalPrompt;
                if (val === "%negative_prompt%") node.inputs[key] = s.customNegative || "";
                if (val === "%seed%") { node.inputs[key] = finalSeed; seedInjected = true; }
                if (val === "%sampler%") node.inputs[key] = s.selectedSampler || "euler";
                if (val === "%model%") node.inputs[key] = s.selectedModel || "";
                if (val === "%steps%") node.inputs[key] = parseInt(s.steps) || 20;
                if (val === "%scale%") node.inputs[key] = parseFloat(s.cfg) || 7.0;
                if (val === "%denoise%") node.inputs[key] = parseFloat(s.denoise) || 1.0;
                if (val === "%width%") node.inputs[key] = resolvedWidth;
                if (val === "%height%") node.inputs[key] = resolvedHeight;
                if (val === "%batch_size%") node.inputs[key] = 1;

                if (val in loraSlots) {
                    const loraConf = loraSlots[val];
                    if (loraConf.file && loraConf.file !== "None" && loraConf.file.trim() !== "") {
                        node.inputs[key] = loraConf.file.trim();
                        hasConfiguredLora = true;
                    } else {
                        hasUnconfiguredLora = true;
                    }
                }

                if (val === "%lorawt1%") node.inputs[key] = numOr(s.lorawt1, 1.0);
                if (val === "%lorawt2%") node.inputs[key] = numOr(s.lorawt2, 1.0);
                if (val === "%lorawt3%") node.inputs[key] = numOr(s.lorawt3, 1.0);
                if (val === "%lorawt4%") node.inputs[key] = numOr(s.lorawt4, 1.0);
                if (val === "%style%" || val === "%clio_style%") node.inputs[key] = nodeStyle;
                if (val === "%style_text%") node.inputs[key] = styleText;
                if (val === "%style_source%") node.inputs[key] = styleSource;
            }

            if (hasUnconfiguredLora && hasConfiguredLora) {
                // Multi-slot stack (e.g. rgthree Lora Loader Stack) with some slots filled:
                // keep the node, mark only the empty slots as "None" so the loader skips them
                for (const key in node.inputs) {
                    if (node.inputs[key] in loraSlots) {
                        node.inputs[key] = "None";
                    }
                }
            } else if (hasUnconfiguredLora) {
                // If this is a LoraLoader with model or clip inputs, bypass it completely
                if (node.inputs.model || node.inputs.clip) {
                    nodesToBypass.add(nodeId);
                } else {
                    // Cannot bypass cleanly; set strengths to 0 so it has no effect without deleting required inputs
                    if ('strength_model' in node.inputs) node.inputs.strength_model = 0.0;
                    if ('strength_clip' in node.inputs) node.inputs.strength_clip = 0.0;
                    for (const key in node.inputs) {
                        if (node.inputs[key] in loraSlots) {
                            node.inputs[key] = "";
                        }
                    }
                }
            }

            if (node.class_type === "ClioStyle" && node.inputs) {
                node.inputs.style = nodeStyle;
            }
            if (!seedInjected && node.class_type === "KSampler" && 'seed' in node.inputs && typeof node.inputs['seed'] === 'number') {
                node.inputs.seed = finalSeed;
            }
            if (node.class_type === "EmptyLatentImage" && 'batch_size' in node.inputs) {
                node.inputs.batch_size = 1;
            }
        }
    }

    // Bypass any Lora nodes whose slots are empty/None
    bypassLoraNodes(workflow, nodesToBypass);

    // Auto-inject Clio style if the workflow has no ClioStyle node of its own
    ensureClioStyleNode(workflow, nodeStyle, finalPrompt);

    // 5. Connect WebSocket
    const clientId = makeComfyClientId();
    const ws = openComfyProgressSocket(s.comfyUrl, clientId, {
        onPreview: (blob) => {
            if (signal?.aborted) return;
            if (typeof onPreview === "function") onPreview(blob);
        },
        onProgress: (step, max) => {
            if (signal?.aborted) return;
            const pct = Math.round((step / max) * 100);
            if (typeof onProgress === "function") {
                onProgress(`Рендер… ${step}/${max} (${pct}%)`, pct);
            }
        }
    });

    try {
        if (signal?.aborted) {
            throw new DOMException("Generation aborted by user", "AbortError");
        }

        const comfyBase = String(s.comfyUrl).trim().replace(/\/+$/, "");
        const submitRes = await fetch(`${comfyBase}/prompt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: workflow, client_id: clientId }),
            signal
        });
        if (!submitRes.ok) {
            const err = new Error(`ComfyUI submission rejected: ${await submitRes.text()}`);
            // 400 = the graph itself is invalid; sending it again won't help.
            if (submitRes.status === 400) err.retryable = false;
            throw err;
        }
        const submitData = await submitRes.json();
        const promptId = submitData.prompt_id;

        // 6. Poll history for completion
        let pollCount = 0;
        let netFails = 0;
        let pollBusy = false;
        let pollInterval = null;
        let abortListener = null;

        const savedImages = await new Promise((resolve, reject) => {
            const cleanup = () => {
                if (pollInterval) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                }
                if (signal && abortListener) {
                    signal.removeEventListener("abort", abortListener);
                    abortListener = null;
                }
            };

            const handleAbort = () => {
                cleanup();
                // Skip / Stop: the job must not keep holding (or later take) the GPU.
                cancelComfyJob(comfyBase, promptId);
                reject(new DOMException("Generation aborted by user", "AbortError"));
            };

            if (signal) {
                if (signal.aborted) {
                    return handleAbort();
                }
                abortListener = handleAbort;
                signal.addEventListener("abort", abortListener, { once: true });
            }

            const fail = (message, extra = {}) => {
                cleanup();
                reject(Object.assign(new Error(message), extra));
            };

            const readHistory = async () => {
                const histRes = await fetch(`${comfyBase}/history/${promptId}`, { signal });
                if (!histRes.ok) throw new Error(`HTTP ${histRes.status}`);
                return (await histRes.json())?.[promptId] || null;
            };

            // "running" | "pending" | null. A ComfyUI restart drops the job silently: history stays empty forever.
            const queueState = async () => {
                const qRes = await fetch(`${comfyBase}/queue`, { signal });
                if (!qRes.ok) return "running";
                const q = await qRes.json();
                const has = (list) => (list || []).some(item => item?.[1] === promptId);
                return has(q.queue_running) ? "running" : has(q.queue_pending) ? "pending" : null;
            };

            pollInterval = setInterval(async () => {
                if (signal?.aborted) {
                    handleAbort();
                    return;
                }
                if (pollBusy) return; // a slow request must not overlap the next tick
                pollBusy = true;
                pollCount++;
                try {
                    if (pollCount > 300) { // 5 minutes of rendering
                        // Waiting behind other jobs in the ComfyUI queue is not a hang: keep waiting.
                        if (await queueState() === "pending") {
                            pollCount = 240;
                        } else {
                            fail("ComfyUI generation timed out (5 mins).", { stuck: true, promptId });
                            return;
                        }
                    }

                    let entry = await readHistory();
                    netFails = 0;

                    if (!entry && pollCount % 10 === 0 && !(await queueState())) {
                        entry = await readHistory(); // it may have finished between the two requests
                        if (!entry) {
                            fail("задача пропала из очереди ComfyUI (перезапуск сервера?)");
                            return;
                        }
                    }
                    if (!entry) return;

                    if (entry.status?.status_str === "error") {
                        const messages = entry.status.messages || [];
                        if (messages.some(m => m?.[0] === "execution_interrupted")) {
                            fail("прервано в ComfyUI", { retryable: false });
                            return;
                        }
                        const errMsg = messages.find(m => m?.[0] === "execution_error")?.[1];
                        fail(errMsg?.exception_message
                            ? `ComfyUI: ${String(errMsg.exception_message).trim()}`
                            : "ComfyUI завершил задачу с ошибкой.");
                        return;
                    }

                    cleanup();
                    const imgs = [];
                    for (const nid in entry.outputs) {
                        const out = entry.outputs[nid];
                        if (out.images && Array.isArray(out.images)) {
                            imgs.push(...out.images);
                        }
                    }
                    resolve(imgs);
                } catch (err) {
                    if (signal?.aborted || err.name === "AbortError") {
                        handleAbort();
                        return;
                    }
                    // Tolerate network blips, but not a server that is gone.
                    if (++netFails >= 20) fail("ComfyUI не отвечает (сервер упал или перезапускается).");
                } finally {
                    pollBusy = false;
                }
            }, 1000);
        });

        if (!savedImages || savedImages.length === 0) {
            throw new Error("ComfyUI finished but returned no output images.");
        }

        // 7. Download & Save Primary Image
        const primary = savedImages[0];
        const viewUrl = `${comfyBase}/view?filename=${encodeURIComponent(primary.filename)}&subfolder=${encodeURIComponent(primary.subfolder || '')}&type=${encodeURIComponent(primary.type || 'output')}`;
        
        const imgRes = await fetch(viewUrl, { signal });
        if (!imgRes.ok) throw new Error(`Не удалось скачать картинку из ComfyUI (HTTP ${imgRes.status}).`);
        const blob = await imgRes.blob();
        const rawBase64 = await new Promise((res) => {
            const reader = new FileReader();
            reader.onloadend = () => res(reader.result);
            reader.readAsDataURL(blob);
        });

        let cleanBase64 = rawBase64;
        let format = "png";

        if (s.compressImages) {
            cleanBase64 = await new Promise((res) => {
                const img = new Image();
                img.src = rawBase64;
                img.onload = () => {
                    const cvs = document.createElement("canvas");
                    cvs.width = img.width;
                    cvs.height = img.height;
                    cvs.getContext("2d").drawImage(img, 0, 0);
                    res(cvs.toDataURL("image/jpeg", 0.9));
                };
                img.onerror = () => res(rawBase64);
            });
            // On a decode failure the original PNG comes back — keep its extension.
            if (cleanBase64 !== rawBase64) format = "jpeg";
        }

        // In group chats there is no characterId; name2 is the character currently speaking.
        const ctx = getContext();
        const charName = ctx.characters?.[ctx.characterId]?.name || ctx.name2 || "User";
        const savedPath = await saveBase64AsFile(
            cleanBase64.split(",")[1],
            charName,
            `${charName}_Krea_${humanizedDateTime()}`,
            format
        );

        return {
            savedPath,
            finalPrompt,
            width: resolvedWidth,
            height: resolvedHeight
        };
    } finally {
        ws.close();
    }
}
