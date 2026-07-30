import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const formatBytes = (bytes) => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
};

const formatDate = (timestamp) => {
    if (!timestamp) return "暂无记录";
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(timestamp * 1000));
};

const modelPath = (model) => model.name.replaceAll("\\", "/");

const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};

const styles = `
    .toolbag-model-usage { height: 100%; display: flex; flex-direction: column; color: var(--fg-color, #ddd); background: var(--comfy-menu-bg, #202020); }
    .toolbag-model-usage-header { padding: 16px 14px 12px; border-bottom: 1px solid var(--border-color, #444); }
    .toolbag-model-usage-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
    .toolbag-model-usage-title { margin: 0; font-size: 16px; font-weight: 650; }
    .toolbag-model-usage-hint { margin: -5px 0 12px; color: var(--descrip-text, #aaa); font-size: 11px; }
    .toolbag-model-usage-refresh { border: 0; border-radius: 6px; padding: 6px 9px; cursor: pointer; color: inherit; background: var(--comfy-input-bg, #333); }
    .toolbag-model-usage-refresh:hover { filter: brightness(1.15); }
    .toolbag-model-usage-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-bottom: 12px; }
    .toolbag-model-usage-summary-item { min-width: 0; padding: 8px; border-radius: 7px; background: var(--comfy-input-bg, #292929); }
    .toolbag-model-usage-summary-value { display: block; font-size: 16px; font-weight: 650; }
    .toolbag-model-usage-summary-label { display: block; margin-top: 2px; color: var(--descrip-text, #aaa); font-size: 11px; }
    .toolbag-model-usage-controls { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .toolbag-model-usage-search, .toolbag-model-usage-sort, .toolbag-model-usage-folder { min-width: 0; border: 1px solid var(--border-color, #555); border-radius: 6px; padding: 8px; color: inherit; background: var(--comfy-input-bg, #292929); }
    .toolbag-model-usage-folder { grid-column: 1 / -1; }
    .toolbag-model-usage-message { padding: 16px; color: var(--descrip-text, #aaa); text-align: center; }
    .toolbag-model-usage-message.error { color: #ff8f8f; }
    .toolbag-model-usage-list { min-height: 0; overflow: auto; padding: 8px; }
    .toolbag-model-usage-card { margin-bottom: 7px; padding: 10px; border: 1px solid var(--border-color, #444); border-radius: 8px; background: var(--comfy-input-bg, #292929); }
    .toolbag-model-usage-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .toolbag-model-usage-name { min-width: 0; overflow-wrap: anywhere; font-size: 13px; font-weight: 600; }
    .toolbag-model-usage-count { flex: none; border-radius: 999px; padding: 3px 7px; color: var(--input-text, #fff); background: var(--comfy-menu-secondary-bg, #3a3a3a); font-size: 12px; font-weight: 650; }
    .toolbag-model-usage-meta { display: flex; flex-wrap: wrap; gap: 5px 10px; margin-top: 7px; color: var(--descrip-text, #aaa); font-size: 11px; }
    .toolbag-model-usage-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 9px; }
    .toolbag-model-usage-folder-name { min-width: 0; overflow: hidden; color: var(--descrip-text, #aaa); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .toolbag-model-usage-delete { flex: none; border: 1px solid #9f3a3a; border-radius: 6px; padding: 5px 8px; cursor: pointer; color: #ffb0b0; background: transparent; font-size: 12px; }
    .toolbag-model-usage-delete:hover { color: white; background: #9f3a3a; }
    .toolbag-model-usage-delete:disabled, .toolbag-model-usage-refresh:disabled { cursor: wait; opacity: .55; }
`;

const createPanel = (root, signal) => {
    const state = {
        models: [],
        query: "",
        folder: "",
        sort: "least",
        loading: true,
        error: "",
    };

    root.replaceChildren();
    const style = createElement("style");
    style.textContent = styles;
    const panel = createElement("section", "toolbag-model-usage");
    const header = createElement("header", "toolbag-model-usage-header");
    const titleRow = createElement("div", "toolbag-model-usage-title-row");
    titleRow.append(createElement("h2", "toolbag-model-usage-title", "模型使用频率"));
    const refresh = createElement("button", "toolbag-model-usage-refresh", "刷新");
    refresh.type = "button";
    titleRow.append(refresh);

    const summary = createElement("div", "toolbag-model-usage-summary");
    const controls = createElement("div", "toolbag-model-usage-controls");
    const search = createElement("input", "toolbag-model-usage-search");
    search.type = "search";
    search.placeholder = "搜索模型";
    const sort = createElement("select", "toolbag-model-usage-sort");
    sort.append(
        new Option("低频优先", "least"),
        new Option("高频优先", "most"),
        new Option("最久未用", "oldest"),
    );
    const folder = createElement("select", "toolbag-model-usage-folder");
    controls.append(search, sort, folder);
    header.append(
        titleRow,
        createElement("div", "toolbag-model-usage-hint", "使用次数从本功能启用后开始统计"),
        summary,
        controls,
    );
    const list = createElement("div", "toolbag-model-usage-list");
    panel.append(header, list);
    root.append(style, panel);

    const renderSummary = () => {
        const totalSize = state.models.reduce((sum, model) => sum + model.size, 0);
        const unused = state.models.filter((model) => model.usage_count === 0).length;
        summary.replaceChildren();
        for (const [value, label] of [
            [state.models.length, "模型"],
            [unused, "未记录使用"],
            [formatBytes(totalSize), "占用空间"],
        ]) {
            const item = createElement("div", "toolbag-model-usage-summary-item");
            item.append(
                createElement("span", "toolbag-model-usage-summary-value", String(value)),
                createElement("span", "toolbag-model-usage-summary-label", label),
            );
            summary.append(item);
        }
    };

    const sortedModels = () => {
        const query = state.query.trim().toLocaleLowerCase();
        const models = state.models.filter((model) => {
            return (!state.folder || model.folder === state.folder)
                && (!query || `${model.name}\n${model.folder}`.toLocaleLowerCase().includes(query));
        });
        return models.sort((a, b) => {
            if (state.sort === "most") {
                return b.usage_count - a.usage_count
                    || (b.last_used || 0) - (a.last_used || 0)
                    || a.name.localeCompare(b.name);
            }
            if (state.sort === "oldest") {
                return (a.last_used || 0) - (b.last_used || 0)
                    || a.modified - b.modified
                    || a.usage_count - b.usage_count
                    || a.name.localeCompare(b.name);
            }
            return a.usage_count - b.usage_count
                || (a.last_used || 0) - (b.last_used || 0)
                || a.modified - b.modified
                || a.name.localeCompare(b.name);
        });
    };

    const deleteModel = async (model, button) => {
        const path = modelPath(model);
        if (!window.confirm(`确定永久删除模型“${path}”吗？此操作无法撤销。`)) return;
        button.disabled = true;
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        const response = await api.fetchApi(
            `/toolbag/models/usage/${encodeURIComponent(model.folder)}/${model.pathIndex}/${encodedPath}`,
            { method: "DELETE" },
        );
        if (!response.ok) {
            let message = "删除失败";
            try {
                const body = await response.json();
                if (body.error) message = body.error;
            } catch {
                message = `${message} (${response.status})`;
            }
            window.alert(message);
            button.disabled = false;
            return;
        }
        state.models = state.models.filter((item) =>
            !(item.folder === model.folder
                && item.pathIndex === model.pathIndex
                && item.name === model.name)
        );
        render();
    };

    const render = () => {
        refresh.disabled = state.loading;
        renderSummary();
        const currentFolder = state.folder;
        folder.replaceChildren(new Option("全部模型类型", ""));
        for (const name of [...new Set(state.models.map((model) => model.folder))].sort()) {
            folder.append(new Option(name, name));
        }
        folder.value = currentFolder;
        list.replaceChildren();
        if (state.loading) {
            list.append(createElement("div", "toolbag-model-usage-message", "正在读取模型…"));
            return;
        }
        if (state.error) {
            list.append(createElement("div", "toolbag-model-usage-message error", state.error));
            return;
        }
        const models = sortedModels();
        if (!models.length) {
            list.append(createElement("div", "toolbag-model-usage-message", "没有匹配的模型"));
            return;
        }
        for (const model of models) {
            const card = createElement("article", "toolbag-model-usage-card");
            const top = createElement("div", "toolbag-model-usage-card-top");
            top.append(
                createElement("div", "toolbag-model-usage-name", modelPath(model)),
                createElement("span", "toolbag-model-usage-count", `${model.usage_count} 次`),
            );
            const meta = createElement("div", "toolbag-model-usage-meta");
            meta.append(
                createElement("span", "", `最近：${formatDate(model.last_used)}`),
                createElement("span", "", `文件：${formatDate(model.modified)}`),
                createElement("span", "", formatBytes(model.size)),
            );
            const actions = createElement("div", "toolbag-model-usage-actions");
            actions.append(createElement("span", "toolbag-model-usage-folder-name", model.folder));
            const deleteButton = createElement("button", "toolbag-model-usage-delete", "删除");
            deleteButton.type = "button";
            deleteButton.addEventListener(
                "click",
                () => deleteModel(model, deleteButton),
                { signal },
            );
            actions.append(deleteButton);
            card.append(top, meta, actions);
            list.append(card);
        }
    };

    const load = async () => {
        state.loading = true;
        state.error = "";
        render();
        try {
            const response = await api.fetchApi("/toolbag/models/usage", { signal });
            if (!response.ok) throw new Error(`读取模型失败 (${response.status})`);
            state.models = await response.json();
        } catch (error) {
            if (error.name === "AbortError") return;
            state.error = error.message || "读取模型失败";
        } finally {
            state.loading = false;
            if (!signal.aborted) render();
        }
    };

    refresh.addEventListener("click", load, { signal });
    search.addEventListener("input", () => {
        state.query = search.value;
        render();
    }, { signal });
    sort.addEventListener("change", () => {
        state.sort = sort.value;
        render();
    }, { signal });
    folder.addEventListener("change", () => {
        state.folder = folder.value;
        render();
    }, { signal });
    load();
};

let panelController;

app.registerExtension({
    name: "ComfyUI.ToolBag.ModelUsage",
    setup() {
        app.extensionManager.registerSidebarTab({
            id: "toolbag-model-usage",
            icon: "pi pi-chart-bar",
            title: "模型使用频率",
            tooltip: "按使用频率管理本地模型",
            type: "custom",
            render(element) {
                panelController?.abort();
                panelController = new AbortController();
                createPanel(element, panelController.signal);
            },
            destroy() {
                panelController?.abort();
                panelController = undefined;
            },
        });
    },
});
