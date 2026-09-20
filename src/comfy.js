// ────────────────────────────────────────────────────────────────────────────
// ComfyUI REST API & Workflow Execution Engine
// ────────────────────────────────────────────────────────────────────────────

import { getRequestHeaders } from "../../../../../script.js";
import { saveBase64AsFile } from "../../../../utils.js";
import { humanizedDateTime } from "../../../../RossAscends-mods.js";
import { getContext } from "../../../../extensions.js";
import { makeComfyClientId, openComfyProgressSocket } from "./websocket.js";

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

export async function executeComfyWorkflow({
    promptText,
    dimensions = null,
    settings,
    onProgress = null
}) {
    const s = settings;
    let finalPrompt = promptText.trim();
    let resolvedWidth = parseInt(s.imgWidth) || 1344;
    let resolvedHeight = parseInt(s.imgHeight) || 768;

    // Use AI-chosen dynamic dimensions unless user forced a fixed resolution mode
    if (s.resolutionMode !== "fixed" && dimensions && dimensions.width && dimensions.height) {
        resolvedWidth = parseInt(dimensions.width);
        resolvedHeight = parseInt(dimensions.height);
    }

    // 1. Prepend LoRA Triggers
    const loraTriggers = [];
    if (s.lora1 && s.loraTrigger1) loraTriggers.push(s.loraTrigger1.trim());
    if (s.lora2 && s.loraTrigger2) loraTriggers.push(s.loraTrigger2.trim());
    if (s.lora3 && s.loraTrigger3) loraTriggers.push(s.loraTrigger3.trim());
    if (s.lora4 && s.loraTrigger4) loraTriggers.push(s.loraTrigger4.trim());

    if (loraTriggers.length > 0) {
        let combined = loraTriggers.join(", ");
        if (!combined.endsWith(",")) combined += ",";
        finalPrompt = combined + " " + finalPrompt;
    }

    // 2. Prepend Positive Prefix
    if (s.promptPrefix && s.promptPrefix.trim() !== "") {
        let pfx = s.promptPrefix.trim();
        if (!pfx.endsWith(",")) pfx += ",";
        finalPrompt = pfx + " " + finalPrompt;
    }

    // 3. Load Workflow JSON
    if (!s.currentWorkflowName) {
        throw new Error("No ComfyUI workflow selected in Krea ImageGen settings.");
    }
    const workflow = await loadWorkflowJson(s.currentWorkflowName);

    // 4. Inject Parameters into Graph
    let finalSeed = parseInt(s.customSeed);
    if (finalSeed === -1 || isNaN(finalSeed)) {
        finalSeed = Math.floor(Math.random() * 1000000000);
    }

    let seedInjected = false;
    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node.inputs) {
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

                if (val === "%lora1%") node.inputs[key] = s.lora1 || "None";
                if (val === "%lora2%") node.inputs[key] = s.lora2 || "None";
                if (val === "%lora3%") node.inputs[key] = s.lora3 || "None";
                if (val === "%lora4%") node.inputs[key] = s.lora4 || "None";
                if (val === "%lorawt1%") node.inputs[key] = parseFloat(s.lorawt1) || 1.0;
                if (val === "%lorawt2%") node.inputs[key] = parseFloat(s.lorawt2) || 1.0;
                if (val === "%lorawt3%") node.inputs[key] = parseFloat(s.lorawt3) || 1.0;
                if (val === "%lorawt4%") node.inputs[key] = parseFloat(s.lorawt4) || 1.0;
            }
            if (!seedInjected && node.class_type === "KSampler" && 'seed' in node.inputs && typeof node.inputs['seed'] === 'number') {
                node.inputs.seed = finalSeed;
            }
            if (node.class_type === "EmptyLatentImage" && 'batch_size' in node.inputs) {
                node.inputs.batch_size = 1;
            }
        }
    }

    // 5. Connect WebSocket
    const clientId = makeComfyClientId();
    const ws = openComfyProgressSocket(s.comfyUrl, clientId, {
        onProgress: (step, max) => {
            const pct = Math.round((step / max) * 100);
            if (typeof onProgress === "function") {
                onProgress(`Rendering... ${step}/${max} (${pct}%)`, pct);
            }
        }
    });

    try {
        const comfyBase = String(s.comfyUrl).trim().replace(/\/+$/, "");
        const submitRes = await fetch(`${comfyBase}/prompt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: workflow, client_id: clientId })
        });
        if (!submitRes.ok) {
            throw new Error(`ComfyUI submission rejected: ${await submitRes.text()}`);
        }
        const submitData = await submitRes.json();
        const promptId = submitData.prompt_id;

        // 6. Poll history for completion
        let pollCount = 0;
        const savedImages = await new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
                pollCount++;
                if (pollCount > 300) { // 5 minutes timeout
                    clearInterval(interval);
                    reject(new Error("ComfyUI generation timed out (5 mins)."));
                    return;
                }

                try {
                    const histRes = await fetch(`${comfyBase}/history/${promptId}`);
                    if (!histRes.ok) return;
                    const history = await histRes.json();
                    if (history[promptId]) {
                        clearInterval(interval);
                        const imgs = [];
                        for (const nid in history[promptId].outputs) {
                            const out = history[promptId].outputs[nid];
                            if (out.images && Array.isArray(out.images)) {
                                imgs.push(...out.images);
                            }
                        }
                        resolve(imgs);
                    }
                } catch (err) {
                    /* keep polling */
                }
            }, 1000);
        });

        if (!savedImages || savedImages.length === 0) {
            throw new Error("ComfyUI finished but returned no output images.");
        }

        // 7. Download & Save Primary Image
        const primary = savedImages[0];
        const viewUrl = `${comfyBase}/view?filename=${encodeURIComponent(primary.filename)}&subfolder=${encodeURIComponent(primary.subfolder || '')}&type=${encodeURIComponent(primary.type || 'output')}`;
        
        const imgRes = await fetch(viewUrl);
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
            format = "jpeg";
        }

        const charName = getContext().characters?.[getContext().characterId]?.name || "User";
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
