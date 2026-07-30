import { app } from "../../../scripts/app.js";
import {
    getModelScopeLink,
    rewriteWorkflowModelUrls,
} from "./modelscope_url.mjs";

const linksByName = new Map();
const modelsByName = new Map();
const downloadStateByName = new Map();
const BUTTON_ATTRIBUTE = "data-toolbag-modelscope";
const CANCEL_ATTRIBUTE = "data-toolbag-modelscope-cancel";

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
    button.style.display = ["running", "paused"].includes(state?.status)
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
            return;
        }
        if (state.status === "canceled") return;
        if (state.status === "error") throw new Error(state.error ?? "下载失败");
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
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

async function startFastDownload(modelName, button, token = null) {
    const currentState = downloadStateByName.get(modelName);
    if (["running", "paused"].includes(currentState?.status)) {
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

    button.disabled = true;
    button.textContent = "准备下载…";
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
        if (state.task_id && state.status === "running") {
            await pollDownload(modelName, state.task_id);
        } else if (state.status === "complete") {
            await app.refreshMissingModels?.({ silent: true });
        }
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

app.registerExtension({
    name: "ComfyUI.ToolBag.ModelScopeMissingModels",

    async setup() {
        const observer = new MutationObserver(queueButtonRefresh);
        observer.observe(document.body, { childList: true, subtree: true });
        queueButtonRefresh();
    },

    async beforeConfigureGraph(graphData) {
        linksByName.clear();
        modelsByName.clear();
        downloadStateByName.clear();
        rewriteWorkflowModelUrls(graphData, linksByName, modelsByName);
    },

    async loadedGraphNode(node) {
        rewriteWorkflowModelUrls(node, linksByName, modelsByName);
    },
});
