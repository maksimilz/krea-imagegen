import { getContext } from "../../../../extensions.js";
import { saveChatConditional, updateMessageBlock } from "../../../../../script.js";
import { Popup, POPUP_TYPE } from "../../../../popup.js";
import { EXTENSION_NAME } from "./data.js";
import { getSettings, escapeHtml, escapeQuoteChars } from "./utils.js";
import { extractKreaTags } from "./tagParser.js";
import { executeComfyWorkflow, interruptComfy, cancelComfyJob } from "./comfy.js";
import { styleLabel, isNoStyle } from "./styleLibrary.js";
import { rememberChatStyleIfMissing } from "./chatStyle.js";
import {
    showKreaProgress,
    hideKreaProgress,
    kreaRetrySweep,
    setFailedRetryHandler,
    setKreaProgressMeta,
    setKreaProgressPreview,
    setKreaQueueInfo
} from "./chatUi.js";
import {
    rememberPrompt,
    buildFailedTag,
    placeholderRegex,
    removePlaceholderFromChat,
    patchInactiveChat
} from "./chatStore.js";

let currentAbortController = null;
let isGenerating = false;
let isProcessingIncoming = false;
let itemController = null;   // aborts only the image being rendered (Skip)
let skipRequested = false;

// ── Job queue ─────────────────────────────────────────────────────────────────
// Every render goes through here: replies with tags, ↻ variants, retries of failed images.
// While one runs, the next ones wait in order instead of being refused, so ↻ pressed three
// times gives three variants. A job remembers the chat it was asked in and is skipped if
// another chat is open when its turn comes (it edits the live message first).

const MAX_QUEUE = 20;
const jobQueue = [];   // { kind, label, placeholderId, snap, run }
let pumping = false;

function enqueue(job) {
    if (isGenerating || pumping) {
        if (jobQueue.length >= MAX_QUEUE) {
            toastr.warning(`Krea-2: очередь заполнена (${MAX_QUEUE}). Дождись или останови.`);
            return false;
        }
        jobQueue.push(job);
        toastr.info(`Krea-2: ${job.label} — в очереди (${jobQueue.length}).`);
        refreshQueueMarks();
    } else {
        jobQueue.push(job);
    }
    pump();
    return true;
}

async function pump() {
    if (pumping) return;
    pumping = true;
    try {
        while (jobQueue.length && !isGenerating) {
            const job = jobQueue.shift();
            refreshQueueMarks();
            if (job.snap && !isSameChat(job.snap)) {
                toastr.info(`Krea-2: ${job.label} — пропущено, открыт другой чат.`);
                continue;
            }
            try {
                await job.run();
            } catch (e) {
                console.error(`[${EXTENSION_NAME}] Queued job failed:`, e);
            }
        }
    } finally {
        pumping = false;
        refreshQueueMarks();
    }
}

function clearQueue() {
    const n = jobQueue.length;
    jobQueue.length = 0;
    refreshQueueMarks();
    return n;
}

// "⏳ в очереди #N" on images waiting for a variant, and the queue size in the progress window.
function refreshQueueMarks() {
    try {
        document.querySelectorAll(".krea-queue-badge").forEach(el => el.remove());
        jobQueue.forEach((job, i) => {
            if (!job.placeholderId) return;
            const host = document.getElementById(job.placeholderId);
            if (!host) return;
            let badge = host.querySelector(".krea-queue-badge");
            if (!badge) {
                badge = document.createElement("span");
                badge.className = "krea-queue-badge";
                host.appendChild(badge);
                badge.textContent = `⏳ в очереди #${i + 1}`;
            } else {
                badge.textContent += `, #${i + 1}`;
            }
        });
    } catch (e) { /* DOM may be mid-render */ }
    setKreaQueueInfo(jobQueue.length, skipCurrentGeneration);
}

export const queueLength = () => jobQueue.length;

// ── Run lifecycle ─────────────────────────────────────────────────────────────

function beginRun({ incoming = false } = {}) {
    isGenerating = true;
    isProcessingIncoming = incoming;
    skipRequested = false;
    currentAbortController = new AbortController();
    setQuickButtonGenerating(true);
    return currentAbortController;
}

// Only the run that owns the state releases it, so a late `finally` can't clobber a newer run.
// The queue moves on by itself: pump() awaits each job.
function endRun(ctl) {
    if (currentAbortController !== ctl) return;
    isGenerating = false;
    isProcessingIncoming = false;
    skipRequested = false;
    currentAbortController = null;
    itemController = null;
    setQuickButtonGenerating(false);
    hideKreaProgress();
}

const isAborted = (e, ctl) => e?.name === "AbortError" || !!ctl?.signal?.aborted;

// Controller for one image: follows the run-wide Stop, but can also be aborted alone (Skip).
function linkItemController() {
    const ctl = new AbortController();
    const parent = currentAbortController?.signal;
    const relay = () => ctl.abort();
    if (parent) {
        if (parent.aborted) ctl.abort();
        else parent.addEventListener("abort", relay, { once: true });
    }
    itemController = ctl;
    return {
        signal: ctl.signal,
        dispose: () => {
            parent?.removeEventListener("abort", relay);
            if (itemController === ctl) itemController = null;
        }
    };
}

// ── Auto-retry of a crashed render ────────────────────────────────────────────

function waitAbortable(ms, signal) {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("Generation aborted by user", "AbortError"));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * executeComfyWorkflow that re-submits the job when it breaks (ComfyUI error / OOM / restart / timeout /
 * network), up to `autoRetries` times. Stop, Skip and errors marked `retryable: false` are thrown at once.
 */
async function renderWithRetry(opts) {
    const { signal, onProgress } = opts;
    const s = getSettings();
    const retries = Math.max(0, parseInt(s.autoRetries ?? 2) || 0);
    for (let attempt = 0; ; attempt++) {
        try {
            return await executeComfyWorkflow(opts);
        } catch (e) {
            if (isAborted(e, { signal }) || e?.retryable === false || attempt >= retries) throw e;

            console.warn(`[${EXTENSION_NAME}] Render failed (attempt ${attempt + 1}/${retries + 1}), retrying:`, e);
            // A timed-out job may still hold the GPU — free it before queueing the copy.
            if (e?.stuck) await cancelComfyJob(s.comfyUrl, e.promptId);

            const delay = Math.min(2000 * 2 ** attempt, 15000);
            const label = `Сбой: ${e.message}. Повтор ${attempt + 1}/${retries} через ${Math.round(delay / 1000)}с…`;
            if (typeof onProgress === "function") onProgress(label, null);
            toastr.warning(`Krea-2: ${e.message}. Повтор ${attempt + 1}/${retries}…`);
            await waitAbortable(delay, signal);
        }
    }
}

/** Skips the image being rendered; a batch or the queue goes on with the next one. */
export async function skipCurrentGeneration() {
    if (!isGenerating || !itemController) return;
    skipRequested = true;
    // The render's abort handler cancels its own ComfyUI job (queued or running).
    try { itemController.abort(); } catch (e) {}
    toastr.info("Krea-2: текущая картинка пропущена.");
}

function setQuickButtonGenerating(isGen) {
    const quickBtn = document.getElementById("krea_quick_btn");
    if (!quickBtn) return;
    if (isGen) {
        quickBtn.classList.add("krea-generating");
        quickBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
        quickBtn.title = "⏹ Остановить генерацию Krea-2 и очистить очередь (освободить GPU)";
    } else {
        quickBtn.classList.remove("krea-generating");
        quickBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
        quickBtn.title = "Krea-2: сгенерировать картинку для текущей сцены";
    }
}

/** Stop: the current render and everything waiting in the queue. */
export async function stopCurrentGeneration() {
    console.log(`[${EXTENSION_NAME}] ⏹ Stopping current generation...`);
    const dropped = clearQueue();
    if (currentAbortController) {
        // The running job unwinds on abort and releases the state in its own `finally`.
        try { currentAbortController.abort(); } catch (e) {}
    } else {
        // Nobody owns the state — clear a stuck flag.
        isGenerating = false;
        isProcessingIncoming = false;
        setQuickButtonGenerating(false);
    }
    await interruptComfy(getSettings().comfyUrl);
    hideKreaProgress();
    toastr.info(`Krea-2: генерация остановлена, GPU свободен${dropped ? `, очередь очищена (${dropped})` : ""}.`);
}

// ── Chat targeting ────────────────────────────────────────────────────────────

function chatIdOf(ctx) {
    return ctx.chatId || (typeof ctx.getCurrentChatId === "function" ? ctx.getCurrentChatId() : null);
}

// Identifies the chat a render started in (by id, not by array: ST reuses one `chat` array for every chat).
function snapshotChat() {
    const ctx = getContext();
    const char = ctx.groupId ? null : ctx.characters?.[ctx.characterId];
    return {
        chatId: chatIdOf(ctx),
        groupId: ctx.groupId ?? null,
        charName: char?.name,
        charAvatar: char?.avatar
    };
}

function isSameChat(snap) {
    const ctx = getContext();
    if (snap.groupId !== (ctx.groupId ?? null)) return false;
    const id = chatIdOf(ctx);
    return !snap.chatId || !id || snap.chatId === id;
}

// The chat may have been reloaded since the render started (left and reopened), which replaces
// message objects — so the target is looked up again by placeholder id.
function resolveLive(placeholderId, fallback) {
    const chat = getContext().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        if (typeof chat[i]?.mes === "string" && chat[i].mes.includes(placeholderId)) return { msg: chat[i], idx: i };
    }
    return { msg: chat[fallback.idx] || fallback.msg, idx: fallback.idx };
}

/**
 * Applies `mutate(msg) → html` to the message holding the placeholder: in the open chat when it is
 * still the render's chat, otherwise directly in that chat's file.
 */
async function applyToTarget(snap, placeholderId, fallback, mutate) {
    if (!isSameChat(snap)) {
        const ok = await patchInactiveChat(snap, placeholderId, mutate);
        if (!ok) toastr.warning("Krea-2: не удалось записать результат в фоновый чат.");
        return { live: false };
    }
    const { msg, idx } = resolveLive(placeholderId, fallback);
    const html = mutate(msg);
    try {
        if (html) $(`#${placeholderId}`).replaceWith(html);
    } catch (e) {}
    await saveChatConditional();
    updateMessageBlock(idx, msg);
    kreaRetrySweep(idx, getSettings(), handleRegenerate, () => isGenerating);
    refreshQueueMarks();
    return { live: true, msg, idx };
}

// ── Message content ───────────────────────────────────────────────────────────

function syncSwipe(msg) {
    if (Array.isArray(msg.swipes) && typeof msg.swipe_id === "number") {
        msg.swipes[msg.swipe_id] = msg.mes;
    }
}

// Swaps the placeholder block for `html` in mes/display_text (appending when it is gone and asked to).
function replaceBlock(msg, placeholderId, html, { appendIfMissing = false } = {}) {
    const swap = (text) => text.replace(placeholderRegex(placeholderId), () => html);
    const mes = msg.mes || "";
    const next = swap(mes);
    msg.mes = (next !== mes || !appendIfMissing) ? next : `${mes}\n\n${html}`;
    if (msg.extra && typeof msg.extra.display_text === "string") {
        const text = msg.extra.display_text;
        const swapped = swap(text);
        msg.extra.display_text = (swapped !== text || !appendIfMissing) ? swapped : msg.mes;
    }
    syncSwipe(msg);
}

function spinnerHtml(placeholderId, label, style = "") {
    const styleAttr = style ? ` style="${style}"` : "";
    return `<div id="${placeholderId}" class="krea-img-placeholder"${styleAttr}><i class="fa-solid fa-spinner fa-spin"></i> ${label}</div>`;
}

function buildImgTag(placeholderId, { src, title, width, height, activeIndex, style, rawPrompt }) {
    return `<!-- krea-inline-start:${placeholderId} --><div id="${placeholderId}" class="krea-img-wrapper">
<img src="${escapeQuoteChars(src)}" title="${escapeHtml(title)}" alt="KreaInline" data-kreaid="${placeholderId}" data-width="${width}" data-height="${height}" data-active-index="${activeIndex}" data-style="${escapeHtml(style)}" data-rawprompt="${escapeHtml(rawPrompt)}" style="max-width:100%; border-radius:8px; display:block; cursor:zoom-in;" />
</div><!-- krea-inline-end:${placeholderId} -->`;
}

// Records a finished render (variant history + metadata) and swaps the placeholder for the image.
function commitImage(msg, placeholderId, result, { style, rawPrompt }) {
    if (!msg.extra) msg.extra = {};
    if (!msg.extra.krea_history) msg.extra.krea_history = {};
    if (!msg.extra.krea_metadata) msg.extra.krea_metadata = {};
    msg.extra.krea_metadata[placeholderId] = { style, rawPrompt };

    const history = Array.isArray(msg.extra.krea_history[placeholderId]) ? msg.extra.krea_history[placeholderId] : [];
    if (!history.includes(result.savedPath)) history.push(result.savedPath);
    msg.extra.krea_history[placeholderId] = history;

    const html = buildImgTag(placeholderId, {
        src: result.savedPath,
        title: result.finalPrompt,
        width: result.width,
        height: result.height,
        activeIndex: history.indexOf(result.savedPath),
        style,
        rawPrompt
    });
    replaceBlock(msg, placeholderId, html, { appendIfMissing: true });
    return { html, variants: history.length };
}

function failBlock(msg, placeholderId, reason) {
    const html = buildFailedTag(placeholderId, msg, reason);
    replaceBlock(msg, placeholderId, html);
    return html;
}

// Puts the latest saved variant back; null when the image has no history yet.
function restoreLastVariant(msg, placeholderId, { title, width, height, style, rawPrompt }) {
    const history = msg.extra?.krea_history?.[placeholderId];
    if (!Array.isArray(history) || !history.length) return null;
    const html = buildImgTag(placeholderId, {
        src: history[history.length - 1],
        title,
        width,
        height,
        activeIndex: history.length - 1,
        style,
        rawPrompt
    });
    replaceBlock(msg, placeholderId, html);
    return html;
}

const progressFor = () => (lbl, pct) => showKreaProgress(lbl, pct, () => stopCurrentGeneration());

// ── 1. Retry of a failed placeholder (no LLM call) ───────────────────────────

export function renderSinglePlaceholder(placeholderId, prompt, width, height) {
    return enqueue({
        kind: "single",
        label: "повтор картинки",
        placeholderId,
        snap: snapshotChat(),
        run: () => runSinglePlaceholder(placeholderId, prompt, width, height),
    });
}

async function runSinglePlaceholder(placeholderId, prompt, width, height) {
    const s = getSettings();
    const chat = getContext().chat || [];
    const targetIdx = chat.findLastIndex(m => typeof m?.mes === "string" && m.mes.includes(placeholderId));
    if (targetIdx === -1) {
        toastr.error("Не найдено сообщение для этой плашки.");
        return;
    }
    const targetMsg = chat[targetIdx];
    const fallback = { msg: targetMsg, idx: targetIdx };
    const snap = snapshotChat();
    const style = s.clioStyle || "";

    const ctl = beginRun();
    rememberChatStyleIfMissing(s);
    rememberPrompt(targetMsg, placeholderId, { prompt, width, height, style: s.clioStyle });

    const spinner = spinnerHtml(placeholderId, "[Рендер сцены Krea-2…]");
    replaceBlock(targetMsg, placeholderId, spinner);
    try { $(`#${placeholderId}`).replaceWith(spinner); } catch (e) {}
    await saveChatConditional();
    updateMessageBlock(targetIdx, targetMsg);

    showKreaProgress("Рендер сцены Krea-2…", null, () => stopCurrentGeneration());
    setKreaProgressMeta({});
    const itemLink = linkItemController();

    try {
        const result = await renderWithRetry({
            promptText: prompt,
            dimensions: (width && height) ? { width, height } : null,
            settings: s,
            onProgress: progressFor(),
            onPreview: setKreaProgressPreview,
            signal: itemLink.signal
        });

        const res = await applyToTarget(snap, placeholderId, fallback,
            (msg) => commitImage(msg, placeholderId, result, { style, rawPrompt: prompt }).html);
        toastr.success(res.live ? "Картинка Krea-2 готова!" : "Картинка Krea-2 готова (в фоновом чате)!");
    } catch (e) {
        const skipped = skipRequested && !ctl.signal.aborted;
        const aborted = isAborted(e, ctl) || skipped;
        if (aborted) {
            console.log(`[${EXTENSION_NAME}] Single render ${skipped ? "skipped" : "aborted"}.`);
        } else {
            console.error(`[${EXTENSION_NAME}] Single render error:`, e);
            toastr.error(`Ошибка Krea: ${e.message}`);
        }
        await applyToTarget(snap, placeholderId, fallback,
            (msg) => failBlock(msg, placeholderId, skipped ? "пропущено" : aborted ? "отменено" : e.message));
    } finally {
        itemLink.dispose();
        endRun(ctl);
    }
}

// ── 2. Tags in a fresh character message ─────────────────────────────────────

// `force`: the quick button renders the tags even while auto-generation is switched off.
export function handleIncomingMessage(messageId, { force = false } = {}) {
    const s = getSettings();
    if (!s.enabled && !force) return;
    const chat = getContext().chat;
    if (!chat || !chat.length) return;
    const idx = (typeof messageId === "number" && messageId >= 0 && messageId < chat.length) ? messageId : chat.length - 1;
    const msg = chat[idx];
    // Every rendered character message passes through here: queue only the ones with new tags.
    if (!msg || msg.is_user || msg.is_system || !extractKreaTags(msg.mes).length) return;
    enqueue({
        kind: "incoming",
        label: "картинки ответа",
        placeholderId: null,
        snap: snapshotChat(),
        run: () => runIncomingMessage(messageId, { force }),
    });
}

async function runIncomingMessage(messageId, { force = false } = {}) {
    const s = getSettings();
    if (!s.enabled && !force) return;

    const chat = getContext().chat;
    if (!chat || !chat.length) return;

    const msgIndex = (typeof messageId === "number" && messageId >= 0 && messageId < chat.length)
        ? messageId
        : chat.length - 1;
    const lastMsg = chat[msgIndex];
    if (!lastMsg || lastMsg.is_user || lastMsg.is_system) return;

    const matches = extractKreaTags(lastMsg.mes);
    if (!matches || matches.length === 0) return;

    const snap = snapshotChat();
    const fallback = { msg: lastMsg, idx: msgIndex };
    const style = s.clioStyle || "";
    const ctl = beginRun({ incoming: true });
    rememberChatStyleIfMissing(s);

    try {
        const maxImages = Math.max(1, parseInt(s.imageCount) || 1);
        const activeMatches = matches.slice(0, maxImages);
        const batchId = Date.now();
        const idOf = (i) => `krea-img-${batchId}-${i}`;

        let modifiedMes = lastMsg.mes;

        // Replace tags from right to left so indices remain stable
        for (let i = matches.length - 1; i >= 0; i--) {
            const m = matches[i];
            if (i < maxImages) {
                rememberPrompt(lastMsg, idOf(i), { prompt: m.prompt, width: m.width, height: m.height, style: s.clioStyle });
                const placeholder = spinnerHtml(idOf(i), `[Рендер сцены Krea-2 (${i + 1}/${activeMatches.length})…]`);
                modifiedMes = modifiedMes.substring(0, m.index) + placeholder + modifiedMes.substring(m.index + m.length);
            } else {
                // Cut surplus tags exceeding limit
                modifiedMes = modifiedMes.substring(0, m.index) + modifiedMes.substring(m.index + m.length);
            }
        }

        lastMsg.mes = modifiedMes.trim();
        if (lastMsg.extra && typeof lastMsg.extra.display_text === "string") {
            lastMsg.extra.display_text = lastMsg.mes;
        }
        syncSwipe(lastMsg);
        await saveChatConditional();
        updateMessageBlock(msgIndex, lastMsg);

        const cancelFrom = async (from) => {
            for (let rem = from; rem < activeMatches.length; rem++) {
                await applyToTarget(snap, idOf(rem), fallback, (msg) => failBlock(msg, idOf(rem), "отменено"));
            }
        };

        // Sequentially process each active match with ComfyUI
        for (let idx = 0; idx < activeMatches.length; idx++) {
            if (ctl.signal.aborted) {
                console.log(`[${EXTENSION_NAME}] Loop aborted, stopping remaining images.`);
                await cancelFrom(idx);
                break;
            }

            const item = activeMatches[idx];
            const placeholderId = idOf(idx);
            let promptText = item.prompt;

            // Preview prompt popup if requested
            if (s.previewPrompt) {
                const $content = $(`
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <div style="font-size:0.85rem; color:var(--text-muted);">Проверь или поправь промт Krea-2:</div>
                        <textarea class="text_pole krea-preview-area" style="height:140px; resize:vertical; font-family:monospace; font-size:0.85rem;"></textarea>
                    </div>
                `);
                $content.find(".krea-preview-area").val(promptText);

                const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Промт Krea-2", { okButton: "Рендер в ComfyUI", cancelButton: "Пропустить", wide: true });
                const confirmed = await popup.show();
                if (!confirmed) {
                    await removePlaceholderFromChat(placeholderId);
                    continue;
                }
                promptText = String($content.find(".krea-preview-area").val() || "").trim() || promptText;
                rememberPrompt(resolveLive(placeholderId, fallback).msg, placeholderId, { prompt: promptText, width: item.width, height: item.height, style: s.clioStyle });
            }

            showKreaProgress("Подготовка Krea-2…", null, () => stopCurrentGeneration());
            setKreaProgressMeta({
                index: idx + 1,
                total: activeMatches.length,
                onSkip: activeMatches.length > 1 ? skipCurrentGeneration : null
            });
            const itemLink = linkItemController();

            try {
                const result = await renderWithRetry({
                    promptText,
                    dimensions: (item.width && item.height) ? { width: item.width, height: item.height } : null,
                    settings: s,
                    onProgress: progressFor(),
                    onPreview: setKreaProgressPreview,
                    signal: itemLink.signal
                });

                const res = await applyToTarget(snap, placeholderId, fallback,
                    (msg) => commitImage(msg, placeholderId, result, { style, rawPrompt: promptText }).html);
                const counter = `(${idx + 1}/${activeMatches.length})`;
                toastr.success(res.live ? `Картинка Krea-2 ${counter} готова!` : `Картинка Krea-2 ${counter} готова (в фоновом чате)!`);
            } catch (e) {
                const wasSkipped = skipRequested && !ctl.signal.aborted;
                skipRequested = false;
                const aborted = !wasSkipped && isAborted(e, ctl);
                if (aborted) {
                    console.log(`[${EXTENSION_NAME}] Generation aborted for placeholder ${placeholderId}`);
                } else if (!wasSkipped) {
                    console.error(`[${EXTENSION_NAME}] Render failed:`, e);
                    toastr.error(`Ошибка Krea: ${e.message}`);
                }
                const reason = wasSkipped ? "пропущено" : aborted ? "отменено" : e.message;
                await applyToTarget(snap, placeholderId, fallback, (msg) => failBlock(msg, placeholderId, reason));
                if (aborted) {
                    await cancelFrom(idx + 1);
                    break;
                }
            } finally {
                itemLink.dispose();
                hideKreaProgress();
            }
        }
    } finally {
        endRun(ctl);
    }
}

// ── 3. Direct Regeneration (↻) — NO LLM CALL! ─────────────────────────────────

/**
 * A new variant of a rendered image. `rawPrompt` may be an edited prompt (✎) and `styleOverride`
 * a style for this one variant (the global / chat style stays as it is). Arguments are taken at
 * the click, so ↻ pressed several times queues several variants.
 */
export function handleRegenerate(args) {
    const s = getSettings();
    const style = args.styleOverride ?? (s.clioStyle || "");
    const label = args.styleOverride !== undefined
        ? `вариант в стиле «${isNoStyle(style) ? "без стиля" : styleLabel(style)}»`
        : args.edited ? "вариант с правленым промтом" : "новый вариант";
    return enqueue({
        kind: "regenerate",
        label,
        placeholderId: args.placeholderId,
        snap: snapshotChat(),
        run: () => runRegenerate({ ...args, style }),
    });
}

async function runRegenerate({ message, msgIndex, placeholderId, prompt, width, height, rawPrompt, style }) {
    const s = getSettings();
    // The chat may have been re-rendered or reopened since the click: work on the live message.
    const live = resolveLive(placeholderId, { msg: message, idx: msgIndex });
    message = live.msg;
    msgIndex = live.idx;
    if (!message || typeof message.mes !== "string" || !message.mes.includes(placeholderId)) {
        toastr.warning("Krea-2: картинка для нового варианта не найдена.");
        return;
    }

    const ctl = beginRun();
    const snap = snapshotChat();
    const fallback = { msg: message, idx: msgIndex };
    const renderSettings = { ...s, clioStyle: style };
    // What the image on screen was made with, to put it back unchanged if this variant fails.
    const prevMeta = { ...(message.extra?.krea_metadata?.[placeholderId] || {}) };

    const effectiveRawPrompt = (rawPrompt ?? prompt ?? "");
    rememberPrompt(message, placeholderId, { prompt: effectiveRawPrompt, width, height, style });

    // Swap the image for a spinner now that the generation lock is held
    const placeholder = spinnerHtml(placeholderId, "[Генерация нового варианта Krea-2…]", "color:#06b6d4; font-style:italic; margin:10px 0;");
    const inlineRegex = new RegExp(`<!-- krea-inline-start:${placeholderId} -->[\\s\\S]*?<!-- krea-inline-end:${placeholderId} -->`, "g");
    const toSpinner = (text) => text.includes(`krea-inline-start:${placeholderId}`)
        ? text.replace(inlineRegex, () => placeholder)
        : text.replace(placeholderRegex(placeholderId), () => placeholder);
    message.mes = toSpinner(message.mes || "");
    if (message.extra && typeof message.extra.display_text === "string") {
        message.extra.display_text = toSpinner(message.extra.display_text);
    }
    syncSwipe(message);
    try { $(`#${placeholderId}`).replaceWith(placeholder); } catch (e) {}
    await saveChatConditional();
    updateMessageBlock(msgIndex, message);
    refreshQueueMarks();

    showKreaProgress("Перегенерация варианта в ComfyUI…", null, () => stopCurrentGeneration());
    setKreaProgressMeta({});
    const itemLink = linkItemController();

    try {
        const result = await renderWithRetry({
            promptText: effectiveRawPrompt,
            dimensions: { width, height },
            settings: renderSettings,
            onProgress: progressFor(),
            onPreview: setKreaProgressPreview,
            signal: itemLink.signal
        });

        let variants = 0;
        const res = await applyToTarget(snap, placeholderId, fallback, (msg) => {
            const out = commitImage(msg, placeholderId, result, { style, rawPrompt: effectiveRawPrompt });
            variants = out.variants;
            return out.html;
        });
        const styleNote = !isNoStyle(style) ? `, стиль: ${styleLabel(style)}` : "";
        toastr.success(`Новый вариант готов${res.live ? "" : " в фоновом чате"}${styleNote} (в истории: ${variants})`);
    } catch (e) {
        const skipped = skipRequested && !ctl.signal.aborted;
        const aborted = isAborted(e, ctl) || skipped;
        if (aborted) {
            console.log(`[${EXTENSION_NAME}] Regeneration ${skipped ? "skipped" : "aborted"}.`);
            toastr.info(skipped ? "Krea-2: вариант пропущен." : "Krea-2: перегенерация отменена.");
        } else {
            console.error(`[${EXTENSION_NAME}] Regeneration failed:`, e);
            toastr.error(`Перегенерация не удалась: ${e.message}`);
        }

        // Restore the previous variant so the spinner is never left stuck
        await applyToTarget(snap, placeholderId, fallback, (msg) =>
            restoreLastVariant(msg, placeholderId, {
                title: prompt, width, height,
                style: prevMeta.style ?? style,
                rawPrompt: prevMeta.rawPrompt ?? effectiveRawPrompt,
            })
            ?? failBlock(msg, placeholderId, aborted ? "отменено" : e.message));
    } finally {
        itemLink.dispose();
        endRun(ctl);
    }
}

export const isGeneratingNow = () => isGenerating;
export const isProcessingNow = () => isProcessingIncoming;

// "Retry" on a failed placeholder re-renders from the saved prompt (no LLM call).
setFailedRetryHandler(({ placeholderId, prompt, width, height }) =>
    renderSinglePlaceholder(placeholderId, prompt, width, height));
