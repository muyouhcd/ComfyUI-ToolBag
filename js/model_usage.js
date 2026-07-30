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

const metricsStyles = `
    .toolbag-system-metrics { height: 100%; min-width: 0; overflow: auto; padding: 14px; box-sizing: border-box; color: var(--fg-color, #ddd); background: var(--comfy-menu-bg, #202020); }
    .toolbag-metrics-header { position: sticky; z-index: 2; top: -14px; margin: -14px -14px 12px; padding: 15px 14px 11px; border-bottom: 1px solid var(--border-color, #444); background: var(--comfy-menu-bg, #202020); }
    .toolbag-metrics-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .toolbag-metrics-title { margin: 0; font-size: 16px; font-weight: 650; }
    .toolbag-metrics-refresh { border: 0; border-radius: 6px; padding: 6px 9px; cursor: pointer; color: inherit; background: var(--comfy-input-bg, #333); }
    .toolbag-metrics-refresh:hover { filter: brightness(1.15); }
    .toolbag-metrics-refresh:disabled { cursor: wait; opacity: .55; }
    .toolbag-metrics-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 7px; color: var(--descrip-text, #aaa); font-size: 11px; }
    .toolbag-metrics-live { display: inline-flex; align-items: center; gap: 5px; }
    .toolbag-metrics-live::before { width: 7px; height: 7px; border-radius: 50%; background: #42c878; box-shadow: 0 0 0 3px rgb(66 200 120 / 14%); content: ""; }
    .toolbag-metrics-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
    .toolbag-metrics-summary-card, .toolbag-metrics-card { min-width: 0; border: 1px solid var(--border-color, #444); border-radius: 9px; background: var(--comfy-input-bg, #292929); }
    .toolbag-metrics-summary-card { padding: 10px; }
    .toolbag-metrics-summary-value { display: block; overflow: hidden; font-size: 18px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .toolbag-metrics-summary-label { display: block; margin-top: 2px; color: var(--descrip-text, #aaa); font-size: 11px; }
    .toolbag-metrics-section { margin: 0 0 14px; }
    .toolbag-metrics-section-title { margin: 0 0 7px; color: var(--descrip-text, #aaa); font-size: 11px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; }
    .toolbag-metrics-card { margin-bottom: 7px; padding: 10px; }
    .toolbag-metrics-card-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
    .toolbag-metrics-card-title { min-width: 0; overflow-wrap: anywhere; font-size: 13px; font-weight: 650; }
    .toolbag-metrics-card-detail { flex: none; color: var(--descrip-text, #aaa); font-size: 11px; }
    .toolbag-metrics-row { margin-top: 9px; }
    .toolbag-metrics-row:first-child { margin-top: 0; }
    .toolbag-metrics-row-label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px; font-size: 11px; }
    .toolbag-metrics-row-value { color: var(--descrip-text, #aaa); text-align: right; }
    .toolbag-metrics-bar { height: 6px; overflow: hidden; border-radius: 99px; background: rgb(127 127 127 / 22%); }
    .toolbag-metrics-bar-fill { height: 100%; border-radius: inherit; background: #43a6dd; transition: width .35s ease; }
    .toolbag-metrics-bar-fill.warning { background: #e9a23b; }
    .toolbag-metrics-bar-fill.danger { background: #e05c5c; }
    .toolbag-metrics-temperature-list { display: grid; gap: 6px; }
    .toolbag-metrics-temperature { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 8px 9px; border-radius: 7px; background: rgb(127 127 127 / 10%); }
    .toolbag-metrics-temperature-name { min-width: 0; overflow-wrap: anywhere; font-size: 12px; }
    .toolbag-metrics-temperature-value { font-size: 13px; font-weight: 650; }
    .toolbag-metrics-temperature-limit { grid-column: 1 / -1; color: var(--descrip-text, #aaa); font-size: 10px; }
    .toolbag-metrics-service-card { padding: 11px; border: 1px solid rgb(224 92 92 / 35%); border-radius: 9px; background: rgb(224 92 92 / 7%); }
    .toolbag-metrics-service-description { margin-bottom: 9px; color: var(--descrip-text, #aaa); font-size: 11px; line-height: 1.5; }
    .toolbag-metrics-restart { width: 100%; border: 1px solid #b84b4b; border-radius: 7px; padding: 8px 10px; cursor: pointer; color: #ffd3d3; background: rgb(184 75 75 / 18%); font-weight: 650; }
    .toolbag-metrics-restart:hover:not(:disabled) { color: white; background: #a43f3f; }
    .toolbag-metrics-restart:disabled { cursor: wait; opacity: .55; }
    .toolbag-metrics-service-message { margin-top: 8px; color: var(--descrip-text, #aaa); font-size: 10px; text-align: center; }
    .toolbag-metrics-service-message.success { color: #65d895; }
    .toolbag-metrics-service-message.error { color: #ff8f8f; }
    .toolbag-metrics-empty, .toolbag-metrics-error { padding: 24px 8px; color: var(--descrip-text, #aaa); text-align: center; }
    .toolbag-metrics-error { color: #ff8f8f; }
`;

const formatDuration = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days ? `${days} 天 ` : ""}${hours} 小时 ${minutes} 分`;
};

const formatPercent = (value) => (
    Number.isFinite(value) ? `${value.toFixed(1)}%` : "不可用"
);

const severityClass = (percent) => {
    if (percent >= 90) return "danger";
    if (percent >= 75) return "warning";
    return "";
};

const temperatureSeverity = (sensor) => {
    if (sensor.critical && sensor.current >= sensor.critical) return "danger";
    if (sensor.high && sensor.current >= sensor.high) return "warning";
    if (sensor.current >= 90) return "danger";
    if (sensor.current >= 80) return "warning";
    return "";
};

const temperatureDeviceName = (name) => {
    const known = {
        acpitz: "主板",
        amdgpu: "AMD GPU",
        k10temp: "CPU",
        nvme: "NVMe",
        mt7925_phy0: "Wi-Fi",
    };
    if (known[name]) return known[name];
    if (name.startsWith("r8169")) return "有线网卡";
    return name;
};

const createMetricBar = (label, percent, detail) => {
    const row = createElement("div", "toolbag-metrics-row");
    const labelRow = createElement("div", "toolbag-metrics-row-label");
    labelRow.append(
        createElement("span", "", label),
        createElement("span", "toolbag-metrics-row-value", detail),
    );
    const bar = createElement("div", "toolbag-metrics-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", label);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Number.isFinite(percent) ? percent : 0));
    const fill = createElement(
        "div",
        `toolbag-metrics-bar-fill ${severityClass(percent)}`.trim(),
    );
    fill.style.width = `${Math.min(Math.max(percent || 0, 0), 100)}%`;
    bar.append(fill);
    row.append(labelRow, bar);
    return row;
};

const createMetricsPanel = (root, signal) => {
    const state = {
        metrics: null,
        loading: false,
        restarting: false,
        restartMessage: "",
        restartMessageType: "",
        error: "",
    };

    root.replaceChildren();
    const style = createElement("style");
    style.textContent = metricsStyles;
    const panel = createElement("section", "toolbag-system-metrics");
    panel.setAttribute("aria-label", "服务器系统资源监控");
    const header = createElement("header", "toolbag-metrics-header");
    const titleRow = createElement("div", "toolbag-metrics-title-row");
    titleRow.append(createElement("h2", "toolbag-metrics-title", "服务器资源监控"));
    const refresh = createElement("button", "toolbag-metrics-refresh", "立即刷新");
    refresh.type = "button";
    refresh.setAttribute("aria-label", "立即刷新服务器资源");
    titleRow.append(refresh);
    const status = createElement("div", "toolbag-metrics-status");
    header.append(titleRow, status);
    const content = createElement("div", "toolbag-metrics-content");
    panel.append(header, content);
    root.append(style, panel);

    const addSummaryCard = (container, value, label) => {
        const card = createElement("div", "toolbag-metrics-summary-card");
        card.append(
            createElement("span", "toolbag-metrics-summary-value", value),
            createElement("span", "toolbag-metrics-summary-label", label),
        );
        container.append(card);
    };

    const addSection = (title) => {
        const section = createElement("section", "toolbag-metrics-section");
        section.append(createElement("h3", "toolbag-metrics-section-title", title));
        content.append(section);
        return section;
    };

    const render = () => {
        refresh.disabled = state.loading;
        status.replaceChildren();
        if (state.restarting) {
            status.append(createElement("span", "", "正在重启 ComfyUI，请稍候…"));
        } else if (state.metrics) {
            status.append(
                createElement("span", "toolbag-metrics-live", "每 2 秒自动刷新"),
                createElement(
                    "span",
                    "",
                    new Date(state.metrics.timestamp * 1000).toLocaleTimeString(),
                ),
            );
        } else {
            status.append(createElement("span", "", state.loading ? "正在连接服务器…" : ""));
        }

        content.replaceChildren();
        if (!state.metrics && state.loading) {
            content.append(createElement("div", "toolbag-metrics-empty", "正在读取硬件指标…"));
            return;
        }
        if (!state.metrics && state.error) {
            content.append(createElement("div", "toolbag-metrics-error", state.error));
            return;
        }
        const metrics = state.metrics;
        if (!metrics) return;

        const primaryGpu = metrics.gpus[0];
        const rootDisk = metrics.disks.find((disk) => disk.mountpoint === "/") || metrics.disks[0];
        const summary = createElement("div", "toolbag-metrics-summary");
        addSummaryCard(summary, formatPercent(metrics.cpu.percent), "CPU 占用");
        addSummaryCard(summary, formatPercent(metrics.memory.percent), "内存占用");
        addSummaryCard(
            summary,
            primaryGpu ? formatPercent(primaryGpu.memory.percent) : "未检测到",
            "显存占用",
        );
        addSummaryCard(
            summary,
            rootDisk ? formatBytes(rootDisk.free) : "未检测到",
            "系统盘剩余",
        );
        content.append(summary);

        const systemSection = addSection("系统");
        const systemCard = createElement("div", "toolbag-metrics-card");
        const systemTitle = createElement("div", "toolbag-metrics-card-title-row");
        systemTitle.append(
            createElement("span", "toolbag-metrics-card-title", metrics.hostname),
            createElement(
                "span",
                "toolbag-metrics-card-detail",
                `运行 ${formatDuration(metrics.uptime_seconds)}`,
            ),
        );
        systemCard.append(
            systemTitle,
            createMetricBar(
                `CPU · ${metrics.cpu.physical_cores || "?"} 核 / ${metrics.cpu.logical_cores || "?"} 线程`,
                metrics.cpu.percent,
                formatPercent(metrics.cpu.percent),
            ),
            createMetricBar(
                "内存",
                metrics.memory.percent,
                `${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}`,
            ),
            createMetricBar(
                "Swap",
                metrics.swap.percent,
                `${formatBytes(metrics.swap.used)} / ${formatBytes(metrics.swap.total)}`,
            ),
        );
        systemSection.append(systemCard);

        const gpuSection = addSection("GPU 与显存");
        if (!metrics.gpus.length) {
            gpuSection.append(createElement("div", "toolbag-metrics-card", "未检测到可读取的 GPU 指标"));
        }
        for (const gpu of metrics.gpus) {
            const card = createElement("div", "toolbag-metrics-card");
            const cardTitle = createElement("div", "toolbag-metrics-card-title-row");
            const detail = [
                gpu.driver,
                Number.isFinite(gpu.temperature) ? `${gpu.temperature.toFixed(1)} °C` : "",
            ].filter(Boolean).join(" · ");
            cardTitle.append(
                createElement("span", "toolbag-metrics-card-title", gpu.name),
                createElement("span", "toolbag-metrics-card-detail", detail),
            );
            card.append(cardTitle);
            if (Number.isFinite(gpu.utilization_percent)) {
                card.append(createMetricBar(
                    "GPU 占用",
                    gpu.utilization_percent,
                    formatPercent(gpu.utilization_percent),
                ));
            }
            card.append(createMetricBar(
                "专用显存 VRAM",
                gpu.memory.percent,
                `${formatBytes(gpu.memory.used)} / ${formatBytes(gpu.memory.total)}`,
            ));
            if (gpu.gtt.total) {
                card.append(createMetricBar(
                    "共享显存 GTT",
                    gpu.gtt.percent,
                    `${formatBytes(gpu.gtt.used)} / ${formatBytes(gpu.gtt.total)}`,
                ));
            }
            gpuSection.append(card);
        }

        const temperaturesSection = addSection("设备温度");
        if (!metrics.temperatures.length) {
            temperaturesSection.append(createElement("div", "toolbag-metrics-card", "系统未提供温度传感器数据"));
        } else {
            const list = createElement("div", "toolbag-metrics-temperature-list");
            for (const sensor of [...metrics.temperatures].sort((a, b) => b.current - a.current)) {
                const item = createElement("div", "toolbag-metrics-temperature");
                const severity = temperatureSeverity(sensor);
                const value = createElement(
                    "span",
                    `toolbag-metrics-temperature-value ${severity}`.trim(),
                    `${sensor.current.toFixed(1)} °C`,
                );
                if (severity === "warning") value.style.color = "#e9a23b";
                if (severity === "danger") value.style.color = "#e05c5c";
                item.append(
                    createElement(
                        "span",
                        "toolbag-metrics-temperature-name",
                        `${temperatureDeviceName(sensor.device)} · ${sensor.label}`,
                    ),
                    value,
                );
                const limits = [];
                if (sensor.high) limits.push(`高温 ${sensor.high.toFixed(1)} °C`);
                if (sensor.critical && sensor.critical !== sensor.high) {
                    limits.push(`临界 ${sensor.critical.toFixed(1)} °C`);
                }
                if (limits.length) {
                    item.append(createElement(
                        "span",
                        "toolbag-metrics-temperature-limit",
                        limits.join(" · "),
                    ));
                }
                list.append(item);
            }
            temperaturesSection.append(list);
        }

        const disksSection = addSection("硬盘空间");
        for (const disk of metrics.disks) {
            const card = createElement("div", "toolbag-metrics-card");
            const cardTitle = createElement("div", "toolbag-metrics-card-title-row");
            cardTitle.append(
                createElement("span", "toolbag-metrics-card-title", disk.mountpoint),
                createElement(
                    "span",
                    "toolbag-metrics-card-detail",
                    `${disk.device} · 剩余 ${formatBytes(disk.free)}`,
                ),
            );
            card.append(
                cardTitle,
                createMetricBar(
                    "已使用",
                    disk.percent,
                    `${formatBytes(disk.used)} / ${formatBytes(disk.total)}`,
                ),
            );
            disksSection.append(card);
        }

        const serviceSection = addSection("服务控制");
        const serviceCard = createElement("div", "toolbag-metrics-service-card");
        serviceCard.append(createElement(
            "div",
            "toolbag-metrics-service-description",
            "重启会中断当前正在执行的工作流和加载任务，systemd 将自动重新启动 ComfyUI。",
        ));
        const restart = createElement(
            "button",
            "toolbag-metrics-restart",
            state.restarting ? "正在重启 ComfyUI…" : "重启 ComfyUI",
        );
        restart.type = "button";
        restart.disabled = state.restarting
            || metrics.service_control?.restart_supported === false;
        restart.setAttribute("aria-label", "重启 ComfyUI 服务");
        restart.addEventListener("click", async () => {
            const confirmed = window.confirm(
                "确定要重启 ComfyUI 吗？\n\n当前正在执行的工作流、模型加载和队列任务都会中断。",
            );
            if (!confirmed) return;

            state.restarting = true;
            state.restartMessage = "重启请求已发送，正在等待服务恢复…";
            state.restartMessageType = "";
            render();
            try {
                const response = await api.fetchApi("/toolbag/system/restart", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ confirm: "RESTART_COMFYUI" }),
                    signal,
                });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || `重启失败 (${response.status})`);
                }

                const deadline = Date.now() + 90000;
                const requestedAt = Date.now();
                let observedOffline = false;
                while (!signal.aborted && Date.now() < deadline) {
                    await new Promise((resolve) => window.setTimeout(resolve, 1500));
                    try {
                        const metricsResponse = await api.fetchApi(
                            "/toolbag/system/metrics",
                            { signal },
                        );
                        if (!metricsResponse.ok) throw new Error("服务尚未恢复");
                        const nextMetrics = await metricsResponse.json();
                        const restartedController = (
                            nextMetrics.service_control?.restart_scheduled === false
                            && Date.now() - requestedAt > 3000
                        );
                        if (observedOffline || restartedController) {
                            state.metrics = nextMetrics;
                            state.restarting = false;
                            state.restartMessage = "ComfyUI 已重启并恢复连接";
                            state.restartMessageType = "success";
                            render();
                            return;
                        }
                    } catch (error) {
                        if (error.name === "AbortError") return;
                        observedOffline = true;
                    }
                }
                throw new Error("等待 ComfyUI 重启超时，请检查服务器服务状态");
            } catch (error) {
                if (error.name === "AbortError") return;
                state.restarting = false;
                state.restartMessage = error.message || "重启 ComfyUI 失败";
                state.restartMessageType = "error";
                render();
            }
        }, { signal });
        serviceCard.append(restart);
        if (metrics.service_control?.restart_supported === false) {
            serviceCard.append(createElement(
                "div",
                "toolbag-metrics-service-message error",
                "当前运行方式不支持从面板重启",
            ));
        } else if (state.restartMessage) {
            serviceCard.append(createElement(
                "div",
                `toolbag-metrics-service-message ${state.restartMessageType}`.trim(),
                state.restartMessage,
            ));
        }
        serviceSection.append(serviceCard);
    };

    const load = async () => {
        if (state.loading || state.restarting || signal.aborted) return;
        state.loading = true;
        state.error = "";
        render();
        try {
            const response = await api.fetchApi("/toolbag/system/metrics", { signal });
            if (!response.ok) throw new Error(`读取系统指标失败 (${response.status})`);
            state.metrics = await response.json();
        } catch (error) {
            if (error.name === "AbortError") return;
            state.error = error.message || "读取系统指标失败";
        } finally {
            state.loading = false;
            if (!signal.aborted) render();
        }
    };

    refresh.addEventListener("click", load, { signal });
    const timer = window.setInterval(load, 2000);
    signal.addEventListener("abort", () => window.clearInterval(timer), { once: true });
    load();
};

let metricsPanelController;

app.registerExtension({
    name: "ComfyUI.ToolBag.SystemMetrics",
    setup() {
        app.extensionManager.registerSidebarTab({
            id: "toolbag-system-metrics",
            icon: "pi pi-server",
            title: "服务器资源监控",
            tooltip: "实时查看 CPU、内存、显存、温度与硬盘余量",
            type: "custom",
            render(element) {
                metricsPanelController?.abort();
                metricsPanelController = new AbortController();
                createMetricsPanel(element, metricsPanelController.signal);
            },
            destroy() {
                metricsPanelController?.abort();
                metricsPanelController = undefined;
            },
        });
    },
});
