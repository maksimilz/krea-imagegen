import { saveSettingsDebounced } from "../../../../../script.js";
import { EXTENSION_FOLDER, KREA_RESOLUTIONS } from "./data.js";
import { getSettings, escapeHtml, numOr } from "./utils.js";
import { testComfyConnection, fetchComfyObjectInfo, fetchAvailableWorkflows, loadWorkflowJson } from "./comfy.js";
import { stopCurrentGeneration } from "./generation.js";
import { initClioStyleUi } from "./clioStyles.js";

// ── 5. Settings Panel UI Mounting & Binding ──────────────────────────────────

export async function initSettingsUi() {
    const $container = $("#extensions_settings");
    if (!$container.length) return;

    try {
        const html = await $.get(`/scripts/extensions/${EXTENSION_FOLDER}/settings.html?v=${Date.now()}`);
        $container.append(html);

        const s = getSettings();

        // Bind fields
        $("#krea_enabled").prop("checked", s.enabled).on("change", function() {
            s.enabled = $(this).is(":checked");
            saveSettingsDebounced();
            updateBadge();
        });

        $("#krea_url").val(s.comfyUrl).on("change", function() {
            s.comfyUrl = $(this).val().trim();
            saveSettingsDebounced();
        });

        $("#krea_template").val(s.promptTemplate).on("change", function() {
            s.promptTemplate = $(this).val();
            saveSettingsDebounced();
        });

        $("#krea_trigger_mode").val(s.triggerMode).on("change", function() {
            s.triggerMode = $(this).val();
            $("#krea_freq_wrapper").toggle(s.triggerMode === "frequency");
            saveSettingsDebounced();
        });
        $("#krea_freq_wrapper").toggle(s.triggerMode === "frequency");

        $("#krea_auto_freq").val(s.autoGenFreq).on("change", function() {
            s.autoGenFreq = parseInt($(this).val()) || 3;
            saveSettingsDebounced();
        });

        const updateSpecialDesc = () => {
            const count = Math.max(1, parseInt(s.imageCount) || 1);
            if (s.autoCount) {
                $("#krea_special_desc").text(`Последняя картинка будет отдельной сценой по заданию (обычных модель выберет сама, до ${count - 1}).`);
            } else if (count <= 1) {
                $("#krea_special_desc").text("Единственная картинка будет отдельной сценой по твоему заданию.");
            } else {
                const reg = count - 1;
                $("#krea_special_desc").text(`Последняя (${count}-я) картинка будет отдельной сценой по заданию (${reg} обычных + 1 особая).`);
            }
        };

        // "auto" = model picks 1–4; imageCount stays 4 so the generation cap still fits.
        $("#krea_image_count").val(s.autoCount ? "auto" : String(s.imageCount)).on("change", function() {
            const val = $(this).val();
            s.autoCount = val === "auto";
            s.imageCount = s.autoCount ? 4 : (parseInt(val) || 1);
            updateSpecialDesc();
            saveSettingsDebounced();
        });
        updateSpecialDesc();

        $("#krea_auto_retries").val(String(s.autoRetries ?? 2)).on("change", function() {
            s.autoRetries = parseInt($(this).val()) || 0;
            saveSettingsDebounced();
        });

        $("#krea_special_enabled").prop("checked", !!s.specialImageEnabled).on("change", function() {
            s.specialImageEnabled = $(this).is(":checked");
            $("#krea_special_wrapper").toggle(s.specialImageEnabled);
            saveSettingsDebounced();
        });
        $("#krea_special_wrapper").toggle(!!s.specialImageEnabled);

        $("#krea_special_prompt").val(s.specialImagePrompt || "").on("input", function() {
            s.specialImagePrompt = $(this).val();
            saveSettingsDebounced();
        });

        $("#krea_history_prompts").val(String(s.historyPrompts ?? 2)).on("change", function() {
            s.historyPrompts = parseInt($(this).val()) || 0;
            saveSettingsDebounced();
        });

        $("#krea_extra").val(s.promptExtra).on("input", function() {
            s.promptExtra = $(this).val();
            saveSettingsDebounced();
        });

        $("#krea_preview").prop("checked", s.previewPrompt).on("change", function() {
            s.previewPrompt = $(this).is(":checked");
            saveSettingsDebounced();
        });

        $("#krea_soft_tone").prop("checked", !!s.softTone).on("change", function() {
            s.softTone = $(this).is(":checked");
            saveSettingsDebounced();
        });

        $("#krea_compress").prop("checked", s.compressImages).on("change", function() {
            s.compressImages = $(this).is(":checked");
            saveSettingsDebounced();
        });

        $("#krea_hires").prop("checked", !!s.hiRes).on("change", function() {
            s.hiRes = $(this).is(":checked");
            saveSettingsDebounced();
        });

        $("#krea_steps").val(s.steps).on("change", function() {
            s.steps = parseInt($(this).val()) || 20;
            saveWorkflowProfile();
            saveSettingsDebounced();
        });

        $("#krea_cfg").val(s.cfg).on("change", function() {
            s.cfg = parseFloat($(this).val()) || 7.0;
            saveWorkflowProfile();
            saveSettingsDebounced();
        });

        $("#krea_denoise").val(s.denoise).on("change", function() {
            s.denoise = parseFloat($(this).val()) || 1.0;
            saveSettingsDebounced();
        });

        $("#krea_seed").val(s.customSeed).on("change", function() {
            s.customSeed = Math.trunc(numOr($(this).val(), -1));
            saveSettingsDebounced();
        });

        $("#krea_seed_dice").on("click", function() {
            s.customSeed = -1;
            $("#krea_seed").val(-1);
            saveSettingsDebounced();
            toastr.info("Сид: случайный (-1).");
        });

        $("#krea_prefix").val(s.promptPrefix).on("input", function() {
            s.promptPrefix = $(this).val();
            saveSettingsDebounced();
        });

        $("#krea_negative").val(s.customNegative).on("input", function() {
            s.customNegative = $(this).val();
            saveSettingsDebounced();
        });

        // Resolutions Preset & Mode
        const $resSelect = $("#krea_res_preset");
        $resSelect.empty();
        $resSelect.append('<option value="auto">✨ Авто (ИИ выбирает размер под сцену)</option>');
        KREA_RESOLUTIONS.forEach(r => {
            $resSelect.append(`<option value="${r.w}x${r.h}">${r.label}</option>`);
        });

        const syncResUi = () => {
            const isAuto = (s.resolutionMode === "auto" || !s.resolutionMode);
            if (isAuto) {
                $resSelect.val("auto");
                $("#krea_w").prop("disabled", true).css("opacity", "0.5").val(s.imgWidth || 1344);
                $("#krea_h").prop("disabled", true).css("opacity", "0.5").val(s.imgHeight || 768);
            } else {
                $resSelect.val(`${s.imgWidth}x${s.imgHeight}`);
                $("#krea_w").prop("disabled", false).css("opacity", "1.0").val(s.imgWidth);
                $("#krea_h").prop("disabled", false).css("opacity", "1.0").val(s.imgHeight);
            }
        };
        syncResUi();

        $resSelect.off("change").on("change", function() {
            const val = $(this).val();
            if (val === "auto") {
                s.resolutionMode = "auto";
                toastr.info("Разрешение: авто (ИИ выбирает размер под сцену).");
            } else {
                s.resolutionMode = "fixed";
                const [w, h] = val.split("x").map(Number);
                s.imgWidth = w;
                s.imgHeight = h;
            }
            syncResUi();
            saveSettingsDebounced();
        });

        $("#krea_w").off("change").on("change", function() {
            s.imgWidth = parseInt($(this).val()) || 1344;
            s.resolutionMode = "fixed";
            syncResUi();
            saveSettingsDebounced();
        });
        $("#krea_h").off("change").on("change", function() {
            s.imgHeight = parseInt($(this).val()) || 768;
            s.resolutionMode = "fixed";
            syncResUi();
            saveSettingsDebounced();
        });

        // LoRA Slots Binding
        [1, 2, 3, 4].forEach(i => {
            $(`#krea_lora_${i}`).val(s[`lora${i}`]).on("change", function() {
                const selected = $(this).val();
                s[`lora${i}`] = selected;
                // Auto-fill remembered trigger words
                if (selected && s.savedLoraTriggers?.[selected]) {
                    s[`loraTrigger${i}`] = s.savedLoraTriggers[selected];
                    $(`#krea_lora_trig_${i}`).val(s.savedLoraTriggers[selected]);
                }
                saveWorkflowProfile();
                saveSettingsDebounced();
            });

            $(`#krea_lora_trig_${i}`).val(s[`loraTrigger${i}`]).on("input", function() {
                const trig = $(this).val();
                s[`loraTrigger${i}`] = trig;
                const activeLora = s[`lora${i}`];
                if (activeLora) {
                    if (!s.savedLoraTriggers) s.savedLoraTriggers = {};
                    s.savedLoraTriggers[activeLora] = trig;
                }
                saveWorkflowProfile();
                saveSettingsDebounced();
            });

            $(`#krea_lorawt_${i}`).val(s[`lorawt${i}`]).on("input", function() {
                const val = numOr($(this).val(), 1.0);
                s[`lorawt${i}`] = val;
                $(`#krea_lorawt_lbl_${i}`).text(val.toFixed(1));
                saveWorkflowProfile();
                saveSettingsDebounced();
            });
            $(`#krea_lorawt_lbl_${i}`).text(numOr(s[`lorawt${i}`], 1.0).toFixed(1));
        });

        // Test connection & load dropdowns
        $("#krea_test_btn").on("click", async function() {
            $(this).prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Проверка…');
            const ok = await testComfyConnection(s.comfyUrl);
            $(this).prop("disabled", false).html('<i class="fa-solid fa-wifi"></i> Проверить');
            if (ok) {
                toastr.success("Подключено к ComfyUI!");
                await populateComfyDropdowns();
            } else {
                toastr.error("Не удалось подключиться к ComfyUI. Проверь адрес и запущен ли сервер.");
            }
            updateBadge(ok);
        });

        $("#krea_interrupt_btn").on("click", async function() {
            $(this).prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Остановка…');
            await stopCurrentGeneration();
            $(this).prop("disabled", false).html('<i class="fa-solid fa-hand"></i> Стоп');
        });

        $("#krea_refresh_wf").on("click", async function() {
            await populateWorkflows();
            toastr.info("Список workflow обновлён.");
        });

        await populateWorkflows();
        await populateComfyDropdowns();
        await initClioStyleUi();
        updateBadge();

    } catch (err) {
        console.error("[Krea-ImageGen] Failed to initialize settings panel:", err);
    }
}

// Shows which %placeholders% the selected workflow actually uses, so dead settings are obvious.
const PLACEHOLDER_LABELS = {
    prompt: "промт", negative_prompt: "негатив", seed: "сид", steps: "шаги", scale: "cfg",
    denoise: "denoise", model: "модель", sampler: "сэмплер", width: "ширина", height: "высота",
    style: "style", clio_style: "style", style_text: "style", style_source: "style"
};

async function updateWorkflowInfo(name) {
    const $info = $("#krea_wf_info");
    if (!$info.length) return;
    if (!name) { $info.empty(); return; }
    try {
        const wf = await loadWorkflowJson(name);
        const text = JSON.stringify(wf);
        const found = new Set([...text.matchAll(/%([a-z_]+\d*)%/g)].map(m => m[1]));
        const hasClio = Object.values(wf).some(n => n?.class_type === "ClioStyle");
        const chips = [];

        if (!found.has("prompt")) {
            chips.push('<span class="krea-chip krea-chip-bad" title="Без %prompt% сгенерированный промт не попадёт в ComfyUI">нет %prompt%</span>');
        }
        const used = [];
        for (const key of ["seed", "steps", "scale", "denoise", "model", "sampler", "width", "height", "negative_prompt"]) {
            if (found.has(key)) used.push(PLACEHOLDER_LABELS[key]);
        }
        if (used.length) chips.push(`<span class="krea-chip" title="Настройки панели, которые читает этот workflow">использует: ${used.join(", ")}</span>`);

        const loras = [1, 2, 3, 4].filter(i => found.has(`lora${i}`));
        if (loras.length) chips.push(`<span class="krea-chip">LoRA-слоты: ${loras.join(", ")}</span>`);

        if (hasClio || found.has("style") || found.has("clio_style")) {
            chips.push('<span class="krea-chip krea-chip-ok">стиль: в workflow</span>');
        } else {
            chips.push('<span class="krea-chip" title="В workflow нет узла ClioStyle — для стиля Clio он добавляется автоматически, стиль Style Atlas пишется в текст промта">стиль: автоподстановка</span>');
        }
        $info.html(chips.join(""));
    } catch (e) {
        $info.html('<span class="krea-chip krea-chip-bad">не удалось прочитать workflow</span>');
    }
}

async function populateWorkflows() {
    const s = getSettings();
    const list = await fetchAvailableWorkflows();
    const $sel = $("#krea_workflow");
    $sel.empty();

    if (!list || list.length === 0) {
        $sel.append('<option value="">В SillyTavern нет workflow</option>');
        return;
    }

    list.forEach(name => {
        $sel.append(`<option value="${escapeHtml(name)}" ${s.currentWorkflowName === name ? "selected" : ""}>${escapeHtml(name)}</option>`);
    });

    if (!s.currentWorkflowName && list.length > 0) {
        // Auto-select Krea workflow if available
        const kreaWf = list.find(w => w.toLowerCase().includes("krea")) || list[0];
        s.currentWorkflowName = kreaWf;
        $sel.val(kreaWf);
        saveSettingsDebounced();
    }
    // The workflow open now keeps the LoRA / sampler values it has (first run of this version).
    if (s.currentWorkflowName && !s.workflowProfiles?.[s.currentWorkflowName]) saveWorkflowProfile();

    $sel.off("change").on("change", function() {
        s.currentWorkflowName = $(this).val();
        if (loadWorkflowProfile(s.currentWorkflowName)) {
            const p = s.workflowProfiles[s.currentWorkflowName];
            const loras = [1, 2, 3, 4].map(i => p[`lora${i}`]).filter(Boolean);
            toastr.info(`${p.selectedSampler || "?"} · ${p.steps} шагов · cfg ${p.cfg} · LoRA: ${loras.length ? loras.join(", ") : "нет"}`, "Настройки этого workflow");
        }
        saveSettingsDebounced();
        updateWorkflowInfo(s.currentWorkflowName);
    });
    updateWorkflowInfo(s.currentWorkflowName);
}

// ── Per-workflow profile ──────────────────────────────────────────────────────
// Each workflow remembers its own LoRA slots and sampling (e.g. Krea 2 Turbo with two LoRAs and
// euler/8, RedCraft without LoRAs and er_sde/10): switching the workflow brings them back.
const PROFILE_KEYS = ["selectedSampler", "steps", "cfg",
    ...[1, 2, 3, 4].flatMap(i => [`lora${i}`, `lorawt${i}`, `loraTrigger${i}`])];

function saveWorkflowProfile() {
    const s = getSettings();
    if (!s.currentWorkflowName) return;
    if (!s.workflowProfiles || typeof s.workflowProfiles !== "object") s.workflowProfiles = {};
    const p = {};
    PROFILE_KEYS.forEach(k => { p[k] = s[k]; });
    s.workflowProfiles[s.currentWorkflowName] = p;
}

/** Takes the workflow's saved profile into the settings and the panel. false = it had none (current values are saved for it). */
function loadWorkflowProfile(name) {
    const s = getSettings();
    const p = s.workflowProfiles?.[name];
    if (!p) {
        saveWorkflowProfile();
        return false;
    }
    PROFILE_KEYS.forEach(k => { if (k in p) s[k] = p[k]; });
    $("#krea_steps").val(s.steps);
    $("#krea_cfg").val(s.cfg);
    $("#krea_sampler").val(s.selectedSampler);
    [1, 2, 3, 4].forEach(i => {
        $(`#krea_lora_${i}`).val(s[`lora${i}`] || "");
        $(`#krea_lora_trig_${i}`).val(s[`loraTrigger${i}`] || "");
        $(`#krea_lorawt_${i}`).val(s[`lorawt${i}`]);
        $(`#krea_lorawt_lbl_${i}`).text(numOr(s[`lorawt${i}`], 1.0).toFixed(1));
    });
    return true;
}

async function populateComfyDropdowns() {
    const s = getSettings();
    const info = await fetchComfyObjectInfo(s.comfyUrl);
    if (!info) return;

    // Checkpoints
    const $modelSel = $("#krea_model");
    $modelSel.empty().append('<option value="">Из workflow</option>');
    (info.models || []).forEach(m => {
        $modelSel.append(`<option value="${escapeHtml(m)}" ${s.selectedModel === m ? "selected" : ""}>${escapeHtml(m)}</option>`);
    });
    $modelSel.off("change").on("change", function() {
        s.selectedModel = $(this).val();
        saveSettingsDebounced();
    });

    // Samplers
    const $samplerSel = $("#krea_sampler");
    $samplerSel.empty();
    (info.samplers || []).forEach(sm => {
        $samplerSel.append(`<option value="${escapeHtml(sm)}" ${s.selectedSampler === sm ? "selected" : ""}>${escapeHtml(sm)}</option>`);
    });
    $samplerSel.off("change").on("change", function() {
        s.selectedSampler = $(this).val();
        saveWorkflowProfile();
        saveSettingsDebounced();
    });

    // LoRAs
    [1, 2, 3, 4].forEach(i => {
        const $loraSel = $(`#krea_lora_${i}`);
        $loraSel.empty().append('<option value="">None</option>');
        (info.loras || []).forEach(l => {
            $loraSel.append(`<option value="${escapeHtml(l)}" ${s[`lora${i}`] === l ? "selected" : ""}>${escapeHtml(l)}</option>`);
        });
    });
}

function updateBadge(connected = null) {
    const s = getSettings();
    const $badge = $("#krea_status_badge");
    $badge.removeClass("on off bad");
    if (!s.enabled) {
        $badge.addClass("off").html('<i class="fa-solid fa-circle-xmark"></i> Выкл');
    } else if (connected === false) {
        $badge.addClass("bad").html('<i class="fa-solid fa-triangle-exclamation"></i> Нет связи');
    } else {
        $badge.addClass("on").html('<i class="fa-solid fa-circle-check"></i> Вкл');
    }
}
