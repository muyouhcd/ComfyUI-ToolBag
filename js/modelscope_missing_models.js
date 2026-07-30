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
        button.textContent = "高速下载";
        return;
    }
    if (state.status === "queued") {
        button.textContent = state.queue_position
            ? `排队中 · 第 ${state.queue_position} 个`
            : "排队中";
        button.title = "已进入高速下载队列；点击可暂停此任务";
        button.disabled = false;
        return;
    }
    if (state.status === "running") {
        const percent = state.total
            ? (state.downloaded / state.total * 100).toFixed(1)
            : "0.0";
        button.textContent = state.stalled
            ? `${percent}% · 正在重连…`
            : `${percent}% · ${formatBytes(state.downloaded)} · ${formatBytes(state.speed)}/s`;
        button.title = state.stalled
            ? "连接超过 5 秒没有收到数据，下载器将自动重连"
            : `已下载 ${formatBytes(state.downloaded)} / ${formatBytes(state.total)}；点击暂停`;
        button.disabled = false;
        return;
    }
    if (state.status === "paused") {
        button.textContent = "继续下载";
        button.title = "点击继续下载";
        button.disabled = false;
        return;
    }
    if (state.status === "complete") {
        button.textContent = "已安装";
        button.disabled = true;
        return;
    }
    if (state.status === "canceled") {
        button.textContent = "高速下载";
        button.title = "使用 ModelScope 国内镜像并发下载";
        button.disabled = false;
        return;
    }
    button.textContent = "下载失败";
    button.disabled = false;
    button.title = state.error ?? "下载失败";
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
        if (!response.ok) throw new Error(state.error ?? "无法读取下载进度");
        downloadStateByName.set(modelName, state);
        addModelScopeButtons();
        renderModelButtons(modelName, state);

        if (state.status === "complete") {
            await app.refreshMissingModels?.({ silent: true });
            await sidebarPanelReload?.();
            return;
        }
        if (state.status === "canceled") return;
        if (state.status === "error") throw new Error(state.error ?? "下载失败");
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
    if (!response.ok) throw new Error(states.error ?? "无法读取下载任务");
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
    if (!response.ok) throw new Error(updated.error ?? "无法切换下载状态");
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
    if (!response.ok) throw new Error(updated.error ?? "无法取消下载");
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
        button.textContent = "准备下载…";
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
        if (!response.ok) throw new Error(state.error ?? "无法开始下载");
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
        if (!token && (error.message.includes("登录") || error.message.includes("授权"))) {
            const accessToken = window.prompt(
                "请输入 ModelScope Access Token（仅用于本次下载，不会保存）：",
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
    button.title = "使用 ModelScope 国内镜像并发下载";
    button.setAttribute("aria-label", `从 ModelScope 下载 ${modelName}`);
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
    button.textContent = "×";
    button.title = "取消下载并清空临时内容";
    button.setAttribute("aria-label", `取消下载 ${modelName}`);
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
        ? "子图节点"
        : (rawLabel || `节点 ${node.id ?? ""}`);
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
            indexWorkflowNodes(node, modelNames, workflowLabel, visited);
        }
    }
    for (const [key, value] of Object.entries(graphData)) {
        if (key !== "nodes") {
            indexWorkflowNodes(value, modelNames, workflowLabel, visited);
        }
    }
}

function getOpenWorkflows() {
    return [...(app.extensionManager?.workflow?.openWorkflows ?? [])].filter(Boolean);
}

function getWorkflowLabel(workflow, index) {
    return workflow?.filename
        || workflow?.key
        || workflow?.path
        || `已打开工作流 ${index + 1}`;
}

function getOpenWorkflowSignature() {
    return getOpenWorkflows()
        .map((workflow, index) => workflow?.path || getWorkflowLabel(workflow, index))
        .join("\n");
}

async function rebuildOpenWorkflowModelIndex() {
    linksByName.clear();
    modelsByName.clear();
    nodeLabelsByName.clear();
    workflowNodeLabelsByName.clear();

    const workflows = getOpenWorkflows();
    for (const [index, workflow] of workflows.entries()) {
        if (!workflow.isLoaded && typeof workflow.load === "function") {
            await workflow.load();
        }
        const graphData = workflow.activeState ?? workflow.initialState;
        if (!graphData) continue;

        const workflowLabel = getWorkflowLabel(workflow, index);
        const workflowLinks = new Map();
        const workflowModels = new Map();
        rewriteWorkflowModelUrls(graphData, workflowLinks, workflowModels);
        for (const [name, link] of workflowLinks) linksByName.set(name, link);
        for (const [name, model] of workflowModels) {
            modelsByName.set(name, model);
            if (!workflowNodeLabelsByName.has(name)) {
                workflowNodeLabelsByName.set(name, new Map());
            }
            const references = workflowNodeLabelsByName.get(name);
            if (!references.has(workflowLabel)) {
                references.set(workflowLabel, new Set());
            }
        }
        indexWorkflowNodes(graphData, [...workflowModels.keys()], workflowLabel);
    }
    return workflows.length;
}

const missingModelsStyles = `
    .toolbag-missing-models { height: 100%; min-width: 0; overflow: auto; padding: 14px; box-sizing: border-box; color: var(--fg-color, #ddd); background: var(--comfy-menu-bg, #202020); }
    .toolbag-missing-header { position: sticky; z-index: 2; top: -14px; margin: -14px -14px 12px; padding: 15px 14px 11px; border-bottom: 1px solid var(--border-color, #444); background: var(--comfy-menu-bg, #202020); }
    .toolbag-missing-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .toolbag-missing-title { margin: 0; font-size: 16px; font-weight: 650; }
    .toolbag-missing-refresh { border: 0; border-radius: 6px; padding: 6px 9px; cursor: pointer; color: inherit; background: var(--comfy-input-bg, #333); }
    .toolbag-missing-refresh:hover, .toolbag-missing-download-all:hover, .toolbag-missing-pause-all:hover { filter: brightness(1.15); }
    .toolbag-missing-refresh:disabled, .toolbag-missing-download-all:disabled, .toolbag-missing-pause-all:disabled { cursor: wait; opacity: .55; }
    .toolbag-missing-hint { margin-top: 7px; color: var(--descrip-text, #aaa); font-size: 11px; line-height: 1.45; }
    .toolbag-missing-scope { margin-bottom: 9px; color: var(--descrip-text, #aaa); font-size: 11px; }
    .toolbag-missing-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin-bottom: 10px; }
    .toolbag-missing-summary-item { min-width: 0; padding: 8px; border-radius: 7px; background: var(--comfy-input-bg, #292929); }
    .toolbag-missing-summary-value { display: block; overflow: hidden; font-size: 16px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .toolbag-missing-summary-label { display: block; margin-top: 2px; color: var(--descrip-text, #aaa); font-size: 10px; }
    .toolbag-missing-bulk-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; margin-bottom: 12px; }
    .toolbag-missing-download-all, .toolbag-missing-pause-all { border-radius: 7px; padding: 9px 12px; cursor: pointer; font-weight: 650; }
    .toolbag-missing-download-all { border: 0; color: white; background: #287db5; }
    .toolbag-missing-pause-all { border: 1px solid #c18b36; color: #ffd999; background: rgb(193 139 54 / 12%); }
    .toolbag-missing-card { margin-bottom: 8px; padding: 10px; border: 1px solid var(--border-color, #444); border-radius: 9px; background: var(--comfy-input-bg, #292929); }
    .toolbag-missing-name { overflow-wrap: anywhere; font-size: 13px; font-weight: 650; }
    .toolbag-missing-meta { margin-top: 5px; color: var(--descrip-text, #aaa); font-size: 10px; line-height: 1.4; }
    .toolbag-missing-reference { margin-top: 5px; padding-left: 7px; border-left: 2px solid rgb(67 166 221 / 55%); color: var(--descrip-text, #aaa); font-size: 10px; line-height: 1.45; overflow-wrap: anywhere; }
    .toolbag-missing-progress-label { display: flex; justify-content: space-between; gap: 8px; margin-top: 9px; color: var(--descrip-text, #aaa); font-size: 10px; }
    .toolbag-missing-progress { height: 6px; margin-top: 5px; overflow: hidden; border-radius: 99px; background: rgb(127 127 127 / 22%); }
    .toolbag-missing-progress-fill { height: 100%; border-radius: inherit; background: #43a6dd; transition: width .35s ease; }
    .toolbag-missing-actions { display: grid; grid-template-columns: 1fr auto; gap: 7px; margin-top: 9px; }
    .toolbag-missing-action, .toolbag-missing-cancel { border-radius: 6px; padding: 7px 9px; cursor: pointer; color: inherit; background: transparent; font-size: 11px; }
    .toolbag-missing-action { border: 1px solid #3986b8; }
    .toolbag-missing-action:hover { color: white; background: #287db5; }
    .toolbag-missing-cancel { display: none; border: 1px solid #9f3a3a; color: #ffabab; }
    .toolbag-missing-cancel:hover { color: white; background: #9f3a3a; }
    .toolbag-missing-empty, .toolbag-missing-error { padding: 28px 8px; color: var(--descrip-text, #aaa); text-align: center; }
    .toolbag-missing-error { color: #ff8f8f; }
`;

const createPanelElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};

function createMissingModelsPanel(root, signal) {
    const state = {
        models: [],
        workflowCount: 0,
        workflowSignature: "",
        loading: true,
        startingAll: false,
        pausingAll: false,
        error: "",
    };

    root.replaceChildren();
    const style = createPanelElement("style");
    style.textContent = missingModelsStyles;
    const panel = createPanelElement("section", "toolbag-missing-models");
    panel.setAttribute("aria-label", "所有已打开工作流缺失模型下载");
    const header = createPanelElement("header", "toolbag-missing-header");
    const titleRow = createPanelElement("div", "toolbag-missing-title-row");
    titleRow.append(createPanelElement("h2", "toolbag-missing-title", "缺失模型下载"));
    const refresh = createPanelElement("button", "toolbag-missing-refresh", "刷新");
    refresh.type = "button";
    refresh.setAttribute("aria-label", "刷新所有已打开工作流缺失模型");
    titleRow.append(refresh);
    header.append(
        titleRow,
        createPanelElement(
            "div",
            "toolbag-missing-hint",
            "汇总浏览器中所有已打开工作流的全部节点。下载器一次集中带宽完成一个模型，其余任务自动排队。",
        ),
    );
    const content = createPanelElement("div");
    panel.append(header, content);
    root.append(style, panel);

    const directDownloadable = (model) => (
        model.downloadable && isDirectDownload(getModelScopeLink(model.name, linksByName))
    );

    const render = () => {
        refresh.disabled = state.loading;
        content.replaceChildren();
        if (state.loading && !state.models.length) {
            content.append(createPanelElement("div", "toolbag-missing-empty", "正在检查所有已打开工作流…"));
            return;
        }
        if (state.error && !state.models.length) {
            content.append(createPanelElement("div", "toolbag-missing-error", state.error));
            return;
        }

        const activeCount = state.models.filter((model) => (
            ["queued", "running", "paused"].includes(
                downloadStateByName.get(model.name)?.status,
            )
        )).length;
        const downloadableCount = state.models.filter(directDownloadable).length;
        content.append(createPanelElement(
            "div",
            "toolbag-missing-scope",
            `已检查 ${state.workflowCount} 个已打开工作流`,
        ));
        const summary = createPanelElement("div", "toolbag-missing-summary");
        for (const [value, label] of [
            [state.models.length, "缺失模型"],
            [downloadableCount, "可高速下载"],
            [activeCount, "活动任务"],
        ]) {
            const item = createPanelElement("div", "toolbag-missing-summary-item");
            item.append(
                createPanelElement("span", "toolbag-missing-summary-value", String(value)),
                createPanelElement("span", "toolbag-missing-summary-label", label),
            );
            summary.append(item);
        }
        content.append(summary);

        const bulkActions = createPanelElement("div", "toolbag-missing-bulk-actions");
        const downloadAll = createPanelElement(
            "button",
            "toolbag-missing-download-all",
            state.startingAll ? "正在加入高速队列…" : "一键高速下载全部",
        );
        downloadAll.type = "button";
        downloadAll.disabled = state.startingAll || downloadableCount === 0;
        downloadAll.setAttribute("aria-label", "一键高速下载所有已打开工作流的全部缺失模型");
        downloadAll.addEventListener("click", async () => {
            state.startingAll = true;
            render();
            try {
                for (const model of state.models.filter(directDownloadable)) {
                    await startFastDownload(model.name, null, null, false);
                }
            } finally {
                state.startingAll = false;
                render();
            }
        }, { signal });
        const pausableCount = state.models.filter((model) => (
            ["queued", "running"].includes(downloadStateByName.get(model.name)?.status)
        )).length;
        const pauseAll = createPanelElement(
            "button",
            "toolbag-missing-pause-all",
            state.pausingAll ? "暂停中…" : "一键暂停全部",
        );
        pauseAll.type = "button";
        pauseAll.disabled = state.pausingAll || pausableCount === 0;
        pauseAll.setAttribute("aria-label", "一键暂停全部模型下载");
        pauseAll.title = "暂停运行中和排队中的任务，保留临时文件与当前进度";
        pauseAll.addEventListener("click", async () => {
            state.pausingAll = true;
            render();
            try {
                const response = await fetch("/toolbag/modelscope/downloads/pause", {
                    method: "POST",
                    signal,
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || `暂停失败 (${response.status})`);
                }
                for (const download of result.downloads ?? []) {
                    downloadStateByName.set(download.name, download);
                    renderModelButtons(download.name, download);
                }
            } catch (error) {
                if (error.name !== "AbortError") {
                    state.error = error.message || "暂停全部下载失败";
                }
            } finally {
                state.pausingAll = false;
                render();
            }
        }, { signal });
        bulkActions.append(downloadAll, pauseAll);
        content.append(bulkActions);

        if (!state.models.length) {
            content.append(createPanelElement(
                "div",
                "toolbag-missing-empty",
                "所有已打开工作流都没有缺失模型",
            ));
            return;
        }

        for (const model of state.models) {
            const card = createPanelElement("article", "toolbag-missing-card");
            card.append(createPanelElement("div", "toolbag-missing-name", model.name));
            const metaParts = [
                model.directory ? `目录：${model.directory}` : model.reason,
            ].filter(Boolean);
            card.append(createPanelElement(
                "div",
                "toolbag-missing-meta",
                metaParts.join(" · "),
            ));
            const workflowReferences = workflowNodeLabelsByName.get(model.name);
            for (const [workflowLabel, nodeLabelsSet] of workflowReferences ?? []) {
                const nodeLabels = [...nodeLabelsSet];
                const visibleNodeLabels = nodeLabels.slice(0, 3);
                const nodeSummary = visibleNodeLabels.length
                    ? `${visibleNodeLabels.join("、")}${
                        nodeLabels.length > visibleNodeLabels.length
                            ? ` 等 ${nodeLabels.length} 个节点`
                            : ""
                    }`
                    : "工作流级引用";
                card.append(createPanelElement(
                    "div",
                    "toolbag-missing-reference",
                    `工作流：${workflowLabel} · 节点：${nodeSummary}`,
                ));
            }

            const downloadState = downloadStateByName.get(model.name);
            if (downloadState?.total) {
                const percent = Math.min(
                    downloadState.downloaded / downloadState.total * 100,
                    100,
                );
                const progressLabel = createPanelElement(
                    "div",
                    "toolbag-missing-progress-label",
                );
                progressLabel.append(
                    createPanelElement(
                        "span",
                        "",
                        downloadState.status === "queued"
                            ? `排队第 ${downloadState.queue_position ?? "?"} 位`
                            : `${percent.toFixed(1)}%`,
                    ),
                    createPanelElement(
                        "span",
                        "",
                        downloadState.status === "running"
                            ? `${formatBytes(downloadState.speed)}/s`
                            : formatBytes(downloadState.downloaded),
                    ),
                );
                const progress = createPanelElement("div", "toolbag-missing-progress");
                const fill = createPanelElement("div", "toolbag-missing-progress-fill");
                fill.style.width = `${percent}%`;
                progress.append(fill);
                card.append(progressLabel, progress);
            }

            const actions = createPanelElement("div", "toolbag-missing-actions");
            const action = createPanelElement("button", "toolbag-missing-action");
            action.type = "button";
            action.dataset.modelName = model.name;
            action.setAttribute(BUTTON_ATTRIBUTE, "");
            renderDownloadState(action, downloadState);
            if (!directDownloadable(model) && !downloadState) {
                action.textContent = "打开 ModelScope 搜索";
            }
            action.addEventListener(
                "click",
                () => startFastDownload(model.name, action),
                { signal },
            );
            const cancel = createPanelElement("button", "toolbag-missing-cancel", "取消");
            cancel.type = "button";
            cancel.dataset.modelName = model.name;
            cancel.setAttribute(CANCEL_ATTRIBUTE, "");
            renderCancelState(cancel, downloadState);
            cancel.addEventListener("click", async () => {
                try {
                    await cancelDownload(model.name);
                } catch (error) {
                    cancel.title = error.message;
                }
            }, { signal });
            actions.append(action, cancel);
            card.append(actions);
            content.append(card);
        }
    };

    const load = async () => {
        if (signal.aborted) return;
        state.loading = true;
        state.error = "";
        render();
        try {
            state.workflowCount = await rebuildOpenWorkflowModelIndex();
            state.workflowSignature = getOpenWorkflowSignature();
            const models = [...modelsByName.values()].map((model) => ({
                ...model,
                url: getModelScopeLink(model.name, linksByName),
            }));
            const response = await fetch("/toolbag/models/missing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ models }),
                signal,
            });
            const inspected = await response.json();
            if (!response.ok) throw new Error(inspected.error ?? "检查缺失模型失败");
            state.models = inspected.filter((model) => !model.installed);
            await syncDownloadStates();
        } catch (error) {
            if (error.name !== "AbortError") {
                state.error = error.message || "检查缺失模型失败";
            }
        } finally {
            state.loading = false;
            if (!signal.aborted) render();
        }
    };

    refresh.addEventListener("click", async () => {
        await app.refreshMissingModels?.({ silent: true });
        await load();
    }, { signal });
    sidebarPanelRender = render;
    sidebarPanelReload = load;
    const timer = window.setInterval(async () => {
        if (!state.loading && state.workflowSignature !== getOpenWorkflowSignature()) {
            await load();
            return;
        }
        try {
            await syncDownloadStates();
        } catch {
            // Keep the last known state during transient connection failures.
        }
        if (!signal.aborted) render();
    }, 1000);
    signal.addEventListener("abort", () => {
        window.clearInterval(timer);
        if (sidebarPanelRender === render) sidebarPanelRender = undefined;
        if (sidebarPanelReload === load) sidebarPanelReload = undefined;
    }, { once: true });
    load();
}

let missingModelsPanelController;

app.registerExtension({
    name: "ComfyUI.ToolBag.ModelScopeMissingModels",

    async setup() {
        const observer = new MutationObserver(queueButtonRefresh);
        observer.observe(document.body, { childList: true, subtree: true });
        queueButtonRefresh();
        syncDownloadStates().catch(() => {});
        app.extensionManager.registerSidebarTab({
            id: "toolbag-missing-models",
            icon: "pi pi-download",
            title: "缺失模型下载",
            tooltip: "汇总所有已打开工作流缺失模型并统一控制高速下载",
            type: "custom",
            render(element) {
                missingModelsPanelController?.abort();
                missingModelsPanelController = new AbortController();
                createMissingModelsPanel(
                    element,
                    missingModelsPanelController.signal,
                );
            },
            destroy() {
                missingModelsPanelController?.abort();
                missingModelsPanelController = undefined;
            },
        });
    },

    async beforeConfigureGraph(graphData) {
        linksByName.clear();
        modelsByName.clear();
        nodeLabelsByName.clear();
        workflowNodeLabelsByName.clear();
        rewriteWorkflowModelUrls(graphData, linksByName, modelsByName);
        indexWorkflowNodes(graphData, [...modelsByName.keys()], "当前工作流");
        window.setTimeout(() => sidebarPanelReload?.(), 0);
    },

    async loadedGraphNode(node) {
        rewriteWorkflowModelUrls(node, linksByName, modelsByName);
        indexNodeModelReferences(node);
    },
});
