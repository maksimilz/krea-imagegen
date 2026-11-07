// ────────────────────────────────────────────────────────────────────────────
// "Подобрать под чат": the story model reads this chat (card + history come with a quiet
// generation) and the user's wishes, and picks styles from the library. The answer is shown
// as preview cards; a click sets the style (and, with per-chat styles on, stores it in the chat).
// The prompt text and the answer parsing live in styleLibrary.js (pure, tested in node).
// ────────────────────────────────────────────────────────────────────────────

import { getContext } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { Popup, POPUP_TYPE } from "../../../../popup.js";
import { getSettings, escapeHtml } from "./utils.js";
import { getUnifiedStyles, buildStylePickPrompt, parseStylePickAnswer, thumbUrlFor, shortDesc, findStyle, PICK_COUNT } from "./styleLibrary.js";

const SOURCE_LABEL = { clio: "Clio", atlas: "Atlas" };
let busy = false;

function hasOpenChat(ctx) {
    return !!(ctx.chatId || (typeof ctx.getCurrentChatId === "function" && ctx.getCurrentChatId()));
}

async function askWishes(s, all) {
    const $content = $(`
        <div class="krea-ai-ask">
            <div class="krea-ai-hint">ИИ посмотрит карточку персонажа и историю этого чата и предложит ${PICK_COUNT} стилей. Пожелания необязательны.</div>
            <textarea class="text_pole krea-ai-wishes" rows="3" placeholder="например: мрачно, как манхва, глянцевая кожа, без фотореализма"></textarea>
            <label class="krea-check"><input type="checkbox" class="krea-ai-piconly" /> <span>Только стили с картинкой <small class="krea-ai-size"></small></span></label>
        </div>
    `);
    const $wishes = $content.find(".krea-ai-wishes").val(s.stylePickWishes || "");
    const $picOnly = $content.find(".krea-ai-piconly").prop("checked", s.stylePickPicOnly !== false);
    const pool = () => ($picOnly.is(":checked") ? all.filter(x => x.hasThumb) : all);
    const showSize = () => {
        const list = pool();
        // ~3.5 characters per token for a list of English names
        const tokens = Math.round(buildStylePickPrompt("", list).length / 3.5 / 100) * 100;
        $content.find(".krea-ai-size").text(`${list.length} стилей в запросе, ≈${tokens.toLocaleString("ru-RU")} токенов + сам чат`);
    };
    $picOnly.on("change", showSize);
    showSize();

    const popup = new Popup($content, POPUP_TYPE.CONFIRM, "", { okButton: "Подобрать", cancelButton: "Отмена", wide: true });
    setTimeout(() => $wishes.trigger("focus"), 50);
    if (!(await popup.show())) return null;

    s.stylePickWishes = String($wishes.val() || "").trim();
    s.stylePickPicOnly = $picOnly.is(":checked");
    saveSettingsDebounced();
    return { wishes: s.stylePickWishes, list: pool() };
}

function showResults(picks, s, onPick) {
    const $box = $(`<div class="krea-ai-results"><div class="krea-ai-hint">Нажми на стиль, чтобы выбрать его${s.perChatStyle ? " для этого чата" : ""}.</div><div class="krea-ai-grid"></div></div>`);
    const $grid = $box.find(".krea-ai-grid");
    const popup = new Popup($box, POPUP_TYPE.TEXT, "", { okButton: "Закрыть", wide: true, large: true, allowVerticalScrolling: true });

    picks.forEach((p, i) => {
        const entry = getUnifiedStyles().find(x => x.id === p.id);
        const src = entry?.source || "clio";
        const desc = shortDesc(entry?.prompt || findStyle(p.id)?.prompt || "", 140);
        const thumb = entry?.hasThumb
            ? `<img class="krea-clio-tile-img" loading="lazy" src="${escapeHtml(thumbUrlFor(p.id, s.comfyUrl))}" alt="" />`
            : `<div class="krea-style-ph"><span>${escapeHtml(desc)}</span></div>`;
        const $tile = $(`
            <div class="krea-clio-tile krea-ai-tile ${s.clioStyle === p.id ? "active" : ""}" title="${escapeHtml(desc)}">
                <div class="krea-clio-tile-img-box">
                    ${thumb}
                    <span class="krea-clio-tile-section">${i + 1}. ${escapeHtml(entry?.section || "")}</span>
                    <span class="krea-style-src krea-style-src-${src}">${SOURCE_LABEL[src]}</span>
                </div>
                <div class="krea-clio-tile-label">${escapeHtml(p.name)}</div>
                ${p.why ? `<div class="krea-ai-why">${escapeHtml(p.why)}</div>` : ""}
            </div>
        `);
        $tile.find("img").on("error", function () { $(this).replaceWith(`<div class="krea-style-ph"><span>${escapeHtml(desc)}</span></div>`); });
        $tile.on("click", () => {
            onPick(p.id);
            toastr.success(`Стиль: ${p.name}`);
            popup.complete(1);
        });
        $grid.append($tile);
    });
    return popup.show();
}

/** Asks for wishes, lets the story model pick styles, shows them. `onPick(id)` sets the chosen one. */
export async function openStyleAiPicker({ onPick }) {
    if (busy) return toastr.info("Подбор стиля уже идёт…");
    const ctx = getContext();
    if (!hasOpenChat(ctx)) return toastr.warning("Открой чат: стиль подбирается под него.");
    const s = getSettings();
    const all = getUnifiedStyles();
    if (!all.length) return toastr.warning("Библиотека стилей ещё не загрузилась.");

    const ask = await askWishes(s, all);
    if (!ask) return;

    const prompt = buildStylePickPrompt(ask.wishes, ask.list, s.clioFavorites || []);
    busy = true;
    $("#krea_style_ai_btn, #krea_clio_modal_ai_btn").prop("disabled", true);
    const wait = toastr.info("ИИ подбирает стили под чат…", "Krea-2", { timeOut: 0, extendedTimeOut: 0 });
    let answer = "";
    try {
        // Quiet generation: the card and the chat history come with it; injection.js leaves quiet runs alone.
        answer = await ctx.generateQuietPrompt({ quietPrompt: prompt, removeReasoning: true });
    } catch (e) {
        console.error("[Krea-ImageGen] Style pick failed:", e);
        toastr.error(`Не удалось подобрать стиль: ${e.message || e}`);
        return;
    } finally {
        busy = false;
        $("#krea_style_ai_btn, #krea_clio_modal_ai_btn").prop("disabled", false);
        toastr.clear(wait);
    }

    const picks = parseStylePickAnswer(answer, ask.list);
    console.log("[Krea-ImageGen] Style pick answer:", answer, picks);
    if (!picks.length) {
        const $raw = $(`<div class="krea-ai-results"><div class="krea-ai-hint">Не удалось найти в ответе названия стилей из библиотеки. Ответ модели:</div><pre class="krea-ai-raw"></pre></div>`);
        $raw.find(".krea-ai-raw").text(String(answer || "(пусто)"));
        await new Popup($raw, POPUP_TYPE.TEXT, "", { okButton: "Закрыть", wide: true }).show();
        return;
    }
    await showResults(picks, s, onPick);
}
