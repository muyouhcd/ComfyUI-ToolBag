import { app } from "../../../scripts/app.js";
import {
    getModelScopeLink,
    rewriteWorkflowModelUrls,
} from "./modelscope_url.mjs";

const linksByName = new Map();
const modelsByName = new Map();
const nodeLabelsByName = new Map();
const workflowNodeLabelsByName = new Map();
const downloadStateByName = new Map();
const downloadPollsByName = new Map();
const BUTTON_ATTRIBUTE = "data-toolbag-modelscope";
const CANCEL_ATTRIBUTE = "data-toolbag-modelscope-cancel";
let sidebarPanelRender;
let sidebarPanelReload;

function formatBytes(bytes) {
    if (!bytes) return "0 MB";
    const units = ["B", "KB", "MB", "GB"];
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** unit)).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function renderDownloadState(button, state) {
    if (!state) {
        button.textContent = "é«˜é€Ÿä¸‹è½½";
        return;
    }
    if (state.status === "queued") {
        button.textContent = state.queue_position
            ? `æ’é˜Ÿä¸­ Â· ç¬¬ ${state.queue_position} ä¸ª`
            : "æ’é˜Ÿä¸­";
        button.title = "å·²è¿›å…¥é«˜é€Ÿä¸‹è½½é˜Ÿåˆ—ï¼›ç‚¹å‡»å¯æš‚åœæ­¤ä»»åŠ¡";
        button.disabled = false;
        return;
    }
    if (state.status === "running") {
        const percent = state.total
            ? (state.downloaded / state.total * 100).toFixed(1)
            : "0.0";
        button.textContent = state.stalled
            ? `${percent}% Â· æ­£åœ¨é‡è¿â€¦`
            : `${percent}% Â· ${formatBytes(state.downloaded)} Â· ${formatBytes(state.speed)}/s`;
        button.title = state.stalled
            ? "è¿æ¥è¶…è¿‡ 5 ç§’æ²¡æœ‰æ”¶åˆ°æ•°æ®ï¼Œä¸‹è½½å™¨å°†è‡ªåŠ¨é‡è¿"
            : `å·²ä¸‹è½½ ${formatBytes(state.downloaded)} / ${formatBytes(state.total)}ï¼›ç‚¹å‡»æš‚åœ`;
        button.disabled = false;
        return;
    }
    if (state.status === "paused") {
        button.textContent = "ç»§ç»­ä¸‹è½½";
        button.title = "ç‚¹å‡»ç»§ç»­ä¸‹è½½";
        button.disabled = false;
        return;
    }
    if (state.status === "complete") {
        button.textContent = "å·²å®‰è£…";
        button.disabled = true;
        return;
    }
    if (state.status === "canceled") {
        button.textContent = "é«˜é€Ÿä¸‹è½½";
        button.title = "ä½¿ç”¨ ModelScope å›½å†…é•œåƒå¹¶å‘ä¸‹è½½";
        button.disabled = false;
        return;
    }
    button.textContent = "ä¸‹è½½å¤±è´¥";
    button.disabled = false;
    button.title = state.error ?? "ä¸‹è½½å¤±è´¥";
}

function renderCancelState(button, state) {
    button.style.display = ["queued", "running", "paused"].includes(state?.status)
        ? "inline-flex"
        : "none";
}

function renderModelButtons(modelName, state) {
    for (const button of document.querySelectorAll(`[${BUTTON_ATTRIBUTE}]`)) {
        if (button.dataset.modelName === modelName) renderDownloadState(button, state);
    }
    for (const button of document.querySelectorAll(`[${CANCEL_ATTRIBUTE}]`)) {
        if (button.dataset.modelName === modelName) renderCancelState(button, state);
    }
    sidebarPanelRender?.();
}

function isDirectDownload(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname.endsWith("modelscope.cn")
            && parsed.pathname.includes("/resolve/");
    } catch {
        return false;
    }
}

async function pollDownload(modelName, taskId) {
    while (true) {
        const response = await fetch(`/toolbag/modelscope/download/${taskId}`);
        const state = await response.json();
        if (!response.ok) throw new Error(state.error ?? "æ— æ³•è¯»å–ä¸‹è½½è¿›åº¦");
        downloadStateByName.set(modelName, state);
        addModelScopeButtons();
        renderModelButtons(modelName, state);

        if (state.status === "complete") {
            await app.refreshMissingModels?.({ silent: true });
            await sidebarPanelReload?.();
            return;
        }
        if (state.status === "canceled") return;
        if (state.status === "error") throw new Error(state.error ?? "ä¸‹è½½å¤±è´¥");
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

function watchDownload(modelName, taskId) {
    if (!taskId || downloadPollsByName.get(modelName)?.taskId === taskId) return;
    const watcher = pollDownload(modelName, taskId)
        .catch((error) => {
            const state = { status: "error", error: error.message };
            downloadStateByName.set(modelName, state);
            renderModelButtons(modelName, state);
        })
        .finally(() => {
            if (downloadPollsByName.get(modelName)?.taskId === taskId) {
                downloadPollsByName.delete(modelName);
            }
        });
    downloadPollsByName.set(modelName, { taskId, watcher });
}

async function syncDownloadStates() {
    const response = await fetch("/toolbag/modelscope/downloads");
    const states = await response.json();
    if (!response.ok) throw new Error(states.error ?? "æ— æ³•è¯»å–ä¸‹è½½ä»»åŠ¡");
    for (const state of states) {
        downloadStateByName.set(state.name, state);
        renderModelButtons(state.name, state);
        if (["queued", "running", "paused"].includes(state.status)) {
            watchDownload(state.name, state.task_id);
        }
    }
    return states;
}

async function toggleDownload(modelName, state) {
    const response = await fetch(
        `/toolbag/modelscope/download/${state.task_id}/pause`,
        { method: "POST" },
    );
    const updated = await response.json();
    if (!response.ok) throw new Error(updated.error ?? "æ— æ³•åˆ‡æ¢ä¸‹è½½çŠ¶æ€");
    downloadStateByName.set(modelName, updated);
    return updated;
}

async function cancelDownload(modelName) {
    const state = downloadStateByName.get(modelName);
    if (!state?.task_id) return;

    const response = await fetch(
        `/toolbag/modelscope/download/${state.task_id}`,
        { method: "DELETE" },
    );
    const updated = await response.json();
    if (!response.ok) throw new Error(updated.error ?? "æ— æ³•å–æ¶ˆä¸‹è½½");
    downloadStateByName.delete(modelName);
    addModelScopeButtons();
    renderModelButtons(modelName, null);
}

async function startFastDownload(
    modelName,
    button,
    token = null,
    toggleExisting = true,
) {
    const currentState = downloadStateByName.get(modelName);
    if (["queued", "running", "paused"].includes(currentState?.status)) {
        if (!toggleExisting) return currentState;
        try {
            const updated = await toggleDownload(modelName, currentState);
            renderModelButtons(modelName, updated);
        } catch (error) {
            button.title = error.message;
        }
        return;
    }

    const model = modelsByName.get(modelName);
    const url = getModelScopeLink(modelName, linksByName);
    if (!model?.directory || !isDirectDownload(url)) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent = "å‡†å¤‡ä¸‹è½½â€¦";
    }
    try {
        const response = await fetch("/toolbag/modelscope/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url,
                name: modelName,
                directory: model.directory,
                token,
            }),
        });
        const state = await response.json();
        if (!response.ok) throw new Error(state.error ?? "æ— æ³•å¼€å§‹ä¸‹è½½");
        downloadStateByName.set(modelName, state);
        renderModelButtons(modelName, state);
        if (
            state.task_id
            && ["queued", "running", "paused"].includes(state.status)
        ) {
            watchDownload(modelName, state.task_id);
        } else if (state.status === "complete") {
            await app.refreshMissingModels?.({ silent: true });
            await sidebarPanelReload?.();
        }
        return state;
    } catch (error) {
        if (!token && (error.message.includes("ç™»å½•") || error.message.includes("æˆæƒ"))) {
            const accessToken = window.prompt(
                "è¯·è¾“å…¥ ModelScope Access Tokenï¼ˆä»…ç”¨äºæœ¬æ¬¡ä¸‹è½½ï¼Œä¸ä¼šä¿å­˜ï¼‰ï¼š",
            );
            if (accessToken?.trim()) {
                await startFastDownload(modelName, button, accessToken.trim());
                return;
            }
        }
        const state = { status: "error", error: error.message };
        downloadStateByName.set(modelName, state);
        renderModelButtons(modelName, state);
        return state;
    }
}

function getMissingModelName(title) {
    const name = title.getAttribute("title")?.trim();
    if (!name) return null;

    const label = title.textContent?.trim() ?? "";
    if (label === name) return name;
    return label.startsWith(name) && /\(\d+\)$/.test(label) ? name : null;
}

function getMissingModelHeader(title) {
    if (title.matches("p[title]")) {
        const header = title.parentElement?.parentElement;
        const row = header?.parentElement;
        const isLegacyMissingModelRow = row?.querySelector(
            '[data-testid^="missing-model-"], input[id^="url-input-"]',
        );
        if (header && isLegacyMissingModelRow) return header;
    }

    const currentHeader = title.parentElement?.parentElement?.parentElement;
    const currentRow = currentHeader?.parentElement;
    if (
        currentHeader
        && currentRow?.querySelector('[data-testid^="missing-model-"]')
    ) {
        return currentHeader;
    }

    let current = title.parentElement;
    for (let depth = 0; current && depth < 6; depth += 1) {
        const hasDirectMissingModelControl = Array.from(current.children).some(
            (child) => child.matches?.('[data-testid^="missing-model-"]'),
        );
        if (hasDirectMissingModelControl) return current;
        current = current.parentElement;
    }
    return null;
}

function createModelScopeButton(modelName) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(BUTTON_ATTRIBUTE, "");
    button.dataset.modelName = modelName;
    button.title = "ä½¿ç”¨ ModelScope å›½å†…é•œåƒå¹¶å‘ä¸‹è½½";
    button.setAttribute("aria-label", `ä» ModelScope ä¸‹è½½ ${modelName}`);
    Object.assign(button.style, {
        height: "2rem",
        padding: "0 0.75rem",
        border: "1px solid var(--border-color, rgba(127, 127, 127, 0.35))",
        borderRadius: "0.5rem",
        background: "var(--comfy-input-bg, rgba(127, 127, 127, 0.12))",
        color: "inherit",
        cursor: "pointer",
        flexShrink: "0",
        fontSize: "0.75rem",
        minWidth: "6rem",
        whiteSpace: "nowrap",
    });

    renderDownloadState(button, downloadStateByName.get(modelName));
    button.addEventListener("click", () => startFastDownload(modelName, button));
    return button;
}

function createCancelButton(modelName) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(CANCEL_ATTRIBUTE, "");
    button.dataset.modelName = modelName;
    button.textContent = "Ã—";
    button.title = "å–æ¶ˆä¸‹è½½å¹¶æ¸…ç©ºä¸´æ—¶å†…å®¹";
    button.setAttribute("aria-label", `å–æ¶ˆä¸‹è½½ ${modelName}`);
    Object.assign(button.style, {
        alignItems: "center",
        justifyContent: "center",
        width: "2rem",
        height: "2rem",
        border: "1px solid rgba(239, 68, 68, 0.45)",
        borderRadius: "0.5rem",
        background: "rgba(239, 68, 68, 0.12)",
        color: "#ef4444",
        cursor: "pointer",
        flexShrink: "0",
        fontSize: "1.1rem",
    });
    renderCancelState(button, downloadStateByName.get(modelName));
    button.addEventListener("click", async () => {
        try {
            await cancelDownload(modelName);
        } catch (error) {
            button.title = error.message;
        }
    });
    return button;
}

function addModelScopeButtons() {
    for (const title of document.querySelectorAll(
        "p[title], button[title], span[title]",
    )) {
        const modelName = getMissingModelName(title);
        if (!modelName) continue;

        const header = getMissingModelHeader(title);
        if (!header || header.querySelector(`[${BUTTON_ATTRIBUTE}]`)) continue;

        header.append(
            createModelScopeButton(modelName),
            createCancelButton(modelName),
        );
    }
}

let refreshQueued = false;
function queueButtonRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
        refreshQueued = false;
        addModelScopeButtons();
    });
}

function collectStringValues(value, result, visited = new WeakSet()) {
    if (typeof value === "string") {
        result.add(value.replaceAll("\\", "/"));
        return;
    }
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    for (const child of Object.values(value)) {
        collectStringValues(child, result, visited);
    }
}

function indexNodeModelReferences(
    node,
    modelNames = modelsByName.keys(),
    workflowLabel = null,
) {
    if (!node || typeof node !== "object") return;
    const values = new Set();
    collectStringValues(node.widgets_values, values);
    collectStringValues(node.properties?.models, values);
    const rawLabel = node.title || node.type || node.class_type || "";
    const label = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(rawLabel)
        ? "å­å›¾èŠ‚ç‚¹"
        : (rawLabel || `èŠ‚ç‚¹ ${node.id ?? ""}`);
    for (const modelName of modelNames) {
        const normalizedName = modelName.replaceAll("\\", "/");
        if (
            values.has(normalizedName)
            || [...values].some((value) => value.endsWith(`/${normalizedName}`))
        ) {
            if (!nodeLabelsByName.has(modelName)) {
                nodeLabelsByName.set(modelName, new Set());
            }
            nodeLabelsByName.get(modelName).add(label);
            if (workflowLabel) {
                if (!workflowNodeLabelsByName.has(modelName)) {
                    workflowNodeLabelsByName.set(modelName, new Map());
                }
                const workflows = workflowNodeLabelsByName.get(modelName);
                if (!workflows.has(workflowLabel)) {
                    workflows.set(workflowLabel, new Set());
                }
                workflows.get(workflowLabel).add(label);
            }
        }
    }
}

function indexWorkflowNodes(
    graphData,
    modelNames,
    workflowLabel,
    visited = new WeakSet(),
) {
    if (!graphData || typeof graphData !== "object" || visited.has(graphData)) return;
    visited.add(graphData);
    if (Array.isArray(graphData.nodes)) {
        for (const node of graphData.nodes) {
            indexNodeModelReferences(node, modelNames, workflowLabel);
            indexWorkflowNodes(node, modelNames, workflowLabel, visite×Îw¶‰Ëkºwµç}Èè¥¹¡•É¥Ğì‰…­É½Õ¹èÑÉ…¹ÍÁ…É•¹Ğì™½¹ĞµÍ¥é”è€ÄÅÁàìô(€€€€¹Ñ½½±‰…œµµ¥ÍÍ¥¹œµ…Ñ¥½¸ì‰½É‘•Èè€ÅÁàÍ½±¥€ŒÌäàÙˆàìô(€€€€¹Ñ½½±‰…œµµ¥ÍÍ¥¹œµ…Ñ¥½¸é¡½Ù•Èì½±½Èèİ¡¥Ñ”ì‰…­É½Õ¹è€ŒÈàİ‘ˆÔìô(€€€€¹Ñ½½±‰…œµµ¥ÍÍ¥¹œµ…¹•°ì‘¥ÍÁ±…äè¹½¹”ì‰½É‘•Èè€ÅÁàÍ½±¥€Œå˜Í„Í„ì½±½Èè€™™…‰…ˆìô(€€€€¹Ñ½½±‰…œµµ¥ÍÍ¥¹œµ…¹•°é¡½Ù•Èì½±½Èèİ¡¥Ñ”ì‰…­É½Õ¹è€Œå˜Í„Í„ìô(€€€€¹Ñ½½±‰…œµµ¥ÍÍ¥¹œµ•µÁÑä°€¹Ñ½½±‰…œµµ¥ÍÍ¥¹œµ•ÉÉ½ÈìÁ…‘‘¥¹œè€ÈáÁà€áÁàì½±½ÈèÙ…È ´µ‘•ÍÉ¥ÀµÑ•áĞ°€……„¤ìÑ•áĞµ…±¥¸è•¹Ñ•Èìô(€€€€¹Ñ½½±‰…œµµ¥ÍÍ¥¹œµ•ÉÉ½Èì½±½Èè€™˜á˜á˜ìô)€ì()½¹ÍĞÉ•…Ñ•A…¹•±±•µ•¹Ğ€ô€¡Ñ…œ°±…ÍÍ9…µ”°Ñ•áĞ¤€ôøì(€€€½¹ÍĞ•±•µ•¹Ğ€ô‘½Õµ•¹Ğ¹É•…Ñ•±•µ•¹Ğ¡Ñ…œ¤ì(€€€¥˜€¡±…ÍÍ9…µ”¤•±•µ•¹Ğ¹±…ÍÍ9…µ”€ô±…ÍÍ9…µ”ì(€€€¥˜€¡Ñ•áĞ€„ôôÕ¹‘•™¥¹•¤•±•µ•¹Ğ¹Ñ•áÑ½¹Ñ•¹Ğ€ôÑ•áĞì(€€€É•ÑÕÉ¸•±•µ•¹Ğì)ôì()™Õ¹Ñ¥½¸É•…Ñ•5¥ÍÍ¥¹5½‘•±ÍA…¹•°¡É½½Ğ°Í¥¹…°¤ì(€€€½¹ÍĞÍÑ…Ñ”€ôì(€€€€€€€µ½‘•±Ìèmt°(€€€€€€€İ½É­™±½İ½Õ¹Ğè€À°(€€€€€€€İ½É­™±½İM¥¹…ÑÕÉ”è€ˆˆ°(€€€€€€€±½…‘¥¹œèÑÉÕ”°(€€€€€€€ÍÑ…ÉÑ¥¹±°è™…±Í”°(€€€€€€€Á…ÕÍ¥¹±°è™…±Í”°(€€€€€€€•ÉÉ½Èè€ˆˆ°(€€€ôì((€€€É½½Ğ¹É•Á±…•¡¥±‘É•¸ ¤ì(€€€½¹ÍĞÍÑå±”€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰ÍÑå±”ˆ¤ì(€€€ÍÑå±”¹Ñ•áÑ½¹Ñ•¹Ğ€ôµ¥ÍÍ¥¹5½‘•±ÍMÑå±•Ìì(€€€½¹ÍĞÁ…¹•°€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰Í•Ñ¥½¸ˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµµ½‘•±Ìˆ¤ì(€€€Á…¹•°¹Í•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ°€‹š&šr'–ŞËš&O–ò–Ş—’ösšÖòë–’Çš¢‡–z/’â/¢öôˆ¤ì(€€€½¹ÍĞ¡•…‘•È€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰¡•…‘•Èˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ¡•…‘•Èˆ¤ì(€€€½¹ÍĞÑ¥Ñ±•I½Ü€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÑ¥Ñ±”µÉ½Üˆ¤ì(€€€Ñ¥Ñ±•I½Ü¹…ÁÁ•¹¡É•…Ñ•A…¹•±±•µ•¹Ğ ‰ Èˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÑ¥Ñ±”ˆ°€‹òë–’Çš¢‡–z/’â/¢öôˆ¤¤ì(€€€½¹ÍĞÉ•™É•Í €ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‰ÕÑÑ½¸ˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÉ•™É•Í ˆ°€‹–"ßšZÀˆ¤ì(€€€É•™É•Í ¹ÑåÁ”€ô€‰‰ÕÑÑ½¸ˆì(€€€É•™É•Í ¹Í•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ°€‹–"ßšZÃš&šr'–ŞËš&O–ò–Ş—’ösšÖòë–’Çš¢‡–z,ˆ¤ì(€€€Ñ¥Ñ±•I½Ü¹…ÁÁ•¹¡É•™É•Í ¤ì(€€€¡•…‘•È¹…ÁÁ•¹ (€€€€€€€Ñ¥Ñ±•I½Ü°(€€€€€€€É•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ¡¥¹Ğˆ°(€€€€€€€€€€€€‹šÆšïšÖ?¢#–f£’â·š&šr'–ŞËš&O–ò–Ş—’ösšÖj–£¦£¢*
ç’â/¢ö÷–f£’âš²‡¦n’â·–â›–º÷–º3š"C’â’â«š¢‡–z/¾ò3–Û’ög’îï–*‡¢«–*£š:K¦bˆ°(€€€€€€€€¤°(€€€€¤ì(€€€½¹ÍĞ½¹Ñ•¹Ğ€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ¤ì(€€€Á…¹•°¹…ÁÁ•¹¡¡•…‘•È°½¹Ñ•¹Ğ¤ì(€€€É½½Ğ¹…ÁÁ•¹¡ÍÑå±”°Á…¹•°¤ì((€€€½¹ÍĞ‘¥É•Ñ½İ¹±½…‘…‰±”€ô€¡µ½‘•°¤€ôø€ (€€€€€€€µ½‘•°¹‘½İ¹±½…‘…‰±”€˜˜¥Í¥É•Ñ½İ¹±½…¡•Ñ5½‘•±M½Á•1¥¹¬¡µ½‘•°¹¹…µ”°±¥¹­Í	å9…µ”¤¤(€€€€¤ì((€€€½¹ÍĞÉ•¹‘•È€ô€ ¤€ôøì(€€€€€€€É•™É•Í ¹‘¥Í…‰±•€ôÍÑ…Ñ”¹±½…‘¥¹œì(€€€€€€€½¹Ñ•¹Ğ¹É•Á±…•¡¥±‘É•¸ ¤ì(€€€€€€€¥˜€¡ÍÑ…Ñ”¹±½…‘¥¹œ€˜˜€…ÍÑ…Ñ”¹µ½‘•±Ì¹±•¹Ñ ¤ì(€€€€€€€€€€€½¹Ñ•¹Ğ¹…ÁÁ•¹¡É•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ•µÁÑäˆ°€‹š¶–r£šš~—š&šr'–ŞËš&O–ò–Ş—’ösšÖŠ˜ˆ¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€¥˜€¡ÍÑ…Ñ”¹•ÉÉ½È€˜˜€…ÍÑ…Ñ”¹µ½‘•±Ì¹±•¹Ñ ¤ì(€€€€€€€€€€€½¹Ñ•¹Ğ¹…ÁÁ•¹¡É•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ•ÉÉ½Èˆ°ÍÑ…Ñ”¹•ÉÉ½È¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô((€€€€€€€½¹ÍĞ…Ñ¥Ù•½Õ¹Ğ€ôÍÑ…Ñ”¹µ½‘•±Ì¹™¥±Ñ•È ¡µ½‘•°¤€ôø€ (€€€€€€€€€€€l‰ÅÕ•Õ•ˆ°€‰ÉÕ¹¹¥¹œˆ°€‰Á…ÕÍ•‰t¹¥¹±Õ‘•Ì (€€€€€€€€€€€€€€€‘½İ¹±½…‘MÑ…Ñ•	å9…µ”¹•Ğ¡µ½‘•°¹¹…µ”¤ü¹ÍÑ…ÑÕÌ°(€€€€€€€€€€€€¤(€€€€€€€€¤¤¹±•¹Ñ ì(€€€€€€€½¹ÍĞ‘½İ¹±½…‘…‰±•½Õ¹Ğ€ôÍÑ…Ñ”¹µ½‘•±Ì¹™¥±Ñ•È¡‘¥É•Ñ½İ¹±½…‘…‰±”¤¹±•¹Ñ ì(€€€€€€€½¹Ñ•¹Ğ¹…ÁÁ•¹¡É•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÍ½Á”ˆ°(€€€€€€€€€€€ƒ–ŞËšš~”€‘íÍÑ…Ñ”¹İ½É­™±½İ½Õ¹Ñôƒ’â«–ŞËš&O–ò–Ş—’ösšÖ€°(€€€€€€€€¤¤ì(€€€€€€€½¹ÍĞÍÕµµ…Éä€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÍÕµµ…Éäˆ¤ì(€€€€€€€™½È€¡½¹ÍĞmÙ…±Õ”°±…‰•±t½˜l(€€€€€€€€€€€mÍÑ…Ñ”¹µ½‘•±Ì¹±•¹Ñ °€‹òë–’Çš¢‡–z,‰t°(€€€€€€€€€€€m‘½İ¹±½…‘…‰±•½Õ¹Ğ°€‹–>¿¦®c¦’â/¢öô‰t°(€€€€€€€€€€€m…Ñ¥Ù•½Õ¹Ğ°€‹šÒï–*£’îï–*„‰t°(€€€€€€€t¤ì(€€€€€€€€€€€½¹ÍĞ¥Ñ•´€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÍÕµµ…Éäµ¥Ñ•´ˆ¤ì(€€€€€€€€€€€¥Ñ•´¹…ÁÁ•¹ (€€€€€€€€€€€€€€€É•…Ñ•A…¹•±±•µ•¹Ğ ‰ÍÁ…¸ˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÍÕµµ…ÉäµÙ…±Õ”ˆ°MÑÉ¥¹œ¡Ù…±Õ”¤¤°(€€€€€€€€€€€€€€€É•…Ñ•A…¹•±±•µ•¹Ğ ‰ÍÁ…¸ˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÍÕµµ…Éäµ±…‰•°ˆ°±…‰•°¤°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€ÍÕµµ…Éä¹…ÁÁ•¹¡¥Ñ•´¤ì(€€€€€€€ô(€€€€€€€½¹Ñ•¹Ğ¹…ÁÁ•¹¡ÍÕµµ…Éä¤ì((€€€€€€€½¹ÍĞ‰Õ±­Ñ¥½¹Ì€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ‰Õ±¬µ…Ñ¥½¹Ìˆ¤ì(€€€€€€€½¹ÍĞ‘½İ¹±½…‘±°€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€‰‰ÕÑÑ½¸ˆ°(€€€€€€€€€€€€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ‘½İ¹±½…µ…±°ˆ°(€€€€€€€€€€€ÍÑ…Ñ”¹ÍÑ…ÉÑ¥¹±°€ü€‹š¶–r£–*ƒ–—¦®c¦¦b–"_Š˜ˆ€è€‹’â¦R»¦®c¦’â/¢ö÷–£¦ ˆ°(€€€€€€€€¤ì(€€€€€€€‘½İ¹±½…‘±°¹ÑåÁ”€ô€‰‰ÕÑÑ½¸ˆì(€€€€€€€‘½İ¹±½…‘±°¹‘¥Í…‰±•€ôÍÑ…Ñ”¹ÍÑ…ÉÑ¥¹±°ñğ‘½İ¹±½…‘…‰±•½Õ¹Ğ€ôôô€Àì(€€€€€€€‘½İ¹±½…‘±°¹Í•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ°€‹’â¦R»¦®c¦’â/¢ö÷š&šr'–ŞËš&O–ò–Ş—’ösšÖj–£¦£òë–’Çš¢‡–z,ˆ¤ì(€€€€€€€‘½İ¹±½…‘±°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€€€€€€€€€ÍÑ…Ñ”¹ÍÑ…ÉÑ¥¹±°€ôÑÉÕ”ì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€€€™½È€¡½¹ÍĞµ½‘•°½˜ÍÑ…Ñ”¹µ½‘•±Ì¹™¥±Ñ•È¡‘¥É•Ñ½İ¹±½…‘…‰±”¤¤ì(€€€€€€€€€€€€€€€€€€€…İ…¥ĞÍÑ…ÉÑ…ÍÑ½İ¹±½…¡µ½‘•°¹¹…µ”°¹Õ±°°¹Õ±°°™…±Í”¤ì(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€ô™¥¹…±±äì(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹ÍÑ…ÉÑ¥¹±°€ô™…±Í”ì(€€€€€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€ô(€€€€€€€ô°ìÍ¥¹…°ô¤ì(€€€€€€€½¹ÍĞÁ…ÕÍ…‰±•½Õ¹Ğ€ôÍÑ…Ñ”¹µ½‘•±Ì¹™¥±Ñ•È ¡µ½‘•°¤€ôø€ (€€€€€€€€€€€l‰ÅÕ•Õ•ˆ°€‰ÉÕ¹¹¥¹œ‰t¹¥¹±Õ‘•Ì¡‘½İ¹±½…‘MÑ…Ñ•	å9…µ”¹•Ğ¡µ½‘•°¹¹…µ”¤ü¹ÍÑ…ÑÕÌ¤(€€€€€€€€¤¤¹±•¹Ñ ì(€€€€€€€½¹ÍĞÁ…ÕÍ•±°€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€‰‰ÕÑÑ½¸ˆ°(€€€€€€€€€€€€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÁ…ÕÍ”µ…±°ˆ°(€€€€€€€€€€€ÍÑ…Ñ”¹Á…ÕÍ¥¹±°€ü€‹šj–s’â·Š˜ˆ€è€‹’â¦R»šj–s–£¦ ˆ°(€€€€€€€€¤ì(€€€€€€€Á…ÕÍ•±°¹ÑåÁ”€ô€‰‰ÕÑÑ½¸ˆì(€€€€€€€Á…ÕÍ•±°¹‘¥Í…‰±•€ôÍÑ…Ñ”¹Á…ÕÍ¥¹±°ñğÁ…ÕÍ…‰±•½Õ¹Ğ€ôôô€Àì(€€€€€€€Á…ÕÍ•±°¹Í•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ°€‹’â¦R»šj–s–£¦£š¢‡–z/’â/¢öôˆ¤ì(€€€€€€€Á…ÕÍ•±°¹Ñ¥Ñ±”€ô€‹šj–s¢şC¢†3’â·–J3š:K¦b’â·j’îï–*‡¾ò3’şwVg’âÓš^ÛšZ’îÛ’â;–öO–&7¢şo–ê˜ˆì(€€€€€€€Á…ÕÍ•±°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€€€€€€€€€ÍÑ…Ñ”¹Á…ÕÍ¥¹±°€ôÑÉÕ”ì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€€€½¹ÍĞÉ•ÍÁ½¹Í”€ô…İ…¥Ğ™•Ñ  ˆ½Ñ½½±‰…œ½µ½‘•±Í½Á”½‘½İ¹±½…‘Ì½Á…ÕÍ”ˆ°ì(€€€€€€€€€€€€€€€€€€€µ•Ñ¡½è€‰A=MPˆ°(€€€€€€€€€€€€€€€€€€€Í¥¹…°°(€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÉ•ÍÁ½¹Í”¹©Í½¸ ¤ì(€€€€€€€€€€€€€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€€€€€€€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡É•ÍÕ±Ğ¹•ÉÉ½Èñğƒšj–s–’Ç¢Ò”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€™½È€¡½¹ÍĞ‘½İ¹±½…½˜É•ÍÕ±Ğ¹‘½İ¹±½…‘Ì€üümt¤ì(€€€€€€€€€€€€€€€€€€€‘½İ¹±½…‘MÑ…Ñ•	å9…µ”¹Í•Ğ¡‘½İ¹±½…¹¹…µ”°‘½İ¹±½…¤ì(€€€€€€€€€€€€€€€€€€€É•¹‘•É5½‘•±	ÕÑÑ½¹Ì¡‘½İ¹±½…¹¹…µ”°‘½İ¹±½…¤ì(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€€€€€¥˜€¡•ÉÉ½È¹¹…µ”€„ôô€‰‰½ÉÑÉÉ½Èˆ¤ì(€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹•ÉÉ½È€ô•ÉÉ½È¹µ•ÍÍ…”ñğ€‹šj–s–£¦£’â/¢ö÷–’Ç¢Ò”ˆì(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€ô™¥¹…±±äì(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Á…ÕÍ¥¹±°€ô™…±Í”ì(€€€€€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€ô(€€€€€€€ô°ìÍ¥¹…°ô¤ì(€€€€€€€‰Õ±­Ñ¥½¹Ì¹…ÁÁ•¹¡‘½İ¹±½…‘±°°Á…ÕÍ•±°¤ì(€€€€€€€½¹Ñ•¹Ğ¹…ÁÁ•¹¡‰Õ±­Ñ¥½¹Ì¤ì((€€€€€€€¥˜€ …ÍÑ…Ñ”¹µ½‘•±Ì¹±•¹Ñ ¤ì(€€€€€€€€€€€½¹Ñ•¹Ğ¹…ÁÁ•¹¡É•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€€€€€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ•µÁÑäˆ°(€€€€€€€€€€€€€€€€‹š&šr'–ŞËš&O–ò–Ş—’ösšÖ¦÷šÊ‡šr'òë–’Çš¢‡–z,ˆ°(€€€€€€€€€€€€¤¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô((€€€€€€€™½È€¡½¹ÍĞµ½‘•°½˜ÍÑ…Ñ”¹µ½‘•±Ì¤ì(€€€€€€€€€€€½¹ÍĞ…É€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰…ÉÑ¥±”ˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ…Éˆ¤ì(€€€€€€€€€€€…É¹…ÁÁ•¹¡É•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ¹…µ”ˆ°µ½‘•°¹¹…µ”¤¤ì(€€€€€€€€€€€½¹ÍĞµ•Ñ…A…ÉÑÌ€ôl(€€€€€€€€€€€€€€€µ½‘•°¹‘¥É•Ñ½Éä€üƒn»–öW¾òh‘íµ½‘•°¹‘¥É•Ñ½Éåõ€€èµ½‘•°¹É•…Í½¸°(€€€€€€€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤ì(€€€€€€€€€€€…É¹…ÁÁ•¹¡É•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€€€€€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµµ•Ñ„ˆ°(€€€€€€€€€€€€€€€µ•Ñ…A…ÉÑÌ¹©½¥¸ ˆƒ
Ü€ˆ¤°(€€€€€€€€€€€€¤¤ì(€€€€€€€€€€€½¹ÍĞİ½É­™±½İI•™•É•¹•Ì€ôİ½É­™±½İ9½‘•1…‰•±Í	å9…µ”¹•Ğ¡µ½‘•°¹¹…µ”¤ì(€€€€€€€€€€€™½È€¡½¹ÍĞmİ½É­™±½İ1…‰•°°¹½‘•1…‰•±ÍM•Ñt½˜İ½É­™±½İI•™•É•¹•Ì€üümt¤ì(€€€€€€€€€€€€€€€½¹ÍĞ¹½‘•1…‰•±Ì€ôl¸¸¹¹½‘•1…‰•±ÍM•Ñtì(€€€€€€€€€€€€€€€½¹ÍĞÙ¥Í¥‰±•9½‘•1…‰•±Ì€ô¹½‘•1…‰•±Ì¹Í±¥” À°€Ì¤ì(€€€€€€€€€€€€€€€½¹ÍĞ¹½‘•MÕµµ…Éä€ôÙ¥Í¥‰±•9½‘•1…‰•±Ì¹±•¹Ñ (€€€€€€€€€€€€€€€€€€€€ü€‘íÙ¥Í¥‰±•9½‘•1…‰•±Ì¹©½¥¸ ‹ˆ¥ô‘ì(€€€€€€€€€€€€€€€€€€€€€€€¹½‘•1…‰•±Ì¹±•¹Ñ €øÙ¥Í¥‰±•9½‘•1…‰•±Ì¹±•¹Ñ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€ƒ¶$€‘í¹½‘•1…‰•±Ì¹±•¹Ñ¡ôƒ’â«¢*
å€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€ˆˆ(€€€€€€€€€€€€€€€€€€€õ€(€€€€€€€€€€€€€€€€€€€€è€‹–Ş—’ösšÖêŸ–òWR ˆì(€€€€€€€€€€€€€€€…É¹…ÁÁ•¹¡É•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€€€€€€€€€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÉ•™•É•¹”ˆ°(€€€€€€€€€€€€€€€€€€€ƒ–Ş—’ösšÖ¾òh‘íİ½É­™±½İ1…‰•±ôƒ
Üƒ¢*
ç¾òh‘í¹½‘•MÕµµ…Éåõ€°(€€€€€€€€€€€€€€€€¤¤ì(€€€€€€€€€€€ô((€€€€€€€€€€€½¹ÍĞ‘½İ¹±½…‘MÑ…Ñ”€ô‘½İ¹±½…‘MÑ…Ñ•	å9…µ”¹•Ğ¡µ½‘•°¹¹…µ”¤ì(€€€€€€€€€€€¥˜€¡‘½İ¹±½…‘MÑ…Ñ”ü¹Ñ½Ñ…°¤ì(€€€€€€€€€€€€€€€½¹ÍĞÁ•É•¹Ğ€ô5…Ñ ¹µ¥¸ (€€€€€€€€€€€€€€€€€€€‘½İ¹±½…‘MÑ…Ñ”¹‘½İ¹±½…‘•€¼‘½İ¹±½…‘MÑ…Ñ”¹Ñ½Ñ…°€¨€ÄÀÀ°(€€€€€€€€€€€€€€€€€€€€ÄÀÀ°(€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€½¹ÍĞÁÉ½É•ÍÍ1…‰•°€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€€€€€€€€€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÁÉ½É•ÍÌµ±…‰•°ˆ°(€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€ÁÉ½É•ÍÍ1…‰•°¹…ÁÁ•¹ (€€€€€€€€€€€€€€€€€€€É•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€€€€€€€€€€€€€‰ÍÁ…¸ˆ°(€€€€€€€€€€€€€€€€€€€€€€€€ˆˆ°(€€€€€€€€€€€€€€€€€€€€€€€‘½İ¹±½…‘MÑ…Ñ”¹ÍÑ…ÑÕÌ€ôôô€‰ÅÕ•Õ•ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€üƒš:K¦b²°€‘í‘½İ¹±½…‘MÑ…Ñ”¹ÅÕ•Õ•}Á½Í¥Ñ¥½¸€üü€ˆü‰ôƒ’ö5€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‘íÁ•É•¹Ğ¹Ñ½¥á• Ä¥ô•€°(€€€€€€€€€€€€€€€€€€€€¤°(€€€€€€€€€€€€€€€€€€€É•…Ñ•A…¹•±±•µ•¹Ğ (€€€€€€€€€€€€€€€€€€€€€€€€‰ÍÁ…¸ˆ°(€€€€€€€€€€€€€€€€€€€€€€€€ˆˆ°(€€€€€€€€€€€€€€€€€€€€€€€‘½İ¹±½…‘MÑ…Ñ”¹ÍÑ…ÑÕÌ€ôôô€‰ÉÕ¹¹¥¹œˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‘í™½Éµ…Ñ	åÑ•Ì¡‘½İ¹±½…‘MÑ…Ñ”¹ÍÁ••¥ô½Í€(€€€€€€€€€€€€€€€€€€€€€€€€€€€€è™½Éµ…Ñ	åÑ•Ì¡‘½İ¹±½…‘MÑ…Ñ”¹‘½İ¹±½…‘•¤°(€€€€€€€€€€€€€€€€€€€€¤°(€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€½¹ÍĞÁÉ½É•ÍÌ€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÁÉ½É•ÍÌˆ¤ì(€€€€€€€€€€€€€€€½¹ÍĞ™¥±°€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµÁÉ½É•ÍÌµ™¥±°ˆ¤ì(€€€€€€€€€€€€€€€™¥±°¹ÍÑå±”¹İ¥‘Ñ €ô€‘íÁ•É•¹Ñô•€ì(€€€€€€€€€€€€€€€ÁÉ½É•ÍÌ¹…ÁÁ•¹¡™¥±°¤ì(€€€€€€€€€€€€€€€…É¹…ÁÁ•¹¡ÁÉ½É•ÍÍ1…‰•°°ÁÉ½É•ÍÌ¤ì(€€€€€€€€€€€ô((€€€€€€€€€€€½¹ÍĞ…Ñ¥½¹Ì€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ…Ñ¥½¹Ìˆ¤ì(€€€€€€€€€€€½¹ÍĞ…Ñ¥½¸€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‰ÕÑÑ½¸ˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ…Ñ¥½¸ˆ¤ì(€€€€€€€€€€€…Ñ¥½¸¹ÑåÁ”€ô€‰‰ÕÑÑ½¸ˆì(€€€€€€€€€€€…Ñ¥½¸¹‘…Ñ…Í•Ğ¹µ½‘•±9…µ”€ôµ½‘•°¹¹…µ”ì(€€€€€€€€€€€…Ñ¥½¸¹Í•ÑÑÑÉ¥‰ÕÑ”¡	UQQ=9}QQI%	UQ°€ˆˆ¤ì(€€€€€€€€€€€É•¹‘•É½İ¹±½…‘MÑ…Ñ”¡…Ñ¥½¸°‘½İ¹±½…‘MÑ…Ñ”¤ì(€€€€€€€€€€€¥˜€ …‘¥É•Ñ½İ¹±½…‘…‰±”¡µ½‘•°¤€˜˜€…‘½İ¹±½…‘MÑ…Ñ”¤ì(€€€€€€€€€€€€€€€…Ñ¥½¸¹Ñ•áÑ½¹Ñ•¹Ğ€ô€‹š&O–ò 5½‘•±M½Á”ƒšBsÒˆˆì(€€€€€€€€€€€ô(€€€€€€€€€€€…Ñ¥½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€€€€€€€€€‰±¥¬ˆ°(€€€€€€€€€€€€€€€€ ¤€ôøÍÑ…ÉÑ…ÍÑ½İ¹±½…¡µ½‘•°¹¹…µ”°…Ñ¥½¸¤°(€€€€€€€€€€€€€€€ìÍ¥¹…°ô°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€½¹ÍĞ…¹•°€ôÉ•…Ñ•A…¹•±±•µ•¹Ğ ‰‰ÕÑÑ½¸ˆ°€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµ…¹•°ˆ°€‹–>[šÚ ˆ¤ì(€€€€€€€€€€€…¹•°¹ÑåÁ”€ô€‰‰ÕÑÑ½¸ˆì(€€€€€€€€€€€…¹•°¹‘…Ñ…Í•Ğ¹µ½‘•±9…µ”€ôµ½‘•°¹¹…µ”ì(€€€€€€€€€€€…¹•°¹Í•ÑÑÑÉ¥‰ÕÑ”¡91}QQI%	UQ°€ˆˆ¤ì(€€€€€€€€€€€É•¹‘•É…¹•±MÑ…Ñ”¡…¹•°°‘½İ¹±½…‘MÑ…Ñ”¤ì(€€€€€€€€€€€…¹•°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€€€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€€€€€€€…İ…¥Ğ…¹•±½İ¹±½…¡µ½‘•°¹¹…µ”¤ì(€€€€€€€€€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€€€€€€€€€…¹•°¹Ñ¥Ñ±”€ô•ÉÉ½È¹µ•ÍÍ…”ì(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€ô°ìÍ¥¹…°ô¤ì(€€€€€€€€€€€…Ñ¥½¹Ì¹…ÁÁ•¹¡…Ñ¥½¸°…¹•°¤ì(€€€€€€€€€€€…É¹…ÁÁ•¹¡…Ñ¥½¹Ì¤ì(€€€€€€€€€€€½¹Ñ•¹Ğ¹…ÁÁ•¹¡…É¤ì(€€€€€€€ô(€€€ôì((€€€½¹ÍĞ±½…€ô…Íå¹Œ€ ¤€ôøì(€€€€€€€¥˜€¡Í¥¹…°¹…‰½ÉÑ•¤É•ÑÕÉ¸ì(€€€€€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ì(€€€€€€€ÍÑ…Ñ”¹•ÉÉ½È€ô€ˆˆì(€€€€€€€É•¹‘•È ¤ì(€€€€€€€ÑÉäì(€€€€€€€€€€€ÍÑ…Ñ”¹İ½É­™±½İ½Õ¹Ğ€ô…İ…¥ĞÉ•‰Õ¥±‘=Á•¹]½É­™±½İ5½‘•±%¹‘•à ¤ì(€€€€€€€€€€€ÍÑ…Ñ”¹İ½É­™±½İM¥¹…ÑÕÉ”€ô•Ñ=Á•¹]½É­™±½İM¥¹…ÑÕÉ” ¤ì(€€€€€€€€€€€½¹ÍĞµ½‘•±Ì€ôl¸¸¹µ½‘•±Í	å9…µ”¹Ù…±Õ•Ì ¥t¹µ…À ¡µ½‘•°¤€ôø€¡ì(€€€€€€€€€€€€€€€€¸¸¹µ½‘•°°(€€€€€€€€€€€€€€€ÕÉ°è•Ñ5½‘•±M½Á•1¥¹¬¡µ½‘•°¹¹…µ”°±¥¹­Í	å9…µ”¤°(€€€€€€€€€€€ô¤¤ì(€€€€€€€€€€€½¹ÍĞÉ•ÍÁ½¹Í”€ô…İ…¥Ğ™•Ñ  ˆ½Ñ½½±‰…œ½µ½‘•±Ì½µ¥ÍÍ¥¹œˆ°ì(€€€€€€€€€€€€€€€µ•Ñ¡½è€‰A=MPˆ°(€€€€€€€€€€€€€€€¡•…‘•ÉÌèì€‰½¹Ñ•¹ĞµQåÁ”ˆè€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆô°(€€€€€€€€€€€€€€€‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡ìµ½‘•±Ìô¤°(€€€€€€€€€€€€€€€Í¥¹…°°(€€€€€€€€€€€ô¤ì(€€€€€€€€€€€½¹ÍĞ¥¹ÍÁ•Ñ•€ô…İ…¥ĞÉ•ÍÁ½¹Í”¹©Í½¸ ¤ì(€€€€€€€€€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤Ñ¡É½Ü¹•ÜÉÉ½È¡¥¹ÍÁ•Ñ•¹•ÉÉ½È€üü€‹šš~—òë–’Çš¢‡–z/–’Ç¢Ò”ˆ¤ì(€€€€€€€€€€€ÍÑ…Ñ”¹µ½‘•±Ì€ô¥¹ÍÁ•Ñ•¹™¥±Ñ•È ¡µ½‘•°¤€ôø€…µ½‘•°¹¥¹ÍÑ…±±•¤ì(€€€€€€€€€€€…İ…¥ĞÍå¹½İ¹±½…‘MÑ…Ñ•Ì ¤ì(€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€¥˜€¡•ÉÉ½È¹¹…µ”€„ôô€‰‰½ÉÑÉÉ½Èˆ¤ì(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹•ÉÉ½È€ô•ÉÉ½È¹µ•ÍÍ…”ñğ€‹šš~—òë–’Çš¢‡–z/–’Ç¢Ò”ˆì(€€€€€€€€€€€ô(€€€€€€€ô™¥¹…±±äì(€€€€€€€€€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ì(€€€€€€€€€€€¥˜€ …Í¥¹…°¹…‰½ÉÑ•¤É•¹‘•È ¤ì(€€€€€€€ô(€€€ôì((€€€É•™É•Í ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€€€€€…İ…¥Ğ…ÁÀ¹É•™É•Í¡5¥ÍÍ¥¹5½‘•±Ìü¸¡ìÍ¥±•¹ĞèÑÉÕ”ô¤ì(€€€€€€€…İ…¥Ğ±½… ¤ì(€€€ô°ìÍ¥¹…°ô¤ì(€€€Í¥‘•‰…ÉA…¹•±I•¹‘•È€ôÉ•¹‘•Èì(€€€Í¥‘•‰…ÉA…¹•±I•±½…€ô±½…ì(€€€½¹ÍĞÑ¥µ•È€ôİ¥¹‘½Ü¹Í•Ñ%¹Ñ•ÉÙ…°¡…Íå¹Œ€ ¤€ôøì(€€€€€€€¥˜€ …ÍÑ…Ñ”¹±½…‘¥¹œ€˜˜ÍÑ…Ñ”¹İ½É­™±½İM¥¹…ÑÕÉ”€„ôô•Ñ=Á•¹]½É­™±½İM¥¹…ÑÕÉ” ¤¤ì(€€€€€€€€€€€…İ…¥Ğ±½… ¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€ÑÉäì(€€€€€€€€€€€…İ…¥ĞÍå¹½İ¹±½…‘MÑ…Ñ•Ì ¤ì(€€€€€€€ô…Ñ ì(€€€€€€€€€€€€¼¼-••ÀÑ¡”±…ÍĞ­¹½İ¸ÍÑ…Ñ”‘ÕÉ¥¹œÑÉ…¹Í¥•¹Ğ½¹¹•Ñ¥½¸™…¥±ÕÉ•Ì¸(€€€€€€€ô(€€€€€€€¥˜€ …Í¥¹…°¹…‰½ÉÑ•¤É•¹‘•È ¤ì(€€€ô°€ÄÀÀÀ¤ì(€€€Í¥¹…°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉĞˆ°€ ¤€ôøì(€€€€€€€İ¥¹‘½Ü¹±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤ì(€€€€€€€¥˜€¡Í¥‘•‰…ÉA…¹•±I•¹‘•È€ôôôÉ•¹‘•È¤Í¥‘•‰…ÉA…¹•±I•¹‘•È€ôÕ¹‘•™¥¹•ì(€€€€€€€¥˜€¡Í¥‘•‰…ÉA…¹•±I•±½…€ôôô±½…¤Í¥‘•‰…ÉA…¹•±I•±½…€ôÕ¹‘•™¥¹•ì(€€€ô°ì½¹”èÑÉÕ”ô¤ì(€€€±½… ¤ì)ô()±•Ğµ¥ÍÍ¥¹5½‘•±ÍA…¹•±½¹ÑÉ½±±•Èì()…ÁÀ¹É•¥ÍÑ•ÉáÑ•¹Í¥½¸¡ì(€€€¹…µ”è€‰½µ™åU$¹Q½½±	…œ¹5½‘•±M½Á•5¥ÍÍ¥¹5½‘•±Ìˆ°((€€€…Íå¹ŒÍ•ÑÕÀ ¤ì(€€€€€€€½¹ÍĞ½‰Í•ÉÙ•È€ô¹•Ü5ÕÑ…Ñ¥½¹=‰Í•ÉÙ•È¡ÅÕ•Õ•	ÕÑÑ½¹I•™É•Í ¤ì(€€€€€€€½‰Í•ÉÙ•È¹½‰Í•ÉÙ”¡‘½Õµ•¹Ğ¹‰½‘ä°ì¡¥±‘1¥ÍĞèÑÉÕ”°ÍÕ‰ÑÉ•”èÑÉÕ”ô¤ì(€€€€€€€ÅÕ•Õ•	ÕÑÑ½¹I•™É•Í  ¤ì(€€€€€€€Íå¹½İ¹±½…‘MÑ…Ñ•Ì ¤¹…Ñ   ¤€ôøíô¤ì(€€€€€€€…ÁÀ¹•áÑ•¹Í¥½¹5…¹…•È¹É•¥ÍÑ•ÉM¥‘•‰…ÉQ…ˆ¡ì(€€€€€€€€€€€¥è€‰Ñ½½±‰…œµµ¥ÍÍ¥¹œµµ½‘•±Ìˆ°(€€€€€€€€€€€¥½¸è€‰Á¤Á¤µ‘½İ¹±½…ˆ°(€€€€€€€€€€€Ñ¥Ñ±”è€‹òë–’Çš¢‡–z/’â/¢öôˆ°(€€€€€€€€€€€Ñ½½±Ñ¥Àè€‹šÆšïš&šr'–ŞËš&O–ò–Ş—’ösšÖòë–’Çš¢‡–z/–æÛî’âš:Ÿ–"Û¦®c¦’â/¢öôˆ°(€€€€€€€€€€€ÑåÁ”è€‰ÕÍÑ½´ˆ°(€€€€€€€€€€€É•¹‘•È¡•±•µ•¹Ğ¤ì(€€€€€€€€€€€€€€€µ¥ÍÍ¥¹5½‘•±ÍA…¹•±½¹ÑÉ½±±•Èü¹…‰½ÉĞ ¤ì(€€€€€€€€€€€€€€€µ¥ÍÍ¥¹5½‘•±ÍA…¹•±½¹ÑÉ½±±•È€ô¹•Ü‰½ÉÑ½¹ÑÉ½±±•È ¤ì(€€€€€€€€€€€€€€€É•…Ñ•5¥ÍÍ¥¹5½‘•±ÍA…¹•° (€€€€€€€€€€€€€€€€€€€•±•µ•¹Ğ°(€€€€€€€€€€€€€€€€€€€µ¥ÍÍ¥¹5½‘•±ÍA…¹•±½¹ÑÉ½±±•È¹Í¥¹…°°(€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€ô°(€€€€€€€€€€€‘•ÍÑÉ½ä ¤ì(€€€€€€€€€€€€€€€µ¥ÍÍ¥¹5½‘•±ÍA…¹•±½¹ÑÉ½±±•Èü¹…‰½ÉĞ ¤ì(€€€€€€€€€€€€€€€µ¥ÍÍ¥¹5½‘•±ÍA…¹•±½¹ÑÉ½±±•È€ôÕ¹‘•™¥¹•ì(€€€€€€€€€€€ô°(€€€€€€€ô¤ì(€€€ô°((€€€…Íå¹Œ‰•™½É•½¹™¥ÕÉ•É…Á ¡É…Á¡…Ñ„¤ì(€€€€€€€±¥¹­Í	å9…µ”¹±•…È ¤ì(€€€€€€€µ½‘•±Í	å9…µ”¹±•…È ¤ì(€€€€€€€¹½‘•1…‰•±Í	å9…µ”¹±•…È ¤ì(€€€€€€€İ½É­™±½İ9½‘•1…‰•±Í	å9…µ”¹±•…È ¤ì(€€€€€€€É•İÉ¥Ñ•]½É­™±½İ5½‘•±UÉ±Ì¡É…Á¡…Ñ„°±¥¹­Í	å9…µ”°µ½‘•±Í	å9…µ”¤ì(€€€€€€€¥¹‘•á]½É­™±½İ9½‘•Ì¡É…Á¡…Ñ„°l¸¸¹µ½‘•±Í	å9…µ”¹­•åÌ ¥t°€‹–öO–&7–Ş—’ösšÖˆ¤ì(€€€€€€€İ¥¹‘½Ü¹Í•ÑQ¥µ•½ÕĞ  ¤€ôøÍ¥‘•‰…ÉA…¹•±I•±½…ü¸ ¤°€À¤ì(€€€ô°((€€€…Íå¹Œ±½…‘•‘É…Á¡9½‘”¡¹½‘”¤ì(€€€€€€€É•İÉ¥Ñ•]½É­™±½İ5½‘•±UÉ±Ì¡¹½‘”°±¥¹­Í	å9…µ”°µ½‘•±Í	å9…µ”¤ì(€€€€€€€¥¹‘•á9½‘•5½‘•±I•™•É•¹•Ì¡¹½‘”¤ì(€€€ô°)ô¤ì(