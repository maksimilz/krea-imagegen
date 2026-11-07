// ────────────────────────────────────────────────────────────────────────────
// In-Chat UI: Placeholders, Dynamic Retry Buttons, Swipes & Progress Overlay
// ────────────────────────────────────────────────────────────────────────────

import { getContext } from "../../../../extensions.js";
import { saveChat, saveChatConditional, reloadCurrentChat, updateMessageBlock } from "../../../../../script.js";
import { openKreaLightbox } from "./lightBox.js";
import { Popup, POPUP_TYPE } from "../../../../popup.js";
import { getRememberedPrompt, rememberPrompt, removePlaceholderFromChat } from "./chatStore.js";
import { openStylePicker } from "./clioStyles.js";
import { escapeHtml, escapeQuoteChars } from "./utils.js";

function decodeHtml(str) {
    if (!str) return "";
    const txt = document.createElement("textarea");
    txt.innerHTML = str;
    return txt.value;
}

// ── Progress Overlay ─────────────────────────────────────────────────────────

let pgTimer = null;
let pgStart = 0;
let pgPreviewUrl = null;

function ensureOverlay() {
    let overlay = document.getElementById("krea_progress_overlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "krea_progress_overlay";
    overlay.className = "krea-progress-overlay";
    overlay.innerHTML = `
        <div class="krea-progress-box">
            <div class="krea-pg-thumb" id="krea_pg_thumb" style="display:none;"><img id="krea_pg_thumb_img" alt="" /></div>
            <div class="krea-pg-main">
                <div class="krea-pg-top">
                    <span class="krea-pg-queue" id="krea_pg_queue" style="display:none;"></span>
                    <span class="krea-pg-queue krea-pg-waiting" id="krea_pg_waiting" style="display:none;" title="Ждут в очереди"></span>
                    <span class="krea-progress-label" id="krea_progress_lbl"></span>
                    <span class="krea-pg-time" id="krea_pg_time">0s</span>
                </div>
                <div class="krea-progress-bar-bg" id="krea_progress_bar_bg">
                    <div class="krea-progress-bar-fill" id="krea_progress_bar_fill"></div>
                </div>
            </div>
            <div class="krea-pg-actions">
                <button type="button" class="krea-pg-btn" id="krea_progress_skip_btn" title="Пропустить эту картинку и продолжить" style="display:none;"><i class="fa-solid fa-forward-step"></i></button>
                <button type="button" class="krea-pg-btn krea-pg-btn-stop" id="krea_progress_stop_btn" title="Остановить всё и освободить GPU"><i class="fa-solid fa-stop"></i></button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function tickTimer() {
    const el = document.getElementById("krea_pg_time");
    if (!el) return;
    const sec = Math.floor((Date.now() - pgStart) / 1000);
    el.textContent = sec >= 60 ? `${Math.floor(sec / 60)}м ${String(sec % 60).padStart(2, "0")}с` : `${sec}с`;
}

export function showKreaProgress(text = "Рендер Krea-2...", percent = null, onStop = null) {
    const overlay = ensureOverlay();
    const lbl = overlay.querySelector("#krea_progress_lbl");
    if (lbl) lbl.textContent = text;

    const fill = overlay.querySelector("#krea_progress_bar_fill");
    const bg = overlay.querySelector("#krea_progress_bar_bg");
    if (bg) bg.classList.toggle("indeterminate", percent === null);
    if (fill) fill.style.width = percent === null ? "100%" : `${percent}%`;

    const stopBtn = overlay.querySelector("#krea_progress_stop_btn");
    if (stopBtn && typeof onStop === "function") {
        stopBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            onStop();
        };
    }

    if (overlay.style.display !== "flex") {
        pgStart = Date.now();
        tickTimer();
        if (pgTimer) clearInterval(pgTimer);
        pgTimer = setInterval(tickTimer, 500);
    }
    overlay.style.display = "flex";
}

// Skip is shown for a batch of several images, or when more jobs wait in the queue.
let batchSkip = null;
let queueSkip = null;
let queuedCount = 0;

function syncSkipButton() {
    const skip = document.getElementById("krea_progress_skip_btn");
    if (!skip) return;
    const fn = batchSkip || (queuedCount > 0 ? queueSkip : null);
    skip.style.display = typeof fn === "function" ? "inline-flex" : "none";
    skip.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (typeof fn === "function") fn();
    };
}

// Position in a batch (e.g. 2/3) and optional "Skip" action for the current image.
export function setKreaProgressMeta({ index = 0, total = 0, onSkip = null } = {}) {
    const overlay = ensureOverlay();
    const q = overlay.querySelector("#krea_pg_queue");
    if (q) {
        q.textContent = total > 1 ? `${index}/${total}` : "";
        q.style.display = total > 1 ? "inline-flex" : "none";
    }
    batchSkip = typeof onSkip === "function" ? onSkip : null;
    syncSkipButton();
    pgStart = Date.now(); // timer is per image
    clearKreaProgressPreview();
}

/** How many jobs wait after the current one; Skip then moves on to the next. */
export function setKreaQueueInfo(count, onSkip) {
    queuedCount = Math.max(0, count || 0);
    queueSkip = typeof onSkip === "function" ? onSkip : null;
    const el = document.getElementById("krea_pg_waiting");
    if (el) {
        el.textContent = queuedCount ? `+${queuedCount} в очереди` : "";
        el.style.display = queuedCount ? "inline-flex" : "none";
    }
    syncSkipButton();
}

function clearKreaProgressPreview() {
    if (pgPreviewUrl) {
        URL.revokeObjectURL(pgPreviewUrl);
        pgPreviewUrl = null;
    }
    const thumb = document.getElementById("krea_pg_thumb");
    if (thumb) thumb.style.display = "none";
}

// Live sampler preview from ComfyUI (needs `--preview-method auto` on the ComfyUI side).
export function setKreaProgressPreview(blob) {
    const overlay = document.getElementById("krea_progress_overlay");
    if (!overlay || overlay.style.display !== "flex") return;
    const img = overlay.querySelector("#krea_pg_thumb_img");
    const thumb = overlay.querySelector("#krea_pg_thumb");
    if (!img || !thumb) return;
    const url = URL.createObjectURL(blob);
    img.src = url;
    thumb.style.display = "block";
    if (pgPreviewUrl) URL.revokeObjectURL(pgPreviewUrl);
    pgPreviewUrl = url;
}

export function bindKreaProgressStop(onStop) {
    const stopBtn = document.getElementById("krea_progress_stop_btn");
    if (stopBtn && typeof onStop === "function") {
        stopBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            onStop();
        };
    }
}

export function hideKreaProgress() {
    const overlay = document.getElementById("krea_progress_overlay");
    if (overlay) overlay.style.display = "none";
    if (pgTimer) {
        clearInterval(pgTimer);
        pgTimer = null;
    }
    clearKreaProgressPreview();
    const q = document.getElementById("krea_pg_queue");
    if (q) q.style.display = "none";
    batchSkip = null;
    syncSkipButton();
}

// ── DOM Retry & Swiping Buttons ──────────────────────────────────────────────

export function addKreaRetryButtons(msgIndex, settings, onRegenerate, isGeneratingCheck) {
    const context = getContext();
    const message = context.chat?.[msgIndex];
    if (!message) return;

    const messageNode = document.querySelector(`[mesid="${msgIndex}"]`);
    if (!messageNode) return;

    addKreaFailedButtons(msgIndex, message, messageNode);

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
        let origStyle = img.getAttribute("data-style") ?? message.extra?.krea_metadata?.[wrapperId]?.style;
        const rawPrompt = img.getAttribute("data-rawprompt") ?? message.extra?.krea_metadata?.[wrapperId]?.rawPrompt ?? prompt;

        // Position container
        wrapper.classList.add("krea-bar-host");
        wrapper.style.position = "relative";
        wrapper.style.display = "inline-block";

        const bar = document.createElement("div");
        bar.className = "krea-regen-btn krea-bar";

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
            if (origStyle !== undefined && origStyle !== null) {
                img.setAttribute("data-style", origStyle);
            }
            if (rawPrompt) {
                img.setAttribute("data-rawprompt", rawPrompt);
            }

            const counterEl = bar.querySelector(".krea-swipe-counter");
            if (counterEl) counterEl.textContent = `${currentIndex + 1}/${history.length}`;

            // Update in message.mes so reload preserves active variant
            const oldTagRegex = new RegExp(`<img[^>]*?data-kreaid="${wrapperId}"[^>]*?>`);
            const styleAttr = (origStyle !== undefined && origStyle !== null) ? ` data-style="${escapeHtml(origStyle)}"` : "";
            const rawPromptAttr = rawPrompt ? ` data-rawprompt="${escapeHtml(rawPrompt)}"` : "";
            const newImgHtml = `<img src="${escapeQuoteChars(newSrc)}" title="${escapeHtml(prompt)}" alt="KreaInline" data-kreaid="${wrapperId}" data-width="${retryWidth}" data-height="${retryHeight}" data-active-index="${currentIndex}"${styleAttr}${rawPromptAttr} style="max-width: 100%; border-radius: 8px; display: block; cursor: zoom-in;" />`;
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
            prevBtn.className = "krea-bar-btn";
            prevBtn.title = "Предыдущий вариант";
            prevBtn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); updateSwipeState(currentIndex - 1); };

            const counterEl = document.createElement("span");
            counterEl.className = "krea-swipe-counter";
            counterEl.textContent = `${currentIndex + 1}/${history.length}`;
            counterEl.classList.add("krea-bar-count");

            const nextBtn = document.createElement("span");
            nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            nextBtn.className = "krea-bar-btn";
            nextBtn.title = "Следующий вариант";
            nextBtn.onclick = (e) => { e.stopPropagation(); e.preventDefault(); updateSwipeState(currentIndex + 1); };

            bar.appendChild(prevBtn);
            bar.appendChild(counterEl);
            bar.appendChild(nextBtn);

            const sep = document.createElement("span");
            sep.className = "krea-bar-sep";
            bar.appendChild(sep);
        }

        // Regenerate Button (↻)
        const regenBtn = document.createElement("span");
        regenBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
        regenBtn.className = "krea-bar-btn krea-bar-accent";
        regenBtn.title = "Новый вариант кадра в ComfyUI (без вызова LLM). Можно нажать несколько раз — варианты встанут в очередь";

        const currentRawPrompt = () => img.getAttribute("data-rawprompt") ?? message.extra?.krea_metadata?.[wrapperId]?.rawPrompt ?? rawPrompt ?? prompt;
        // During a render the click is queued, not refused (generation.js).
        const regenerate = (extra = {}) => {
            if (typeof onRegenerate !== "function") return;
            onRegenerate({
                message,
                msgIndex,
                placeholderId: wrapperId,
                prompt,
                width: retryWidth,
                height: retryHeight,
                rawPrompt: currentRawPrompt(),
                ...extra
            });
        };

        regenBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            regenerate();
        };

        bar.appendChild(regenBtn);

        const mkBarBtn = (icon, title, onClick) => {
            const b = document.createElement("span");
            b.className = "krea-bar-btn";
            b.title = title;
            b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
            b.onclick = (e) => { e.stopPropagation(); e.preventDefault(); onClick(); };
            bar.appendChild(b);
            return b;
        };

        // A variant of this image in another style; the chat's own style stays as it is.
        mkBarBtn("fa-palette", "Вариант в другом стиле (общий стиль чата не меняется)",
            () => openStylePicker((id) => regenerate({ styleOverride: id })));

        mkBarBtn("fa-pen", "Править промт и сделать новый вариант", async () => {
            const $content = $(`
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <div style="font-size:0.85rem; color:var(--text-muted);">Измени промт — получится новый вариант этой картинки:</div>
                    <textarea class="text_pole krea-edit-area" style="height:200px; resize:vertical; font-family:monospace; font-size:0.85rem;"></textarea>
                </div>
            `);
            $content.find(".krea-edit-area").val(currentRawPrompt());
            const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Правка промта Krea-2", { okButton: "Рендер", cancelButton: "Отмена", wide: true });
            if (!(await popup.show())) return;
            const edited = String($content.find(".krea-edit-area").val() || "").replace(/\s+/g, " ").trim();
            if (!edited) return;
            regenerate({ rawPrompt: edited, edited: true });
        });

        mkBarBtn("fa-copy", "Копировать промт", async () => {
            const text = currentRawPrompt();
            try {
                await navigator.clipboard.writeText(text);
                toastr.success("Промт скопирован.");
            } catch (e) {
                toastr.warning("Нет доступа к буферу обмена.");
            }
        });

        mkBarBtn("fa-download", "Скачать картинку", () => {
            const a = document.createElement("a");
            a.href = img.getAttribute("src");
            a.download = (img.getAttribute("src") || "krea").split("/").pop();
            document.body.appendChild(a);
            a.click();
            a.remove();
        });

        wrapper.appendChild(bar);
    });
}

export function kreaRetrySweep(msgIndex, settings, onRegenerate, isGeneratingCheck) {
    [150, 600, 1500, 3000].forEach((ms) => setTimeout(() => {
        try {
            addKreaRetryButtons(msgIndex, settings, onRegenerate, isGeneratingCheck);
        } catch (e) { }
    }, ms));
}

// ST re-renders message HTML on its own (swipes, edits, other extensions), which drops the buttons
// added above. Watch the chat and re-attach them whenever a Krea image or failed block reappears.
const KREA_MARKER = '[data-krea-failed], img[alt="KreaInline"]';
let chatObserver = null;

export function observeKreaChat(getSettingsFn, onRegenerate, isGeneratingCheck) {
    const chatEl = document.getElementById("chat");
    if (!chatEl || chatObserver) return;
    const pending = new Set();
    let timer = null;
    const flush = () => {
        timer = null;
        for (const id of pending) {
            try { addKreaRetryButtons(id, getSettingsFn(), onRegenerate, isGeneratingCheck); } catch (e) { }
        }
        pending.clear();
    };
    chatObserver = new MutationObserver((records) => {
        for (const r of records) {
            for (const n of r.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (!n.matches(KREA_MARKER) && !n.querySelector(KREA_MARKER)) continue;
                const id = parseInt(n.closest(".mes[mesid]")?.getAttribute("mesid"));
                if (!isNaN(id)) pending.add(id);
            }
        }
        if (pending.size && !timer) timer = setTimeout(flush, 100);
    });
    chatObserver.observe(chatEl, { childList: true, subtree: true });
}

// ── Failed placeholders: Retry / Edit / Copy / Dismiss (prompt is never lost) ─

let failedRetryHandler = null;
export function setFailedRetryHandler(fn) {
    failedRetryHandler = fn;
}

function addKreaFailedButtons(msgIndex, message, messageNode) {
    // ST renames classes inside messages to "custom-*", so match the data attribute as well.
    messageNode.querySelectorAll("[data-krea-failed], .krea-failed, .custom-krea-failed").forEach((box) => {
        if (box.querySelector(".krea-failed-actions")) return;
        const placeholderId = box.id;
        if (!placeholderId) return;

        const spec = getRememberedPrompt(message, placeholderId, box);
        const bar = document.createElement("div");
        bar.className = "krea-failed-actions";

        const mkBtn = (icon, label, title, onClick) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "krea-failed-btn";
            b.title = title;
            b.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
            b.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            };
            bar.appendChild(b);
        };

        const retry = (s) => {
            if (typeof failedRetryHandler !== "function") return;
            if (!message.extra) message.extra = {};
            rememberPrompt(message, placeholderId, s);
            failedRetryHandler({ placeholderId, prompt: s.prompt, width: s.width, height: s.height });
        };

        if (spec?.prompt) {
            mkBtn("fa-rotate-right", "Повторить", "Рендер заново по сохранённому промту (без LLM)", () => retry(spec));

            mkBtn("fa-pen", "Править", "Изменить промт и запустить рендер", async () => {
                const $content = $(`
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <div style="font-size:0.85rem; color:var(--text-muted);">Измени промт Krea-2:</div>
                        <textarea class="text_pole krea-edit-area" style="height:180px; resize:vertical; font-family:monospace; font-size:0.85rem;"></textarea>
                    </div>
                `);
                $content.find(".krea-edit-area").val(spec.prompt);
                const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Правка промта Krea-2", { okButton: "Рендер", cancelButton: "Отмена", wide: true });
                const ok = await popup.show();
                if (!ok) return;
                const edited = String($content.find(".krea-edit-area").val() || "").trim();
                if (edited) retry({ ...spec, prompt: edited });
            });

            mkBtn("fa-copy", "Копировать", "Копировать сохранённый промт", async () => {
                try {
                    await navigator.clipboard.writeText(spec.prompt);
                    toastr.success("Промт скопирован.");
                } catch (e) {
                    toastr.warning("Нет доступа к буферу обмена.");
                }
            });
        }

        mkBtn("fa-xmark", "Убрать", "Удалить эту плашку", () => removePlaceholderFromChat(placeholderId));

        box.appendChild(bar);
    });
}
