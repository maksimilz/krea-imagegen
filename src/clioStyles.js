import { saveSettingsDebounced } from "../../../../../script.js";
import { EXTENSION_FOLDER } from "./data.js";
import { getSettings, escapeHtml } from "./utils.js";
import {
    NO_STYLE, RANDOM, MOD_CATEGORIES, isNoStyle, isAtlasId, styleLabel, setClioStyles, loadAtlas, atlasStatus,
    getUnifiedStyles, findStyle, thumbUrlFor, modsFor, shortDesc, onLibraryChange, refreshAtlasThumbs,
} from "./styleLibrary.js";
import { saveChatStyle, getChatStyle } from "./chatStyle.js";
import { openStyleAiPicker } from "./stylePicker.js";

const MAX_RECENT = 16;
const PAGE = 240;
const SOURCE_LABEL = { clio: "Clio", atlas: "Atlas" };

// ── Style gallery: Clio + Style Atlas in one list (see styleLibrary.js) ──
let clioStylesCache = null;

export async function loadClioStyles() {
    if (clioStylesCache && clioStylesCache.length > 0) return clioStylesCache;
    const s = getSettings();
    try {
        const res = await fetch(`/scripts/extensions/${EXTENSION_FOLDER}/src/styles.json`);
        if (res.ok) {
            clioStylesCache = await res.json();
            setClioStyles(clioStylesCache);
            return clioStylesCache;
        }
    } catch (e) { /* ignore */ }

    try {
        const base = String(s.comfyUrl || "http://127.0.0.1:8000").trim().replace(/\/+$/, "");
        const res = await fetch(`${base}/clio_style/styles.json`);
        if (res.ok) {
            clioStylesCache = await res.json();
            setClioStyles(clioStylesCache);
            return clioStylesCache;
        }
    } catch (e) { /* ignore */ }

    return [];
}

// Per-image mode: the gallery is reused to choose a style for ONE image (does not touch the global style).
let pickCallback = null;
let openModalRef = null;
let refreshUiRef = null;

/** Redraws the style card and the modifier selects (after a chat switch brought another style). */
export function refreshStyleUi() {
    if (typeof refreshUiRef === "function") refreshUiRef();
}

export function openStylePicker(onPick) {
    if (typeof openModalRef !== "function") {
        toastr.warning("Галерея стилей ещё не готова.");
        return;
    }
    pickCallback = onPick;
    openModalRef();
}

export async function initClioStyleUi() {
    const s = getSettings();
    if (!Array.isArray(s.clioFavorites)) s.clioFavorites = [];
    if (!Array.isArray(s.clioRecent)) s.clioRecent = [];
    if (!s.styleMods || typeof s.styleMods !== "object") s.styleMods = {};

    await loadClioStyles();
    let styles = getUnifiedStyles();
    const thumbOf = (id) => thumbUrlFor(id, s.comfyUrl);

    const isFav = (id) => s.clioFavorites.includes(id);

    const pushRecent = (id) => {
        if (isNoStyle(id)) return;
        s.clioRecent = [id, ...s.clioRecent.filter(n => n !== id)].slice(0, MAX_RECENT);
    };

    const setGlobalStyle = (id) => {
        s.clioStyle = id;
        pushRecent(id);
        saveSettingsDebounced();
        saveChatStyle(s);
        updateCard();
    };

    // ── Settings card ──
    const updateCard = () => {
        const cur = s.clioStyle || NO_STYLE;
        const none = isNoStyle(cur);
        $("#krea_clio_fav_btn i")
            .toggleClass("fa-solid", !none && isFav(cur))
            .toggleClass("fa-regular", none || !isFav(cur));
        const forChat = !!(s.perChatStyle && getChatStyle());
        $("#krea_chat_style_note").toggle(forChat);
        if (none) {
            $("#krea_clio_style_badge").text("Выкл").removeClass("on");
            $("#krea_clio_card_name").text("Без стиля (промт как есть)");
            $("#krea_clio_card_desc").text("Промт уходит без подстановки стиля.");
            $("#krea_clio_card_img").hide();
            $("#krea_clio_card_img_none").show();
            return;
        }
        const found = findStyle(cur);
        const src = isAtlasId(cur) ? "atlas" : "clio";
        $("#krea_clio_style_badge").text("Вкл").addClass("on");
        $("#krea_clio_card_name").text(`${styleLabel(cur)} · ${SOURCE_LABEL[src]}`);
        const secPrefix = found?.section ? `[${found.section}] ` : "";
        $("#krea_clio_card_desc").text(found?.prompt ? secPrefix + shortDesc(found.prompt, 220) : `Стиль ${SOURCE_LABEL[src]}`);
        const $img = $("#krea_clio_card_img");
        $img.attr("src", thumbOf(cur)).off("error").on("error", function () {
            $(this).hide();
            $("#krea_clio_card_img_none").show();
        }).off("load").on("load", function () {
            $("#krea_clio_card_img_none").hide();
            $(this).show();
        });
    };

    // ── Style Atlas: status line and modifiers ──
    const renderAtlasBlock = () => {
        const st = atlasStatus();
        const $status = $("#krea_atlas_status");
        if (!st.loaded) {
            $status.html(`<span class="krea-chip" title="${escapeHtml(st.error || "")}">Style Atlas не подключён — показаны только стили Clio</span>
                <button type="button" id="krea_atlas_retry" class="menu_button krea-btn" title="Попробовать снова"><i class="fa-solid fa-rotate"></i></button>`);
            $("#krea_atlas_retry").off("click").on("click", async () => {
                await loadAtlas(s.comfyUrl, { force: true });
                refreshLibrary();
            });
            $("#krea_atlas_block").hide();
            return;
        }
        const clioCount = styles.filter(x => x.source === "clio").length;
        const atlasCount = styles.length - clioCount;
        $status.html(`<span class="krea-chip krea-chip-ok">Clio ${clioCount} + Style Atlas ${atlasCount}</span>
            <span class="krea-chip" title="Стили Atlas с одинаковым названием скрыты — вместо них стили Clio, они написаны под Krea 2">без дублей: −${st.styles - atlasCount}</span>
            <span class="krea-chip">превью Atlas: ${st.thumbs}</span>`);

        const $mods = $("#krea_style_mods").empty();
        MOD_CATEGORIES.forEach(cat => {
            const names = modsFor(cat);
            if (!names.length) return;
            const cur = s.styleMods[cat] || "";
            const $field = $(`<div class="krea-field"><label>${escapeHtml(cat)}</label></div>`);
            const $sel = $(`<select class="text_pole">
                <option value="">—</option>
                <option value="${escapeHtml(RANDOM)}">${escapeHtml(RANDOM)}</option>
                ${names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")}
            </select>`).val(cur);
            $sel.on("change", function () {
                const v = $(this).val();
                if (v) s.styleMods[cat] = v; else delete s.styleMods[cat];
                saveSettingsDebounced();
                saveChatStyle(s);
            });
            $mods.append($field.append($sel));
        });
        $("#krea_atlas_version").val(s.atlasTextVersion === "long" ? "long" : "short").off("change").on("change", function () {
            s.atlasTextVersion = $(this).val();
            saveSettingsDebounced();
        });
        $("#krea_atlas_block").show();
    };

    const refreshCategories = () => {
        const $category = $("#krea_clio_tradition_select");
        const keep = $category.val();
        const src = $("#krea_style_source_select").val();
        const pool = styles.filter(x => !src || x.source === src);
        const sections = [];
        pool.forEach(it => { if (it.section && !sections.includes(it.section)) sections.push(it.section); });
        $category.empty().append('<option value="">Все категории</option>');
        sections.forEach(sec => {
            const n = pool.filter(x => x.section === sec).length;
            $category.append(`<option value="${escapeHtml(sec)}">${escapeHtml(sec)} (${n})</option>`);
        });
        $category.val(sections.includes(keep) ? keep : "");
    };

    const refreshLibrary = () => {
        styles = getUnifiedStyles();
        refreshCategories();
        renderAtlasBlock();
        updateCard();
    };

    updateCard();
    refreshCategories();
    renderAtlasBlock();
    refreshUiRef = () => { updateCard(); renderAtlasBlock(); };
    // Style Atlas lives in ComfyUI: read it in the background and redraw whenever the library changes
    // (also when a render loads it later, or new previews appear).
    onLibraryChange(() => {
        refreshLibrary();
        if ($("#krea_clio_modal").is(":visible")) renderGrid();
    });
    loadAtlas(s.comfyUrl);
    $("#krea_url").on("change.kreaAtlas", () => loadAtlas(s.comfyUrl, { force: true }));

    $("#krea_per_chat_style").prop("checked", !!s.perChatStyle).on("change", function () {
        s.perChatStyle = $(this).is(":checked");
        saveSettingsDebounced();
        // Switching it on stores the current style into this chat right away.
        saveChatStyle(s);
        updateCard();
    });

    const runAiPicker = () => openStyleAiPicker({ onPick: (id) => { $("#krea_clio_modal").fadeOut(120); pickCallback = null; setGlobalStyle(id); } });
    $("#krea_style_ai_btn").off("click").on("click", (e) => { e.stopPropagation(); runAiPicker(); });

    const pickRandom = (pool) => {
        const list = (pool && pool.length ? pool : styles).filter(x => x.id !== s.clioStyle);
        if (!list.length) return null;
        return list[Math.floor(Math.random() * list.length)].id;
    };

    $("#krea_clio_random_btn").off("click").on("click", function (e) {
        e.stopPropagation();
        const id = pickRandom(null);
        if (!id) return;
        setGlobalStyle(id);
        toastr.info(`🎲 Стиль: ${styleLabel(id)}`);
    });

    $("#krea_clio_none_btn").off("click").on("click", function (e) {
        e.stopPropagation();
        setGlobalStyle(NO_STYLE);
    });

    $("#krea_clio_fav_btn").off("click").on("click", function (e) {
        e.stopPropagation();
        const cur = s.clioStyle;
        if (isNoStyle(cur)) return toastr.info("Сначала выбери стиль.");
        s.clioFavorites = isFav(cur) ? s.clioFavorites.filter(n => n !== cur) : [...s.clioFavorites, cur];
        saveSettingsDebounced();
        updateCard();
    });

    const stepStyle = (dir) => {
        if (!styles.length) return;
        const ids = [NO_STYLE, ...styles.map(x => x.id)];
        let idx = ids.indexOf(s.clioStyle || NO_STYLE);
        if (idx === -1) idx = 0;
        setGlobalStyle(ids[(idx + dir + ids.length) % ids.length]);
    };
    $("#krea_clio_prev").off("click").on("click", (e) => { e.stopPropagation(); stepStyle(-1); });
    $("#krea_clio_next").off("click").on("click", (e) => { e.stopPropagation(); stepStyle(1); });

    // ── Modal ──
    const $modal = $("#krea_clio_modal");
    const $grid = $("#krea_clio_grid");
    const $search = $("#krea_clio_search");
    const $category = $("#krea_clio_tradition_select");
    const $source = $("#krea_style_source_select");
    const $picOnly = $("#krea_style_pic_only");
    const $count = $("#krea_clio_count_label");
    const $favFilter = $("#krea_clio_filter_fav");
    const $recentFilter = $("#krea_clio_filter_recent");

    let onlyFav = false;
    let onlyRecent = false;
    let shown = PAGE;

    const visibleStyles = () => {
        const q = ($search.val() || "").trim().toLowerCase();
        const sec = $category.val();
        const src = $source.val();
        const picOnly = $picOnly.is(":checked");
        let list = styles.filter(it =>
            (!q || it.name.toLowerCase().includes(q) || (it.sub && it.sub.toLowerCase().includes(q)) || (it.prompt && it.prompt.toLowerCase().includes(q))) &&
            (!src || it.source === src) &&
            (!sec || it.section === sec) &&
            (!picOnly || it.hasThumb) &&
            (!onlyFav || isFav(it.id))
        );
        if (onlyRecent) {
            // keep most-recent-first order
            list = s.clioRecent.map(id => list.find(it => it.id === id)).filter(Boolean);
        }
        return list;
    };

    const closeModal = () => {
        pickCallback = null;
        $modal.fadeOut(120);
    };

    const choose = (id) => {
        const cb = pickCallback;
        pickCallback = null;
        $modal.fadeOut(120);
        if (cb) {
            pushRecent(id);
            saveSettingsDebounced();
            cb(id);
        } else {
            setGlobalStyle(id);
        }
    };

    const placeholderHtml = (item) =>
        `<div class="krea-style-ph"><span>${escapeHtml(shortDesc(item.prompt || item.sub || item.section || "", 120))}</span></div>`;

    const renderGrid = () => {
        const list = visibleStyles();
        const current = pickCallback ? null : s.clioStyle;
        $grid.empty();
        if (!list.length) {
            $grid.append('<div class="krea-clio-empty">Ничего не найдено.</div>');
        }
        list.slice(0, shown).forEach(item => {
            const fav = isFav(item.id);
            const tip = [item.name, [SOURCE_LABEL[item.source], item.section, item.sub].filter(Boolean).join(" · "), item.prompt || ""].filter(Boolean).join("\n\n");
            const $tile = $(`
                <div class="krea-clio-tile ${current === item.id ? "active" : ""}" data-style="${escapeHtml(item.id)}" title="${escapeHtml(tip)}">
                    <div class="krea-clio-tile-img-box">
                        ${item.hasThumb
                            ? `<img class="krea-clio-tile-img" loading="lazy" src="${escapeHtml(thumbOf(item.id))}" alt="${escapeHtml(item.name)}" />`
                            : placeholderHtml(item)}
                        ${item.section ? `<span class="krea-clio-tile-section">${escapeHtml(item.section)}</span>` : ""}
                        <span class="krea-style-src krea-style-src-${item.source}" title="${item.alsoInAtlas ? "Есть и в Style Atlas — показана версия Clio" : ""}">${SOURCE_LABEL[item.source]}${item.alsoInAtlas ? " ✓A" : ""}</span>
                        <button type="button" class="krea-clio-tile-fav ${fav ? "on" : ""}" title="В избранное"><i class="fa-${fav ? "solid" : "regular"} fa-star"></i></button>
                    </div>
                    <div class="krea-clio-tile-label">${escapeHtml(item.name)}</div>
                </div>
            `);
            $tile.find("img").on("error", function () { $(this).replaceWith(placeholderHtml(item)); });
            $tile.on("click", () => choose(item.id));
            $tile.find(".krea-clio-tile-fav").on("click", function (e) {
                e.stopPropagation();
                s.clioFavorites = isFav(item.id) ? s.clioFavorites.filter(n => n !== item.id) : [...s.clioFavorites, item.id];
                saveSettingsDebounced();
                updateCard();
                if (onlyFav) renderGrid();
                else {
                    const on = isFav(item.id);
                    $(this).toggleClass("on", on).find("i").attr("class", `fa-${on ? "solid" : "regular"} fa-star`);
                }
            });
            $grid.append($tile);
        });
        if (list.length > shown) {
            const $more = $(`<button type="button" class="menu_button krea-btn krea-style-more">Показать ещё ${Math.min(PAGE, list.length - shown)} (всего ${list.length})</button>`);
            $more.on("click", () => { shown += PAGE; renderGrid(); });
            $grid.append($more);
        }
        const pics = list.filter(x => x.hasThumb).length;
        $count.text(`Стилей: ${list.length}${pics < list.length ? ` · с картинкой ${pics}` : ""}`);
        $favFilter.toggleClass("krea-btn-on", onlyFav);
        $recentFilter.toggleClass("krea-btn-on", onlyRecent);
    };
    const rerender = () => { shown = PAGE; renderGrid(); };

    const openModal = () => {
        $search.val("");
        $category.val("");
        $source.val("");
        $picOnly.prop("checked", false);
        refreshCategories();
        onlyFav = false;
        onlyRecent = false;
        shown = PAGE;
        $("#krea_clio_modal_ai_btn").toggle(!pickCallback);
        $("#krea_clio_modal_title").text(pickCallback ? "Стиль для этого варианта" : "Выбор стиля");
        // Make sure the current style is on the first page so it can be scrolled to.
        const curIdx = styles.findIndex(x => x.id === s.clioStyle);
        if (!pickCallback && curIdx >= shown) shown = curIdx + 1;
        $modal.fadeIn(150);
        renderGrid();
        $search.focus();
        // Previews rendered since the last look (make_thumbs.py) show up; the listener redraws the grid.
        refreshAtlasThumbs(s.comfyUrl);
        setTimeout(() => {
            const $active = $grid.find(".krea-clio-tile.active");
            if ($active.length) $active[0].scrollIntoView({ block: "center", behavior: "smooth" });
        }, 100);
    };
    openModalRef = openModal;

    $("#krea_clio_card").off("click").on("click", () => { pickCallback = null; openModal(); });
    $("#krea_clio_pick_btn").off("click").on("click", function (e) {
        e.stopPropagation();
        pickCallback = null;
        openModal();
    });

    $("#krea_clio_modal_close").off("click").on("click", closeModal);
    $modal.off("click").on("click", (e) => { if ($(e.target).is($modal)) closeModal(); });
    $(document).off("keydown.krea_clio").on("keydown.krea_clio", (e) => {
        if (e.key === "Escape" && $modal.is(":visible")) closeModal();
    });

    $("#krea_clio_modal_random_btn").off("click").on("click", () => {
        const pool = visibleStyles();
        const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
        if (pick) choose(pick);
    });
    $("#krea_clio_modal_none_btn").off("click").on("click", () => choose(NO_STYLE));
    // Hidden in per-image mode: the AI pick sets the chat's style, not one image's.
    $("#krea_clio_modal_ai_btn").off("click").on("click", runAiPicker);

    $favFilter.off("click").on("click", () => { onlyFav = !onlyFav; rerender(); });
    $recentFilter.off("click").on("click", () => { onlyRecent = !onlyRecent; rerender(); });
    $search.off("input").on("input", rerender);
    $category.off("change").on("change", rerender);
    $source.off("change").on("change", () => { refreshCategories(); rerender(); });
    $picOnly.off("change").on("change", rerender);
}
