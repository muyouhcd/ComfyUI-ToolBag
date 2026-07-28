const MODELSCOPE_ORIGIN = "https://www.modelscope.cn";

function modelScopeSearchUrl(name) {
    return `${MODELSCOPE_ORIGIN}/search?from=opensearch&search=${encodeURIComponent(name)}`;
}

function splitRepositoryPath(pathname, marker) {
    const parts = pathname.split("/").filter(Boolean);
    const markerIndex = parts.indexOf(marker);
    if (markerIndex < 2 || parts.length <= markerIndex + 2) return null;

    return {
        owner: parts[markerIndex - 2],
        repository: parts[markerIndex - 1],
        revision: parts[markerIndex + 1],
        filePath: parts.slice(markerIndex + 2).join("/"),
    };
}

export function toModelScopeUrl(sourceUrl, modelName) {
    if (!sourceUrl) return modelScopeSearchUrl(modelName);

    let url;
    try {
        url = new URL(sourceUrl);
    } catch {
        return modelScopeSearchUrl(modelName);
    }

    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "modelscope.cn") {
        url.protocol = "https:";
        url.host = "www.modelscope.cn";
        return url.toString();
    }

    if (hostname !== "huggingface.co") {
        return modelScopeSearchUrl(modelName);
    }

    const resolved = splitRepositoryPath(url.pathname, "resolve")
        ?? splitRepositoryPath(url.pathname, "blob");
    if (!resolved?.filePath) return modelScopeSearchUrl(modelName);

    const revision = resolved.revision === "main" ? "master" : resolved.revision;
    return `${MODELSCOPE_ORIGIN}/models/${resolved.owner}/${resolved.repository}/resolve/${revision}/${resolved.filePath}`;
}

export function rewriteWorkflowModelUrls(
    workflow,
    linksByName = new Map(),
    modelsByName = new Map(),
) {
    const visited = new WeakSet();

    function visit(value) {
        if (!value || typeof value !== "object" || visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value.models)) {
            for (const model of value.models) {
                if (!model || typeof model !== "object" || typeof model.name !== "string") continue;
                model.url = toModelScopeUrl(model.url, model.name);
                linksByName.set(model.name, model.url);
                modelsByName.set(model.name, {
                    name: model.name,
                    url: model.url,
                    directory: model.directory,
                });
            }
        }

        for (const child of Object.values(value)) visit(child);
    }

    visit(workflow);
    return linksByName;
}

export function getModelScopeLink(modelName, linksByName) {
    return linksByName.get(modelName) ?? modelScopeSearchUrl(modelName);
}
