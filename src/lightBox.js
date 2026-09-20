// ────────────────────────────────────────────────────────────────────────────
// Krea ImageGen — Fullscreen Zoom & Pan Lightbox Modal
// ────────────────────────────────────────────────────────────────────────────

let activeLightbox = null;

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function openKreaLightbox({
    src,
    title = "",
    history = [],
    activeIndex = 0,
    onIndexChange = null
} = {}) {
    if (activeLightbox) {
        closeKreaLightbox();
    }

    const imageList = Array.isArray(history) && history.length > 0 ? history : (src ? [src] : []);
    let currentIdx = Math.max(0, Math.min(activeIndex, imageList.length - 1));

    let zoom = 1;
    let panX = 0;
    let panY = 0;

    let isPointerDown = false;
    let isDragging = false;
    let didMove = false;
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;

    const overlay = document.createElement("div");
    overlay.className = "krea-lightbox-overlay";
    overlay.id = "krea_lightbox_overlay";

    const getCurrSrc = () => imageList[currentIdx] || src || "";

    overlay.innerHTML = `
        <div class="krea-lb-backdrop"></div>
        <div class="krea-lb-header">
            <div class="krea-lb-left">
                ${imageList.length > 1 ? `<div class="krea-lb-counter"><i class="fa-solid fa-images"></i> <span id="krea_lb_counter_txt">${currentIdx + 1} / ${imageList.length}</span></div>` : ""}
                ${title ? `<button type="button" class="krea-lb-btn krea-lb-prompt-toggle" title="Toggle Prompt"><i class="fa-solid fa-align-left"></i> <span>Prompt</span></button>` : ""}
            </div>
            <div class="krea-lb-actions">
                <button type="button" class="krea-lb-btn" id="krea_lb_zoom_in" title="Zoom In (+)"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                <button type="button" class="krea-lb-btn" id="krea_lb_zoom_out" title="Zoom Out (-)"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
                <button type="button" class="krea-lb-btn" id="krea_lb_zoom_reset" title="Fit (0)"><i class="fa-solid fa-compress"></i> <span>Fit</span></button>
                <button type="button" class="krea-lb-btn" id="krea_lb_download" title="Download Image"><i class="fa-solid fa-download"></i></button>
                <button type="button" class="krea-lb-btn krea-lb-close" id="krea_lb_close" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>

        <div class="krea-lb-viewport">
            ${imageList.length > 1 ? `<button type="button" class="krea-lb-nav-btn krea-lb-prev" title="Previous Variant (Left Arrow)"><i class="fa-solid fa-chevron-left"></i></button>` : ""}
            <div class="krea-lb-stage">
                <img class="krea-lb-image" id="krea_lb_img" src="${escapeHtml(getCurrSrc())}" alt="Krea Full Image" draggable="false" />
            </div>
            ${imageList.length > 1 ? `<button type="button" class="krea-lb-nav-btn krea-lb-next" title="Next Variant (Right Arrow)"><i class="fa-solid fa-chevron-right"></i></button>` : ""}
        </div>

        ${title ? `
        <div class="krea-lb-prompt-drawer" id="krea_lb_prompt_drawer" style="display:none;">
            <div class="krea-lb-prompt-header">
                <span><i class="fa-solid fa-wand-magic-sparkles" style="color:#06b6d4;"></i> Krea-2 Prompt</span>
                <button type="button" class="krea-lb-btn" id="krea_lb_copy_prompt"><i class="fa-solid fa-copy"></i> Copy</button>
            </div>
            <div class="krea-lb-prompt-text">${escapeHtml(title)}</div>
        </div>` : ""}
    `;

    document.body.appendChild(overlay);

    const imgEl = overlay.querySelector("#krea_lb_img");
    const stageEl = overlay.querySelector(".krea-lb-stage");
    const counterTxt = overlay.querySelector("#krea_lb_counter_txt");
    const promptDrawer = overlay.querySelector("#krea_lb_prompt_drawer");

    const updateTransform = (withTransition = true) => {
        if (!imgEl) return;
        imgEl.style.transition = withTransition ? "transform 0.18s cubic-bezier(0.2, 0, 0, 1), opacity 0.15s ease" : "none";
        imgEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        imgEl.style.cursor = zoom > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in";
        if (stageEl) {
            stageEl.style.cursor = zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default";
        }
    };

    const setZoom = (newZoom, cursorStageX = null, cursorStageY = null, animate = true) => {
        const prevZoom = zoom;
        const targetZoom = Math.max(1, Math.min(8, newZoom));

        if (targetZoom <= 1.02) {
            zoom = 1;
            panX = 0;
            panY = 0;
        } else {
            if (cursorStageX !== null && cursorStageY !== null) {
                const factor = targetZoom / prevZoom;
                panX = cursorStageX - (cursorStageX - panX) * factor;
                panY = cursorStageY - (cursorStageY - panY) * factor;
            } else {
                const factor = targetZoom / prevZoom;
                panX = panX * factor;
                panY = panY * factor;
            }
            zoom = targetZoom;
        }
        updateTransform(animate);
    };

    const resetZoom = (animate = true) => {
        zoom = 1;
        panX = 0;
        panY = 0;
        updateTransform(animate);
    };

    // Initialize transform
    resetZoom(false);

    const setVariant = (idx) => {
        if (!imageList.length) return;
        if (idx < 0) idx = imageList.length - 1;
        if (idx >= imageList.length) idx = 0;
        currentIdx = idx;
        const newSrc = imageList[currentIdx];
        if (imgEl) {
            imgEl.style.opacity = "0.4";
            imgEl.onload = () => { imgEl.style.opacity = "1"; };
            imgEl.src = newSrc;
        }
        if (counterTxt) counterTxt.textContent = `${currentIdx + 1} / ${imageList.length}`;
        resetZoom(false);
        if (typeof onIndexChange === "function") {
            onIndexChange(currentIdx);
        }
    };

    // Events
    overlay.querySelector(".krea-lb-backdrop")?.addEventListener("click", closeKreaLightbox);
    overlay.querySelector("#krea_lb_close")?.addEventListener("click", closeKreaLightbox);

    overlay.querySelector("#krea_lb_zoom_in")?.addEventListener("click", () => setZoom(zoom * 1.35));
    overlay.querySelector("#krea_lb_zoom_out")?.addEventListener("click", () => setZoom(zoom / 1.35));
    overlay.querySelector("#krea_lb_zoom_reset")?.addEventListener("click", () => resetZoom(true));

    overlay.querySelector(".krea-lb-prev")?.addEventListener("click", () => setVariant(currentIdx - 1));
    overlay.querySelector(".krea-lb-next")?.addEventListener("click", () => setVariant(currentIdx + 1));

    overlay.querySelector(".krea-lb-prompt-toggle")?.addEventListener("click", () => {
        if (!promptDrawer) return;
        const isHidden = promptDrawer.style.display === "none";
        promptDrawer.style.display = isHidden ? "flex" : "none";
    });

    overlay.querySelector("#krea_lb_copy_prompt")?.addEventListener("click", () => {
        navigator.clipboard.writeText(title || "").then(() => {
            if (typeof toastr !== "undefined" && toastr.success) {
                toastr.success("Prompt copied to clipboard!");
            }
        });
    });

    overlay.querySelector("#krea_lb_download")?.addEventListener("click", () => {
        const link = document.createElement("a");
        link.href = getCurrSrc();
        link.download = `krea_${Date.now()}.png`;
        link.click();
    });

    // Mouse wheel zoom centered on cursor
    stageEl?.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.2 : 0.83;
        const rect = stageEl.getBoundingClientRect();
        const cx = e.clientX - (rect.left + rect.width / 2);
        const cy = e.clientY - (rect.top + rect.height / 2);
        setZoom(zoom * delta, cx, cy, true);
    }, { passive: false });

    // Drag to pan & Click to zoom / close
    stageEl?.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        if (e.target.closest("button") || e.target.closest(".krea-lb-prompt-drawer")) return;

        isPointerDown = true;
        isDragging = false;
        didMove = false;
        startX = e.clientX;
        startY = e.clientY;
        startPanX = panX;
        startPanY = panY;
    });

    const onMouseMove = (e) => {
        if (!isPointerDown) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!didMove && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            didMove = true;
            if (zoom > 1) {
                isDragging = true;
            }
        }

        if (isDragging) {
            panX = startPanX + dx;
            panY = startPanY + dy;
            updateTransform(false);
        }
    };

    const onMouseUp = (e) => {
        if (!isPointerDown) return;
        isPointerDown = false;

        if (isDragging) {
            isDragging = false;
            updateTransform(true);
            return;
        }

        // Handle single click (not drag)
        if (!didMove) {
            if (e.target === stageEl) {
                // Clicked on empty backdrop area around image
                if (zoom > 1) {
                    resetZoom(true);
                } else {
                    closeKreaLightbox();
                }
            } else if (e.target === imgEl) {
                // Clicked directly on image
                if (zoom <= 1.05) {
                    // Zoom in smoothly around click point
                    const rect = stageEl.getBoundingClientRect();
                    const cx = e.clientX - (rect.left + rect.width / 2);
                    const cy = e.clientY - (rect.top + rect.height / 2);
                    setZoom(2.5, cx, cy, true);
                } else {
                    // Zoom back to fit
                    resetZoom(true);
                }
            }
        }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    // Double click on image toggles zoom
    imgEl?.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (zoom > 1.05) {
            resetZoom(true);
        } else {
            const rect = stageEl.getBoundingClientRect();
            const cx = e.clientX - (rect.left + rect.width / 2);
            const cy = e.clientY - (rect.top + rect.height / 2);
            setZoom(2.5, cx, cy, true);
        }
    });

    // Keyboard navigation
    const keyHandler = (e) => {
        if (e.key === "Escape") closeKreaLightbox();
        else if (e.key === "ArrowLeft") setVariant(currentIdx - 1);
        else if (e.key === "ArrowRight") setVariant(currentIdx + 1);
        else if (e.key === "0") resetZoom(true);
        else if (e.key === "+" || e.key === "=") setZoom(zoom * 1.35);
        else if (e.key === "-") setZoom(zoom / 1.35);
    };
    window.addEventListener("keydown", keyHandler);

    // Fade in
    requestAnimationFrame(() => {
        overlay.classList.add("krea-lb-open");
    });

    activeLightbox = {
        close() {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            window.removeEventListener("keydown", keyHandler);
            overlay.classList.remove("krea-lb-open");
            setTimeout(() => { overlay.remove(); }, 250);
            activeLightbox = null;
        }
    };
}

export function closeKreaLightbox() {
    if (activeLightbox) {
        activeLightbox.close();
    }
}
