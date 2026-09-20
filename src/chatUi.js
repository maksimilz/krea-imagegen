// ────────────────────────────────────────────────────────────────────────────
// In-Chat UI: Placeholders, Dynamic Retry Buttons, Swipes & Progress Overlay
// ────────────────────────────────────────────────────────────────────────────

import { getContext } from "../../../../extensions.js";
import { saveChat, saveChatConditional, reloadCurrentChat, updateMessageBlock } from "../../../../../script.js";
import { openKreaLightbox } from "./lightBox.js";

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function decodeHtml(str) {
    if (!str) return "";
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
}

// ── Progress Overlay ─────────────────────────────────────────────────────────

export function showKreaProgress(text = "Rendering Krea-2 Image...", percent = null) {
    let overlay = document.getElementById("krea_progress_overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "krea_progress_overlay";
        overlay.className = "krea-progress-overlay";
        overlay.innerHTML = `
            <div class="krea-progress-box">
                <div class="krea-progress-spinner"><i class="fa-solid fa-spinner fa-spin"></i></div>
                <div class="krea-progress-label" id="krea_progress_lbl">${escapeHtml(text)}</div>
                <div class="krea-progress-bar-bg" id="krea_progress_bar_bg" style="display:${percent !== null ? 'block' : 'none'};">
                    <div class="krea-progress-bar-fill" id="krea_progress_bar_fill" style="width:${percent || 0}%;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    } else {
        const lbl = overlay.querySelector("#krea_progress_lbl");
        if (lbl) lbl.textContent = text;
        const bg = overlay.querySelector("#krea_progress_bar_bg");
        const fill = overlay.querySelector("#krea_progress_bar_fill");
        if (percent !== null) {
            if (bg) bg.style.display = "block";
            if (fill) fill.style.width = `${percent}%`;
        }
    }
    overlay.style.display = "flex";
}

export function hideKreaProgress() {
    const overlay = document.getElementById("krea_progress_overlay");
    if (overlay) overlay.style.display = "none";
}

// ── DOM Retry & Swiping Buttons ──────────────────────────────────────────────

export function addKreaRetryButtons(msgIndex, settings, onRegenerate) {
    const context = getContext();
    const message = context.chat?.[msgIndex];
    if (!message) return;

    const messageNode = document.querySelector(`[mesid="${msgIndex}"]`);
    if (!messageNode) return;

    const images = messageNode.querySelectorAll('img[alt="KreaInline"]');
    if (images.length === 0) return;

    images.forEach((img) => {
        const wrapper = img.closest("div");
        if (!wrapper) return;

        if (wrapper.querySelector(".krea-regen-btn")) return; // already added

        const wrapperId = img.getAttribute("data-kreaid") || img.dataset?.kreaid || wrapper.id || "";
        if (!wrapperId) return;

        let prompt = decodeHtml(img.getAttribute("title") || "");
        let retryWidth = parseInt(img.getAttribute("data-width")) || 1344;
        let retryHeight = parseInt(img.getAttribute("data-height")) || 768;

        // Position container
        wrapper.style.position = "relative";
        wrapper.style.display = "inline-block";

        const bar = document.createElement("div");
        bar.className = "krea-regen-btn";
        bar.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(10, 10, 16, 0.85);
            color: #06b6d4;
            border-radius: 8px;
            padding: 4px 8px;
            font-size: 12px;
            z-index: 10;
            border: 1px solid rgba(6, 182, 212, 0.4);
            backdrop-filter: blur(8px);
            user-select: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            transition: opacity 0.2s ease;
        `;

        let history = (message.extra && message.extra.krea_history && Array.isArray(message.extra.krea_history[wrapperId]))
            ? message.extra.krea_history[wrapperId]
            : [];

        const currentSrc = img.getAttribute("src");
        if (currentSrc && !history.includes(currentSrc)) {
            history.push(currentSrc);
            if (!message.extra) message.extra = {};
            if (!message.extra.krea_history) message.extra.krea_history = {};
            message.extra.krea_history[wrapperId] = history;
        }

        let currentIndex = parseInt(img.getAttribute("data-active-index") || "0");
        if (isNaN(currentIndex) || currentIndex < 0 || currentIndex >= history.length) {
            currentIndex = history.indexOf(currentSrc);
            if (currentIndex === -1) currentIndex = 0;
        }

        const updateSwipeState = async (newIdx) => {
            if (!history.length) return;
            if (newIdx < 0) newIdx = history.length - 1;
            if (newIdx >= history.length) newIdx = 0;
            currentIndex = newIdx;
            const newSrc = history[currentIndex];

            img.setAttribute("src", newSrc);
            img.setAttribute("data-active-index", String(currentIndex));

            const counterEl = bar.querySelector(".krea-swipe-counter");
            if (counterEl) counterEl.textContent = `${currentIndex + 1}/${history.length}`;

            // Update in message.mes so reload preserves active variant
            const oldTagRegex = new RegExp(`<img[^>]*?data-kreaid="${wrapperId}"[^>]*?>`);
            const newImgHtml = `<img src="${newSrc}" title="${escapeHtml(prompt)}" alt="KreaInline" data-kreaid="${wrapperId}" data-width="${retryWidth}" data-height="${retryHeight}" data-active-index="${currentIndex}" style="max-width: 100%; border-radius: 8px; display: block; cursor: zoom-in;" />`;
            if (message.mes && message.mes.match(oldTagRegex)) {
                message.mes = message.mes.replace(oldTagRegex, newImgHtml);
                if (message.extra && typeof message.extra.display_text === "string") {
                    message.extra.display_text = message.extra.display_text.replace(oldTagRegex, newImgHtml);
                }
                if (Array.isArray(message.swipes) && typeof message.swipe_id === "number") {
                    message.swipes[message.swipe_id] = message.mes;
                }
                await (typeof saveChatConditional === "function" ? saveChatConditional() : saveChat());
            }
        };

        // Lightbox Zoom on Click
        img.style.cursor = "zoom-in";
        img.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            openKreaLightbox({
                src: img.getAttribute("src"),
                title: prompt,
                history: history,
                activeIndex: currentIndex,
                onIndexChange: (idx) => updateSwipeState(idx)
            });
        };

        // Swiping Arrows
        if (history.length > 1) {
            const prevBtn = document.createElement("span");
            prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
            prevBtn.style.cssText = "cursor:pointer; padding:2px 5px; opacity:0.85; transition:0.15s;";
            prevBtn.title = "Previous variant (swipe left)";
            prevBtn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); updateSwipeState(currentIndex - 1); };

            const counterEl = document.createElement("span");
            counterEl.className = "krea-swipe-counter";
            counterEl.textContent = `${currentIndex + 1}/${history.length}`;
            counterEl.style.cssText = "font-weight:bold; font-size:11px; color:#fff; min-width:26px; text-align:center;";

            const nextBtn = document.createElement("span");
            nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            nextBtn.style.cssText = "cursor:pointer; padding:2px 5px; opacity:0.85; transition:0.15s;";
            nextBtn.title = "Next variant (swipe right)";
            nextBtn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); updateSwipeState(currentIndex + 1); };

            bar.appendChild(prevBtn);
            bar.appendChild(counterEl);
            bar.appendChild(nextBtn);

            const sep = document.createElement("span");
            sep.style.cssText = "width:1px; height:12px; background:rgba(255,255,255,0.25); margin:0 3px;";
            bar.appendChild(sep);
        }

        // Regenerate Button (↻)
        const regenBtn = document.createElement("span");
        regenBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
        regenBtn.style.cssText = "cursor:pointer; padding:2px 4px; color:#06b6d4; font-size:13px;";
        regenBtn.title = "Regenerate this frame in ComfyUI (No LLM call!)";

        regenBtn.onclick = async (e) => {
            e.stopPropagation();
            e.preventDefault();

            // Replace image back to placeholder
            const regenRegex = new RegExp(`<!-- krea-inline-start:${wrapperId} -->[\\s\\S]*?<!-- krea-inline-end:${wrapperId} -->`, "g");
            const placeholder = `<div id="${wrapperId}" class="krea-img-placeholder" style="color:#06b6d4; font-style:italic; margin:10px 0;"><i class="fa-solid fa-spinner fa-spin"></i> [Generating new Krea-2 variant...]</div>`;

            if (message.mes && message.mes.includes(`krea-inline-start:${wrapperId}`)) {
                message.mes = message.mes.replace(regenRegex, placeholder);
                if (message.extra && typeof message.extra.display_text === "string") {
                    message.extra.display_text = message.extra.display_text.replace(regenRegex, placeholder);
                }
                if (Array.isArray(message.swipes) && typeof message.swipe_id === "number") {
                    message.swipes[message.swipe_id] = message.mes;
                }
            } else {
                return;
            }

            try {
                const $wrap = $(`#${wrapperId}`);
                if ($wrap.length) {
                    $wrap.replaceWith(placeholder);
                }
            } catch (domErr) {}

            await (typeof saveChatConditional === "function" ? saveChatConditional() : saveChat());
            if (typeof updateMessageBlock === "function") {
                updateMessageBlock(msgIndex, message);
            } else {
                reloadCurrentChat();
            }

            if (typeof onRegenerate === "function") {
                onRegenerate({
                    message,
                    msgIndex,
                    placeholderId: wrapperId,
                    prompt,
                    width: retryWidth,
                    height: retryHeight
                });
            }
        };

        bar.appendChild(regenBtn);
        wrapper.appendChild(bar);
    });
}

export function kreaRetrySweep(msgIndex, settings, onRegenerate) {
    [150, 600, 1500, 3000].forEach((ms) => setTimeout(() => {
        try {
            addKreaRetryButtons(msgIndex, settings, onRegenerate);
        } catch (e) { }
    }, ms));
}
