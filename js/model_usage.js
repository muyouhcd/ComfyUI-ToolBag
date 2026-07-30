import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const formatBytes = (bytes) => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
};

const formatDate = (timestamp) => {
    if (!timestamp) return "æš‚æ— è®°å½•";
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
    titleRow.append(createElement("h2", "toolbag-model-usage-title", "æ¨¡åž‹ä½¿ç”¨é¢‘çŽ‡"));
    const refresh = createElement("button", "toolbag-model-usage-refresh", "åˆ·æ–°");
    refresh.type = "button";
    titleRow.append(refresh);

    const summary = createElement("div", "toolbag-model-usage-summary");
    const controls = createElement("div", "toolbag-model-usage-controls");
    const search = createElement("input", "toolbag-model-usage-search");
    search.type = "search";
    search.placeholder = "æœç´¢æ¨¡åž‹";
    const sort = createElement("select", "toolbag-model-usage-sort");
    sort.append(
        new Option("ä½Žé¢‘ä¼˜å…ˆ", "least"),
        new Option("é«˜é¢‘ä¼˜å…ˆ", "most"),
        new Option("æœ€ä¹…æœªç”¨", "oldest"),
    );
    const folder = createElement("select", "toolbag-model-usage-folder");
    controls.append(search, sort, folder);
    header.append(
        titleRow,
        createElement("div", "toolbag-model-usage-hint", "ä½¿ç”¨æ¬¡æ•°ä»Žæœ¬åŠŸèƒ½å¯ç”¨åŽå¼€å§‹ç»Ÿè®¡"),
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
            [state.models.length, "æ¨¡åž‹"],
            [unused, "æœªè®°å½•ä½¿ç”¨"],
            [formatBytes(totalSize), "å ç”¨ç©ºé—´"],
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
        if (!window.confirm(`ç¡®å®šæ°¸ä¹…åˆ é™¤æ¨¡åž‹â€œ${path}â€å—ï¼Ÿæ­¤æ“ä½œæ— æ³•æ’¤é”€ã€‚`)) return;
        button.disabled = true;
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        const response = await api.fetchApi(
            `/toolbag/models/usage/${encodeURIComponent(model.folder)}/${model.pathIndex}/${encodedPath}`,
            { method: "DELETE" },
        );
        if (!response.ok) {
            let message = "åˆ é™¤å¤±è´¥";
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
        folder.replaceChildren(new Option("å…¨éƒ¨æ¨¡åž‹ç±»åž‹", ""));
        for (const name of [...new Set(state.models.map((model) => model.folder))].sort()) {
            folder.append(new Option(name, name));
        }
        folder.value = currentFolder;
        list.replaceChildren();
        if (state.loading) {
            list.append(createElement("div", "toolbag-model-usage-message", "æ­£åœ¨è¯»å–æ¨¡åž‹â€¦"));
            return;
        }
        if (state.error) {
            list.append(createElement("div", "toolbag-model-usage-message error", state.error));
            return;
        }
        const models = sortedModels();
        if (!models.length) {
            list.append(createElement("div", "toolbag-model-usage-message", "æ²¡æœ‰åŒ¹é…çš„æ¨¡åž‹"));
            return;
        }
        for (const model of models) {
            const card = createElement("article", "toolbag-model-usage-card");
            const top = createElement("div", "toolbag-model-usage-card-top");
            top.append(
                createElement("div", "toolbag-model-usage-name", modelPath(model)),
                createElement("span", "toolbag-model-usage-count", `${model.usage_count} æ¬¡`),
            );
            const meta = createElement("div", "toolbag-model-usage-meta");
            meta.append(
                createElement("span", "", `æœ€è¿‘ï¼š${formatDate(model.last_used)}`),
                createElement("span", "", `æ–‡ä»¶ï¼š${formatDate(model.modified)}`),
                createElement("span", "", formatBytes(model.size)),
            );
            const actions = createElement("div", "toolbag-model-usage-actions");
            actions.append(createElement("span", "toolbag-model-usage-folder-name", model.folder));
            const deleteButton = createElement("button", "toolbag-model-usage-delete", "åˆ é™¤");
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
            if (!response.ok) throw new Error(`è¯»å–æ¨¡åž‹å¤±è´¥ (${response.status})`);
            state.models = await response.json();
        } catch (error) {
            if (error.name === "AbortError") return;
            state.error = error.message || "è¯»å–æ¨¡åž‹å¤±è´¥";
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
            title: "æ¨¡åž‹ä½¿ç”¨é¢‘çŽ‡",
            tooltip: "æŒ‰ä½¿ç”¨é¢‘çŽ‡ç®¡ç†æœ¬åœ°æ¨¡åž‹",
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
    .toolbag-metrics-summary-card, .toolbag-metrics-card { min-width: 0; border: 1px solid var(--border-color, #444); border-rß~·¶‰žËkºwµç}±‰…œµµ•ÑÉ¥Ìµ…Éµ‘•Ñ…¥°ˆ°4(€€€€€€€€€€€€€€€ƒ¢þC¢†0€‘í™½Éµ…ÑÕÉ…Ñ¥½¸¡µ•ÑÉ¥Ì¹ÕÁÑ¥µ•}Í•½¹‘Ì¥õ€°4(€€€€€€€€€€€€¤°4(€€€€€€€€¤ì4(€€€€€€€ÍåÍÑ•µ…É¹…ÁÁ•¹ 4(€€€€€€€€€€€ÍåÍÑ•µQ¥Ñ±”°4(€€€€€€€€€€€É•…Ñ•5•ÑÉ¥	…È 4(€€€€€€€€€€€€€€€ATƒ
Ü€‘íµ•ÑÉ¥Ì¹ÁÔ¹Á¡åÍ¥…±}½É•Ìñð€ˆü‰ôƒš‚à€¼€‘íµ•ÑÉ¥Ì¹ÁÔ¹±½¥…±}½É•Ìñð€ˆü‰ôƒžêÿž¢-€°4(€€€€€€€€€€€€€€€µ•ÑÉ¥Ì¹ÁÔ¹Á•É•¹Ð°4(€€€€€€€€€€€€€€€™½Éµ…ÑA•É•¹Ð¡µ•ÑÉ¥Ì¹ÁÔ¹Á•É•¹Ð¤°4(€€€€€€€€€€€€¤°4(€€€€€€€€€€€É•…Ñ•5•ÑÉ¥	…È 4(€€€€€€€€€€€€€€€€‹––¶`ˆ°4(€€€€€€€€€€€€€€€µ•ÑÉ¥Ì¹µ•µ½Éä¹Á•É•¹Ð°4(€€€€€€€€€€€€€€€€‘í™½Éµ…Ñ	åÑ•Ì¡µ•ÑÉ¥Ì¹µ•µ½Éä¹ÕÍ•¥ô€¼€‘í™½Éµ…Ñ	åÑ•Ì¡µ•ÑÉ¥Ì¹µ•µ½Éä¹Ñ½Ñ…°¥õ€°4(€€€€€€€€€€€€¤°4(€€€€€€€€€€€É•…Ñ•5•ÑÉ¥	…È 4(€€€€€€€€€€€€€€€€‰MÝ…Àˆ°4(€€€€€€€€€€€€€€€µ•ÑÉ¥Ì¹ÍÝ…À¹Á•É•¹Ð°4(€€€€€€€€€€€€€€€€‘í™½Éµ…Ñ	åÑ•Ì¡µ•ÑÉ¥Ì¹ÍÝ…À¹ÕÍ•¥ô€¼€‘í™½Éµ…Ñ	åÑ•Ì¡µ•ÑÉ¥Ì¹ÍÝ…À¹Ñ½Ñ…°¥õ€°4(€€€€€€€€€€€€¤°4(€€€€€€€€¤ì4(€€€€€€€ÍåÍÑ•µM•Ñ¥½¸¹…ÁÁ•¹¡ÍåÍÑ•µ…É¤ì4(4(€€€€€€€½¹ÍÐÁÕM•Ñ¥½¸€ô…‘‘M•Ñ¥½¸ ‰ATƒ’â;šbû–¶`ˆ¤ì4(€€€€€€€¥˜€ …µ•ÑÉ¥Ì¹ÁÕÌ¹±•¹Ñ ¤ì4(€€€€€€€€€€€ÁÕM•Ñ¥½¸¹…ÁÁ•¹¡É•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…Éˆ°€‹šr«šŽšÖ/–"Ã–>¿¢¾ï–>[žjATƒš2š‚ˆ¤¤ì4(€€€€€€€ô4(€€€€€€€™½È€¡½¹ÍÐÁÔ½˜µ•ÑÉ¥Ì¹ÁÕÌ¤ì4(€€€€€€€€€€€½¹ÍÐ…É€ôÉ•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…Éˆ¤ì4(€€€€€€€€€€€½¹ÍÐ…É‘Q¥Ñ±”€ôÉ•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…ÉµÑ¥Ñ±”µÉ½Üˆ¤ì4(€€€€€€€€€€€½¹ÍÐ‘•Ñ…¥°€ôl4(€€€€€€€€€€€€€€€ÁÔ¹‘É¥Ù•È°4(€€€€€€€€€€€€€€€9Õµ‰•È¹¥Í¥¹¥Ñ”¡ÁÔ¹Ñ•µÁ•É…ÑÕÉ”¤€ü€‘íÁÔ¹Ñ•µÁ•É…ÑÕÉ”¹Ñ½¥á• Ä¥ôƒ
Á€€è€ˆˆ°4(€€€€€€€€€€€t¹™¥±Ñ•È¡	½½±•…¸¤¹©½¥¸ ˆƒ
Ü€ˆ¤ì4(€€€€€€€€€€€…É‘Q¥Ñ±”¹…ÁÁ•¹ 4(€€€€€€€€€€€€€€€É•…Ñ•±•µ•¹Ð ‰ÍÁ…¸ˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…ÉµÑ¥Ñ±”ˆ°ÁÔ¹¹…µ”¤°4(€€€€€€€€€€€€€€€É•…Ñ•±•µ•¹Ð ‰ÍÁ…¸ˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…Éµ‘•Ñ…¥°ˆ°‘•Ñ…¥°¤°4(€€€€€€€€€€€€¤ì4(€€€€€€€€€€€…É¹…ÁÁ•¹¡…É‘Q¥Ñ±”¤ì4(€€€€€€€€€€€¥˜€¡9Õµ‰•È¹¥Í¥¹¥Ñ”¡ÁÔ¹ÕÑ¥±¥é…Ñ¥½¹}Á•É•¹Ð¤¤ì4(€€€€€€€€€€€€€€€…É¹…ÁÁ•¹¡É•…Ñ•5•ÑÉ¥	…È 4(€€€€€€€€€€€€€€€€€€€€‰ATƒ–6ƒžR ˆ°4(€€€€€€€€€€€€€€€€€€€ÁÔ¹ÕÑ¥±¥é…Ñ¥½¹}Á•É•¹Ð°4(€€€€€€€€€€€€€€€€€€€™½Éµ…ÑA•É•¹Ð¡ÁÔ¹ÕÑ¥±¥é…Ñ¥½¹}Á•É•¹Ð¤°4(€€€€€€€€€€€€€€€€¤¤ì4(€€€€€€€€€€€ô4(€€€€€€€€€€€…É¹…ÁÁ•¹¡É•…Ñ•5•ÑÉ¥	…È 4(€€€€€€€€€€€€€€€€‹’âOžR£šbû–¶`YI4ˆ°4(€€€€€€€€€€€€€€€ÁÔ¹µ•µ½Éä¹Á•É•¹Ð°4(€€€€€€€€€€€€€€€€‘í™½Éµ…Ñ	åÑ•Ì¡ÁÔ¹µ•µ½Éä¹ÕÍ•¥ô€¼€‘í™½Éµ…Ñ	åÑ•Ì¡ÁÔ¹µ•µ½Éä¹Ñ½Ñ…°¥õ€°4(€€€€€€€€€€€€¤¤ì4(€€€€€€€€€€€¥˜€¡ÁÔ¹ÑÐ¹Ñ½Ñ…°¤ì4(€€€€€€€€€€€€€€€…É¹…ÁÁ•¹¡É•…Ñ•5•ÑÉ¥	…È 4(€€€€€€€€€€€€€€€€€€€€‹–Ç’ê¯šbû–¶`QPˆ°4(€€€€€€€€€€€€€€€€€€€ÁÔ¹ÑÐ¹Á•É•¹Ð°4(€€€€€€€€€€€€€€€€€€€€‘í™½Éµ…Ñ	åÑ•Ì¡ÁÔ¹ÑÐ¹ÕÍ•¥ô€¼€‘í™½Éµ…Ñ	åÑ•Ì¡ÁÔ¹ÑÐ¹Ñ½Ñ…°¥õ€°4(€€€€€€€€€€€€€€€€¤¤ì4(€€€€€€€€€€€ô4(€€€€€€€€€€€ÁÕM•Ñ¥½¸¹…ÁÁ•¹¡…É¤ì4(€€€€€€€ô4(4(€€€€€€€½¹ÍÐÑ•µÁ•É…ÑÕÉ•ÍM•Ñ¥½¸€ô…‘‘M•Ñ¥½¸ ‹¢ºû–’šâ§–ê˜ˆ¤ì4(€€€€€€€¥˜€ …µ•ÑÉ¥Ì¹Ñ•µÁ•É…ÑÕÉ•Ì¹±•¹Ñ ¤ì4(€€€€€€€€€€€Ñ•µÁ•É…ÑÕÉ•ÍM•Ñ¥½¸¹…ÁÁ•¹¡É•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…Éˆ°€‹žÎïžîšr«š>C’úošâ§–ê›’òƒš–f£šVÃš6¸ˆ¤¤ì4(€€€€€€€ô•±Í”ì4(€€€€€€€€€€€½¹ÍÐ±¥ÍÐ€ôÉ•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÑ•µÁ•É…ÑÕÉ”µ±¥ÍÐˆ¤ì4(€€€€€€€€€€€™½È€¡½¹ÍÐÍ•¹Í½È½˜l¸¸¹µ•ÑÉ¥Ì¹Ñ•µÁ•É…ÑÕÉ•Ít¹Í½ÉÐ ¡„°ˆ¤€ôøˆ¹ÕÉÉ•¹Ð€´„¹ÕÉÉ•¹Ð¤¤ì4(€€€€€€€€€€€€€€€½¹ÍÐ¥Ñ•´€ôÉ•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÑ•µÁ•É…ÑÕÉ”ˆ¤ì4(€€€€€€€€€€€€€€€½¹ÍÐÍ•Ù•É¥Ñä€ôÑ•µÁ•É…ÑÕÉ•M•Ù•É¥Ñä¡Í•¹Í½È¤ì4(€€€€€€€€€€€€€€€½¹ÍÐÙ…±Õ”€ôÉ•…Ñ•±•µ•¹Ð 4(€€€€€€€€€€€€€€€€€€€€‰ÍÁ…¸ˆ°4(€€€€€€€€€€€€€€€€€€€Ñ½½±‰…œµµ•ÑÉ¥ÌµÑ•µÁ•É…ÑÕÉ”µÙ…±Õ”€‘íÍ•Ù•É¥Ñåõ€¹ÑÉ¥´ ¤°4(€€€€€€€€€€€€€€€€€€€€‘íÍ•¹Í½È¹ÕÉÉ•¹Ð¹Ñ½¥á• Ä¥ôƒ
Á€°4(€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€€€¥˜€¡Í•Ù•É¥Ñä€ôôô€‰Ý…É¹¥¹œˆ¤Ù…±Õ”¹ÍÑå±”¹½±½È€ô€ˆ”å„ÈÍˆˆì4(€€€€€€€€€€€€€€€¥˜€¡Í•Ù•É¥Ñä€ôôô€‰‘…¹•Èˆ¤Ù…±Õ”¹ÍÑå±”¹½±½È€ô€ˆ”ÀÕŒÕŒˆì4(€€€€€€€€€€€€€€€¥Ñ•´¹…ÁÁ•¹ 4(€€€€€€€€€€€€€€€€€€€É•…Ñ•±•µ•¹Ð 4(€€€€€€€€€€€€€€€€€€€€€€€€‰ÍÁ…¸ˆ°4(€€€€€€€€€€€€€€€€€€€€€€€€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÑ•µÁ•É…ÑÕÉ”µ¹…µ”ˆ°4(€€€€€€€€€€€€€€€€€€€€€€€€‘íÑ•µÁ•É…ÑÕÉ••Ù¥•9…µ”¡Í•¹Í½È¹‘•Ù¥”¥ôƒ
Ü€‘íÍ•¹Í½È¹±…‰•±õ€°4(€€€€€€€€€€€€€€€€€€€€¤°4(€€€€€€€€€€€€€€€€€€€Ù…±Õ”°4(€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€€€½¹ÍÐ±¥µ¥ÑÌ€ômtì4(€€€€€€€€€€€€€€€¥˜€¡Í•¹Í½È¹¡¥ ¤±¥µ¥ÑÌ¹ÁÕÍ ¡ƒ¦®cšâ¤€‘íÍ•¹Í½È¹¡¥ ¹Ñ½¥á• Ä¥ôƒ
Á€¤ì4(€€€€€€€€€€€€€€€¥˜€¡Í•¹Í½È¹É¥Ñ¥…°€˜˜Í•¹Í½È¹É¥Ñ¥…°€„ôôÍ•¹Í½È¹¡¥ ¤ì4(€€€€€€€€€€€€€€€€€€€±¥µ¥ÑÌ¹ÁÕÍ ¡ƒ’âÓžV0€‘íÍ•¹Í½È¹É¥Ñ¥…°¹Ñ½¥á• Ä¥ôƒ
Á€¤ì4(€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€¥˜€¡±¥µ¥ÑÌ¹±•¹Ñ ¤ì4(€€€€€€€€€€€€€€€€€€€¥Ñ•´¹…ÁÁ•¹¡É•…Ñ•±•µ•¹Ð 4(€€€€€€€€€€€€€€€€€€€€€€€€‰ÍÁ…¸ˆ°4(€€€€€€€€€€€€€€€€€€€€€€€€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÑ•µÁ•É…ÑÕÉ”µ±¥µ¥Ðˆ°4(€€€€€€€€€€€€€€€€€€€€€€€±¥µ¥ÑÌ¹©½¥¸ ˆƒ
Ü€ˆ¤°4(€€€€€€€€€€€€€€€€€€€€¤¤ì4(€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€±¥ÍÐ¹…ÁÁ•¹¡¥Ñ•´¤ì4(€€€€€€€€€€€ô4(€€€€€€€€€€€Ñ•µÁ•É…ÑÕÉ•ÍM•Ñ¥½¸¹…ÁÁ•¹¡±¥ÍÐ¤ì4(€€€€€€€ô4(4(€€€€€€€½¹ÍÐ‘¥Í­ÍM•Ñ¥½¸€ô…‘‘M•Ñ¥½¸ ‹ž†³žncž¦ë¦^Ðˆ¤ì4(€€€€€€€™½È€¡½¹ÍÐ‘¥Í¬½˜µ•ÑÉ¥Ì¹‘¥Í­Ì¤ì(€€€€€€€€€€€½¹ÍÐ…É€ôÉ•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…Éˆ¤ì4(€€€€€€€€€€€½¹ÍÐ…É‘Q¥Ñ±”€ôÉ•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…ÉµÑ¥Ñ±”µÉ½Üˆ¤ì4(€€€€€€€€€€€…É‘Q¥Ñ±”¹…ÁÁ•¹ 4(€€€€€€€€€€€€€€€É•…Ñ•±•µ•¹Ð ‰ÍÁ…¸ˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…ÉµÑ¥Ñ±”ˆ°‘¥Í¬¹µ½Õ¹ÑÁ½¥¹Ð¤°4(€€€€€€€€€€€€€€€É•…Ñ•±•µ•¹Ð 4(€€€€€€€€€€€€€€€€€€€€‰ÍÁ…¸ˆ°4(€€€€€€€€€€€€€€€€€€€€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…Éµ‘•Ñ…¥°ˆ°4(€€€€€€€€€€€€€€€€€€€€‘í‘¥Í¬¹‘•Ù¥•ôƒ
Üƒ–&§’öd€‘í™½Éµ…Ñ	åÑ•Ì¡‘¥Í¬¹™É•”¥õ€°4(€€€€€€€€€€€€€€€€¤°4(€€€€€€€€€€€€¤ì4(€€€€€€€€€€€…É¹…ÁÁ•¹ 4(€€€€€€€€€€€€€€€…É‘Q¥Ñ±”°4(€€€€€€€€€€€€€€€É•…Ñ•5•ÑÉ¥	…È 4(€€€€€€€€€€€€€€€€€€€€‹–ÞË’öÿžR ˆ°4(€€€€€€€€€€€€€€€€€€€‘¥Í¬¹Á•É•¹Ð°4(€€€€€€€€€€€€€€€€€€€€‘í™½Éµ…Ñ	åÑ•Ì¡‘¥Í¬¹ÕÍ•¥ô€¼€‘í™½Éµ…Ñ	åÑ•Ì¡‘¥Í¬¹Ñ½Ñ…°¥õ€°4(€€€€€€€€€€€€€€€€¤°4(€€€€€€€€€€€€¤ì4(€€€€€€€€€€€‘¥Í­ÍM•Ñ¥½¸¹…ÁÁ•¹¡…É¤ì(€€€€€€€ô((€€€€€€€½¹ÍÐµ•µ½ÉåM•Ñ¥½¸€ô…‘‘M•Ñ¥½¸ ‹š¢‡–z/šbû–¶`ˆ¤ì(€€€€€€€½¹ÍÐµ•µ½Éå…É€ôÉ•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥Ìµ…Éˆ¤ì(€€€€€€€µ•µ½Éå…É¹…ÁÁ•¹¡É•…Ñ•±•µ•¹Ð (€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÍ•ÉÙ¥”µ‘•ÍÉ¥ÁÑ¥½¸ˆ°(€€€€€€€€€€€€‹’âÓš^Û–6ã¢öô½µ™åU$ƒ’â8=±±…µ„ƒ–öO–&7¦¦ïžVgžjš¢‡–z/–æÛ¦+šRûžòO–¶c¾ò3’â7–"ƒ¦f“š¢‡–z/šZ’îÛ¾òo’â/š²‡’öÿžR£š^Û’òk¢«–*£¦7šZÃ–*ƒ¢ö÷Žˆ°(€€€€€€€€¤¤ì(€€€€€€€½¹ÍÐÕ¹±½…€ôÉ•…Ñ•±•µ•¹Ð (€€€€€€€€€€€€‰‰ÕÑÑ½¸ˆ°(€€€€€€€€€€€€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÕ¹±½…ˆ°(€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘¥¹5½‘•±Ì€ü€‹š¶–r£¦+šRûš¢‡–z/šbû–¶cŠ˜ˆ€è€‹’â¦R»’âÓš^Û–6ã¢ö÷–Û’î[š¢‡–z,ˆ°(€€€€€€€€¤ì(€€€€€€€Õ¹±½…¹ÑåÁ”€ô€‰‰ÕÑÑ½¸ˆì(€€€€€€€Õ¹±½…¹‘¥Í…‰±•€ôÍÑ…Ñ”¹Õ¹±½…‘¥¹5½‘•±ÌñðÍÑ…Ñ”¹É•ÍÑ…ÉÑ¥¹œì(€€€€€€€Õ¹±½…¹Í•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ°€‹’âÓš^Û–6ã¢öô½µ™åU$ƒ–J0=±±…µ„ƒ–ÞË–*ƒ¢ö÷š¢‡–z,ˆ¤ì(€€€€€€€Õ¹±½…¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€€€€€€€€€½¹ÍÐ½¹™¥Éµ•€ôÝ¥¹‘½Ü¹½¹™¥É´ (€€€€€€€€€€€€€€€€‹ž†»–ºk¢š’âÓš^Û–6ã¢ö÷–öO–&7¦¦ïžVgžjš¢‡–z/–B_¾ò}q¹q»’â7’òk–"ƒ¦f“š¢‡–z/šZ’îÛŽš¶–r£š&Ÿ¢†3žj½µ™åU$ƒ–Þ—’ösšÖ’òk–r£–º'–£š^Ûšrë¦+šRû¾òm=±±…µ„ƒ–ÞË–*ƒ¢ö÷š¢‡–z/’òkž®/–6Ï–6ã¢ö÷Žˆ°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€¥˜€ …½¹™¥Éµ•¤É•ÑÕÉ¸ì((€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘¥¹5½‘•±Ì€ôÑÉÕ”ì(€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…”€ô€‹š¶–r£¢¾ßšÆ½µ™åU$ƒ’â8=±±…µ„ƒ¦+šRûš¢‡–z/šbû–¶cŠ˜ˆì(€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…•QåÁ”€ô€ˆˆì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð…Á¤¹™•Ñ¡Á¤ ˆ½Ñ½½±‰…œ½ÍåÍÑ•´½Õ¹±½…µµ½‘•±Ìˆ°ì(€€€€€€€€€€€€€€€€€€€µ•Ñ¡½è€‰A=MPˆ°(€€€€€€€€€€€€€€€€€€€¡•…‘•ÉÌèì€‰½¹Ñ•¹ÐµQåÁ”ˆè€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆô°(€€€€€€€€€€€€€€€€€€€‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡ì½¹™¥É´è€‰U91=}IU9Q%5}5=1Lˆô¤°(€€€€€€€€€€€€€€€€€€€Í¥¹…°°(€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹©Í½¸ ¤ì(€€€€€€€€€€€€€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€€€€€€€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡É•ÍÕ±Ð¹•ÉÉ½Èñðƒ¦+šRû–’Ç¢Ò”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€½¹ÍÐ½±±…µ„€ôÉ•ÍÕ±Ð¹½±±…µ„€üüíôì(€€€€€€€€€€€€€€€¥˜€ …½±±…µ„¹…Ù…¥±…‰±”¤ì(€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…”€ô€‰½µ™åU$ƒ–ÞË–º'š:K¦+šRû¾òošr«¢þ{š:—–"À=±±…µ„ˆì(€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…•QåÁ”€ô½±±…µ„¹•ÉÉ½ÉÌü¹±•¹Ñ €ü€‰•ÉÉ½Èˆ€è€‰ÍÕ•ÍÌˆì(€€€€€€€€€€€€€€€ô•±Í”¥˜€¡½±±…µ„¹•ÉÉ½ÉÌü¹±•¹Ñ ¤ì(€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…”€ô½µ™åU$ƒ–ÞË–º'š:K¦+šRû¾òm=±±…µ„ƒ–ÞË–6ã¢öô€‘í½±±…µ„¹Õ¹±½…‘•ü¹±•¹Ñ €üü€Áôƒ’â«¾ò3¦£–"–’Ç¢Ò•€ì(€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…•QåÁ”€ô€‰•ÉÉ½Èˆì(€€€€€€€€€€€€€€€ô•±Í”ì(€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…”€ô½µ™åU$ƒ–ÞË–º'š:K¦+šRû¾òm=±±…µ„ƒ–ÞË–6ã¢öô€‘í½±±…µ„¹Õ¹±½…‘•ü¹±•¹Ñ €üü€Áôƒ’â«š¢‡–z-€ì(€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…•QåÁ”€ô€‰ÍÕ•ÍÌˆì(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€Ý¥¹‘½Ü¹Í•ÑQ¥µ•½ÕÐ  ¤€ôø±½… ¤°€ÄÈÀÀ¤ì(€€€€€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€€€€€¥˜€¡•ÉÉ½È¹¹…µ”€ôôô€‰‰½ÉÑÉÉ½Èˆ¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…”€ô•ÉÉ½È¹µ•ÍÍ…”ñð€‹¦+šRûš¢‡–z/šbû–¶c–’Ç¢Ò”ˆì(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…•QåÁ”€ô€‰•ÉÉ½Èˆì(€€€€€€€€€€€ô™¥¹…±±äì(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘¥¹5½‘•±Ì€ô™…±Í”ì(€€€€€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€ô(€€€€€€€ô°ìÍ¥¹…°ô¤ì(€€€€€€€µ•µ½Éå…É¹…ÁÁ•¹¡Õ¹±½…¤ì(€€€€€€€¥˜€¡ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…”¤ì(€€€€€€€€€€€µ•µ½Éå…É¹…ÁÁ•¹¡É•…Ñ•±•µ•¹Ð (€€€€€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€€€€Ñ½½±‰…œµµ•ÑÉ¥ÌµÍ•ÉÙ¥”µµ•ÍÍ…”€‘íÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…•QåÁ•õ€¹ÑÉ¥´ ¤°(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹Õ¹±½…‘5•ÍÍ…”°(€€€€€€€€€€€€¤¤ì(€€€€€€€ô(€€€€€€€µ•µ½ÉåM•Ñ¥½¸¹…ÁÁ•¹¡µ•µ½Éå…É¤ì((€€€€€€€½¹ÍÐÍ•ÉÙ¥•M•Ñ¥½¸€ô…‘‘M•Ñ¥½¸ ‹šr7–*‡š:Ÿ–"Øˆ¤ì(€€€€€€€½¹ÍÐÍ•ÉÙ¥•…É€ôÉ•…Ñ•±•µ•¹Ð ‰‘¥Øˆ°€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÍ•ÉÙ¥”µ…Éˆ¤ì(€€€€€€€Í•ÉÙ¥•…É¹…ÁÁ•¹¡É•…Ñ•±•µ•¹Ð (€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÍ•ÉÙ¥”µ‘•ÍÉ¥ÁÑ¥½¸ˆ°(€€€€€€€€€€€€‹¦7–B¿’òk’â·šZ·–öO–&7š¶–r£š&Ÿ¢†3žj–Þ—’ösšÖ–J3–*ƒ¢ö÷’îï–*‡¾ò1ÍåÍÑ•µƒ–Â¢«–*£¦7šZÃ–B¿–* ½µ™åU'Žˆ°(€€€€€€€€¤¤ì(€€€€€€€½¹ÍÐÉ•ÍÑ…ÉÐ€ôÉ•…Ñ•±•µ•¹Ð (€€€€€€€€€€€€‰‰ÕÑÑ½¸ˆ°(€€€€€€€€€€€€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÉ•ÍÑ…ÉÐˆ°(€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ¥¹œ€ü€‹š¶–r£¦7–B¼½µ™åU'Š˜ˆ€è€‹¦7–B¼½µ™åU$ˆ°(€€€€€€€€¤ì(€€€€€€€É•ÍÑ…ÉÐ¹ÑåÁ”€ô€‰‰ÕÑÑ½¸ˆì(€€€€€€€É•ÍÑ…ÉÐ¹‘¥Í…‰±•€ôÍÑ…Ñ”¹É•ÍÑ…ÉÑ¥¹œ(€€€€€€€€€€€ñðµ•ÑÉ¥Ì¹Í•ÉÙ¥•}½¹ÑÉ½°ü¹É•ÍÑ…ÉÑ}ÍÕÁÁ½ÉÑ•€ôôô™…±Í”ì(€€€€€€€É•ÍÑ…ÉÐ¹Í•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ±…‰•°ˆ°€‹¦7–B¼½µ™åU$ƒšr7–*„ˆ¤ì(€€€€€€€É•ÍÑ…ÉÐ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…Íå¹Œ€ ¤€ôøì(€€€€€€€€€€€½¹ÍÐ½¹™¥Éµ•€ôÝ¥¹‘½Ü¹½¹™¥É´ (€€€€€€€€€€€€€€€€‹ž†»–ºk¢š¦7–B¼½µ™åU$ƒ–B_¾ò}q¹q»–öO–&7š¶–r£š&Ÿ¢†3žj–Þ—’ösšÖŽš¢‡–z/–*ƒ¢ö÷–J3¦b–"_’îï–*‡¦÷’òk’â·šZ·Žˆ°(€€€€€€€€€€€€¤ì(€€€€€€€€€€€¥˜€ …½¹™¥Éµ•¤É•ÑÕÉ¸ì((€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ¥¹œ€ôÑÉÕ”ì(€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ5•ÍÍ…”€ô€‹¦7–B¿¢¾ßšÆ–ÞË–>G¦¾ò3š¶–r£ž¶'–úšr7–*‡š‹–’7Š˜ˆì(€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ5•ÍÍ…•QåÁ”€ô€ˆˆì(€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð…Á¤¹™•Ñ¡Á¤ ˆ½Ñ½½±‰…œ½ÍåÍÑ•´½É•ÍÑ…ÉÐˆ°ì(€€€€€€€€€€€€€€€€€€€µ•Ñ¡½è€‰A=MPˆ°(€€€€€€€€€€€€€€€€€€€¡•…‘•ÉÌèì€‰½¹Ñ•¹ÐµQåÁ”ˆè€‰…ÁÁ±¥…Ñ¥½¸½©Í½¸ˆô°(€€€€€€€€€€€€€€€€€€€‰½‘äè)M=8¹ÍÑÉ¥¹¥™ä¡ì½¹™¥É´è€‰IMQIQ}=5eU$ˆô¤°(€€€€€€€€€€€€€€€€€€€Í¥¹…°°(€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹©Í½¸ ¤ì(€€€€€€€€€€€€€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤ì(€€€€€€€€€€€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È¡É•ÍÕ±Ð¹•ÉÉ½Èñðƒ¦7–B¿–’Ç¢Ò”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì(€€€€€€€€€€€€€€€ô((€€€€€€€€€€€€€€€½¹ÍÐ‘•…‘±¥¹”€ô…Ñ”¹¹½Ü ¤€¬€äÀÀÀÀì(€€€€€€€€€€€€€€€½¹ÍÐÉ•ÅÕ•ÍÑ•‘Ð€ô…Ñ”¹¹½Ü ¤ì(€€€€€€€€€€€€€€€±•Ð½‰Í•ÉÙ•‘=™™±¥¹”€ô™…±Í”ì(€€€€€€€€€€€€€€€Ý¡¥±”€ …Í¥¹…°¹…‰½ÉÑ•€˜˜…Ñ”¹¹½Ü ¤€ð‘•…‘±¥¹”¤ì(€€€€€€€€€€€€€€€€€€€…Ý…¥Ð¹•ÜAÉ½µ¥Í” ¡É•Í½±Ù”¤€ôøÝ¥¹‘½Ü¹Í•ÑQ¥µ•½ÕÐ¡É•Í½±Ù”°€ÄÔÀÀ¤¤ì(€€€€€€€€€€€€€€€€€€€ÑÉäì(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐµ•ÑÉ¥ÍI•ÍÁ½¹Í”€ô…Ý…¥Ð…Á¤¹™•Ñ¡Á¤ (€€€€€€€€€€€€€€€€€€€€€€€€€€€€ˆ½Ñ½½±‰…œ½ÍåÍÑ•´½µ•ÑÉ¥Ìˆ°(€€€€€€€€€€€€€€€€€€€€€€€€€€€ìÍ¥¹…°ô°(€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€¥˜€ …µ•ÑÉ¥ÍI•ÍÁ½¹Í”¹½¬¤Ñ¡É½Ü¹•ÜÉÉ½È ‹šr7–*‡–Âkšr«š‹–’4ˆ¤ì(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐ¹•áÑ5•ÑÉ¥Ì€ô…Ý…¥Ðµ•ÑÉ¥ÍI•ÍÁ½¹Í”¹©Í½¸ ¤ì(€€€€€€€€€€€€€€€€€€€€€€€½¹ÍÐÉ•ÍÑ…ÉÑ•‘½¹ÑÉ½±±•È€ô€ (€€€€€€€€€€€€€€€€€€€€€€€€€€€¹•áÑ5•ÑÉ¥Ì¹Í•ÉÙ¥•}½¹ÑÉ½°ü¹É•ÍÑ…ÉÑ}Í¡•‘Õ±•€ôôô™…±Í”(€€€€€€€€€€€€€€€€€€€€€€€€€€€€˜˜…Ñ”¹¹½Ü ¤€´É•ÅÕ•ÍÑ•‘Ð€ø€ÌÀÀÀ(€€€€€€€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡½‰Í•ÉÙ•‘=™™±¥¹”ñðÉ•ÍÑ…ÉÑ•‘½¹ÑÉ½±±•È¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹µ•ÑÉ¥Ì€ô¹•áÑ5•ÑÉ¥Ìì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ¥¹œ€ô™…±Í”ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ5•ÍÍ…”€ô€‰½µ™åU$ƒ–ÞË¦7–B¿–æÛš‹–’7¢þ{š:”ˆì(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ5•ÍÍ…•QåÁ”€ô€‰ÍÕ•ÍÌˆì(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡•ÉÉ½È¹¹…µ”€ôôô€‰‰½ÉÑÉÉ½Èˆ¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€€€€€€€€€½‰Í•ÉÙ•‘=™™±¥¹”€ôÑÉÕ”ì(€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€Ñ¡É½Ü¹•ÜÉÉ½È ‹ž¶'–ú½µ™åU$ƒ¦7–B¿¢Úš^Û¾ò3¢¾ßšŽš~—šr7–*‡–f£šr7–*‡ž*Ûšˆ¤ì(€€€€€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì(€€€€€€€€€€€€€€€¥˜€¡•ÉÉ½È¹¹…µ”€ôôô€‰‰½ÉÑÉÉ½Èˆ¤É•ÑÕÉ¸ì(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ¥¹œ€ô™…±Í”ì(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ5•ÍÍ…”€ô•ÉÉ½È¹µ•ÍÍ…”ñð€‹¦7–B¼½µ™åU$ƒ–’Ç¢Ò”ˆì(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ5•ÍÍ…•QåÁ”€ô€‰•ÉÉ½Èˆì(€€€€€€€€€€€€€€€É•¹‘•È ¤ì(€€€€€€€€€€€ô(€€€€€€€ô°ìÍ¥¹…°ô¤ì(€€€€€€€Í•ÉÙ¥•…É¹…ÁÁ•¹¡É•ÍÑ…ÉÐ¤ì(€€€€€€€¥˜€¡µ•ÑÉ¥Ì¹Í•ÉÙ¥•}½¹ÑÉ½°ü¹É•ÍÑ…ÉÑ}ÍÕÁÁ½ÉÑ•€ôôô™…±Í”¤ì(€€€€€€€€€€€Í•ÉÙ¥•…É¹…ÁÁ•¹¡É•…Ñ•±•µ•¹Ð (€€€€€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€€€€€‰Ñ½½±‰…œµµ•ÑÉ¥ÌµÍ•ÉÙ¥”µµ•ÍÍ…”•ÉÉ½Èˆ°(€€€€€€€€€€€€€€€€‹–öO–&7¢þC¢†3šZç–ò?’â7šR¿š2’î;¦v‹švÿ¦7–B¼ˆ°(€€€€€€€€€€€€¤¤ì(€€€€€€€ô•±Í”¥˜€¡ÍÑ…Ñ”¹É•ÍÑ…ÉÑ5•ÍÍ…”¤ì(€€€€€€€€€€€Í•ÉÙ¥•…É¹…ÁÁ•¹¡É•…Ñ•±•µ•¹Ð (€€€€€€€€€€€€€€€€‰‘¥Øˆ°(€€€€€€€€€€€€€€€Ñ½½±‰…œµµ•ÑÉ¥ÌµÍ•ÉÙ¥”µµ•ÍÍ…”€‘íÍÑ…Ñ”¹É•ÍÑ…ÉÑ5•ÍÍ…•QåÁ•õ€¹ÑÉ¥´ ¤°(€€€€€€€€€€€€€€€ÍÑ…Ñ”¹É•ÍÑ…ÉÑ5•ÍÍ…”°(€€€€€€€€€€€€¤¤ì(€€€€€€€ô(€€€€€€€Í•ÉÙ¥•M•Ñ¥½¸¹…ÁÁ•¹¡Í•ÉÙ¥•…É¤ì(€€€ôì((€€€½¹ÍÐ±½…€ô…Íå¹Œ€ ¤€ôøì(€€€€€€€¥˜€¡ÍÑ…Ñ”¹±½…‘¥¹œñðÍÑ…Ñ”¹Õ¹±½…‘¥¹5½‘•±ÌñðÍÑ…Ñ”¹É•ÍÑ…ÉÑ¥¹œñðÍ¥¹…°¹…‰½ÉÑ•¤É•ÑÕÉ¸ì(€€€€€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ì4(€€€€€€€ÍÑ…Ñ”¹•ÉÉ½È€ô€ˆˆì4(€€€€€€€É•¹‘•È ¤ì4(€€€€€€€ÑÉäì4(€€€€€€€€€€€½¹ÍÐÉ•ÍÁ½¹Í”€ô…Ý…¥Ð…Á¤¹™•Ñ¡Á¤ ˆ½Ñ½½±‰…œ½ÍåÍÑ•´½µ•ÑÉ¥Ìˆ°ìÍ¥¹…°ô¤ì4(€€€€€€€€€€€¥˜€ …É•ÍÁ½¹Í”¹½¬¤Ñ¡É½Ü¹•ÜÉÉ½È¡ƒ¢¾ï–>[žÎïžîš2š‚–’Ç¢Ò”€ ‘íÉ•ÍÁ½¹Í”¹ÍÑ…ÑÕÍô¥€¤ì4(€€€€€€€€€€€ÍÑ…Ñ”¹µ•ÑÉ¥Ì€ô…Ý…¥ÐÉ•ÍÁ½¹Í”¹©Í½¸ ¤ì4(€€€€€€€ô…Ñ €¡•ÉÉ½È¤ì4(€€€€€€€€€€€¥˜€¡•ÉÉ½È¹¹…µ”€ôôô€‰‰½ÉÑÉÉ½Èˆ¤É•ÑÕÉ¸ì4(€€€€€€€€€€€ÍÑ…Ñ”¹•ÉÉ½È€ô•ÉÉ½È¹µ•ÍÍ…”ñð€‹¢¾ï–>[žÎïžîš2š‚–’Ç¢Ò”ˆì4(€€€€€€€ô™¥¹…±±äì4(€€€€€€€€€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ì4(€€€€€€€€€€€¥˜€ …Í¥¹…°¹…‰½ÉÑ•¤É•¹‘•È ¤ì4(€€€€€€€ô4(€€€ôì4(4(€€€É•™É•Í ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°±½…°ìÍ¥¹…°ô¤ì4(€€€½¹ÍÐÑ¥µ•È€ôÝ¥¹‘½Ü¹Í•Ñ%¹Ñ•ÉÙ…°¡±½…°€ÈÀÀÀ¤ì4(€€€Í¥¹…°¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…‰½ÉÐˆ°€ ¤€ôøÝ¥¹‘½Ü¹±•…É%¹Ñ•ÉÙ…°¡Ñ¥µ•È¤°ì½¹”èÑÉÕ”ô¤ì4(€€€±½… ¤ì4)ôì4(4)±•Ðµ•ÑÉ¥ÍA…¹•±½¹ÑÉ½±±•Èì4(4)…ÁÀ¹É•¥ÍÑ•ÉáÑ•¹Í¥½¸¡ì4(€€€¹…µ”è€‰½µ™åU$¹Q½½±	…œ¹MåÍÑ•µ5•ÑÉ¥Ìˆ°4(€€€Í•ÑÕÀ ¤ì4(€€€€€€€…ÁÀ¹•áÑ•¹Í¥½¹5…¹…•È¹É•¥ÍÑ•ÉM¥‘•‰…ÉQ…ˆ¡ì4(€€€€€€€€€€€¥è€‰Ñ½½±‰…œµÍåÍÑ•´µµ•ÑÉ¥Ìˆ°4(€€€€€€€€€€€¥½¸è€‰Á¤Á¤µÍ•ÉÙ•Èˆ°4(€€€€€€€€€€€Ñ¥Ñ±”è€‹šr7–*‡–f£¢ÖšêCžnGš:œˆ°4(€€€€€€€€€€€Ñ½½±Ñ¥Àè€‹–º{š^Ûš~—žr,AWŽ––¶cŽšbû–¶cŽšâ§–ê›’â;ž†³žnc’ög¦<ˆ°4(€€€€€€€€€€€ÑåÁ”è€‰ÕÍÑ½´ˆ°4(€€€€€€€€€€€É•¹‘•È¡•±•µ•¹Ð¤ì4(€€€€€€€€€€€€€€€µ•ÑÉ¥ÍA…¹•±½¹ÑÉ½±±•Èü¹…‰½ÉÐ ¤ì4(€€€€€€€€€€€€€€€µ•ÑÉ¥ÍA…¹•±½¹ÑÉ½±±•È€ô¹•Ü‰½ÉÑ½¹ÑÉ½±±•È ¤ì4(€€€€€€€€€€€€€€€É•…Ñ•5•ÑÉ¥ÍA…¹•°¡•±•µ•¹Ð°µ•ÑÉ¥ÍA…¹•±½¹ÑÉ½±±•È¹Í¥¹…°¤ì4(€€€€€€€€€€€ô°4(€€€€€€€€€€€‘•ÍÑÉ½ä ¤ì4(€€€€€€€€€€€€€€€µ•ÑÉ¥ÍA…¹•±½¹ÑÉ½±±•Èü¹…‰½ÉÐ ¤ì4(€€€€€€€€€€€€€€€µ•ÑÉ¥ÍA…¹•±½¹ÑÉ½±±•È€ôÕ¹‘•™¥¹•ì4(€€€€€€€€€€€ô°4(€€€€€€€ô¤ì4(€€€ô°4)ô¤ì4