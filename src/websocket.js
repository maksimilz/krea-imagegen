// ────────────────────────────────────────────────────────────────────────────
// ComfyUI Realtime WebSocket Progress Tracker
// ────────────────────────────────────────────────────────────────────────────

export function makeComfyClientId() {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
    } catch (e) { /* fallback */ }
    return "krea-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function openComfyProgressSocket(comfyUrl, clientId, { onProgress, onNode } = {}) {
    let ws = null;
    let closed = false;

    try {
        const base = String(comfyUrl || "").trim().replace(/\/+$/, "");
        const wsUrl = base.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:")
            + "/ws?clientId=" + encodeURIComponent(clientId);
        ws = new WebSocket(wsUrl);

        ws.onmessage = (ev) => {
            if (closed) return;
            if (typeof ev.data !== "string") return; // ignore binary previews
            let msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (!msg || !msg.type) return;

            if (msg.type === "progress" && msg.data && typeof msg.data.max === "number" && msg.data.max > 0) {
                if (typeof onProgress === "function") {
                    onProgress(msg.data.value || 0, msg.data.max);
                }
            } else if (msg.type === "executing" && msg.data) {
                if (typeof onNode === "function") {
                    onNode(msg.data.node ?? null);
                }
            }
        };

        ws.onerror = () => { /* Silent fallback to polling */ };
    } catch (e) {
        console.debug("[Krea-ImageGen] WebSocket unavailable, falling back to history poll.", e);
        ws = null;
    }

    return {
        close() {
            closed = true;
            try { if (ws) ws.close(); } catch (e) { }
            ws = null;
        }
    };
}
