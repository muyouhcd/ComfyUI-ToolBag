import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_TYPE = "FolderImageLoader";

app.registerExtension({
    name: "ComfyUI.ToolBag.FolderImageLoader",

    async setup() {
        /**
         * 拦截 api.queuePrompt（低层 HTTP 提交函数）而非 app.queuePrompt，
         * 避开新版 ComfyUI Vue 响应式系统对 app.queuePrompt 覆盖失效的问题。
         *
         * 触发条件：序列化后的 prompt 中存在 FolderImageLoader 节点，
         * 且其 start_index 不是外部连线（不是 [node_id, slot] 格式）。
         */
        const _origApiQueue = api.queuePrompt.bind(api);

        api.queuePrompt = async (number, promptData, options) => {
            const { output, workflow } = promptData ?? {};
            if (!output) return _origApiQueue(number, promptData, options);

            // 找出所有 start_index 未被外部连线的 FolderImageLoader 节点
            const loaderEntries = Object.entries(output).filter(([nodeId, nodeData]) => {
                if (nodeData.class_type !== NODE_TYPE) return false;
                const si = nodeData.inputs?.start_index;
                if (Array.isArray(si)) return false; // 外部连线，不干预
                // 确认该节点有被其他节点使用（已连线到下游）
                return Object.values(output).some(n =>
                    Object.values(n.inputs ?? {}).some(v =>
                        Array.isArray(v) && String(v[0]) === nodeId
                    )
                );
            });

            if (loaderEntries.length === 0) return _origApiQueue(number, promptData, options);

            // 以第一个节点的路径查询图像数量
            const [firstId, firstData] = loaderEntries[0];
            const folderPath = firstData.inputs?.folder_path;
            const recursive  = firstData.inputs?.recursive ?? false;
            const startIdx   = firstData.inputs?.start_index ?? 0;

            if (!folderPath?.toString().trim()) return _origApiQueue(number, promptData, options);

            let count = 1;
            try {
                const resp = await fetch(
                    `/toolbag/folder_image_count?path=${encodeURIComponent(folderPath)}&recursive=${recursive}`
                );
                const data = await resp.json();
                count = data.count ?? 1;
                console.log(`[FolderImageLoader] 路径="${folderPath}" 共 ${count} 张，从 ${startIdx} 开始`);
            } catch (e) {
                console.warn("[FolderImageLoader] 无法获取图像数量，退回单次运行", e);
                return _origApiQueue(number, promptData, options);
            }

            if (count <= 0) return _origApiQueue(number, promptData, options);

            // 逐张克隆 prompt，同步修改所有 loader 节点的 start_index
            let lastResult;
            for (let i = startIdx; i < count; i++) {
                const outputCopy = JSON.parse(JSON.stringify(output));
                for (const [nodeId] of loaderEntries) {
                    outputCopy[nodeId].inputs.start_index = i;
                }
                console.log(`[FolderImageLoader] 入队 ${i + 1}/${count}`);
                lastResult = await _origApiQueue(number, { output: outputCopy, workflow }, options);
            }
            return lastResult;
        };

        // 更新节点标题显示进度
        api.addEventListener("executed", ({ detail }) => {
            const { node: nodeId, output } = detail;
            if (!output || output.has_more === undefined) return;

            const id   = typeof nodeId === "string" ? parseInt(nodeId) : nodeId;
            const node = app.graph.getNodeById(id);
            if (!node || node.type !== NODE_TYPE) return;

            const hasMore  = output.has_more[0];
            const index    = output.index?.[0]    ?? 0;
            const total    = output.total?.[0]    ?? 0;
            const filename = output.filename?.[0] ?? "";

            node.title = hasMore
                ? `📂 加载中 [${index + 1}/${total}] ${filename}`
                : `📂 完成 ✅ [${total}/${total}]`;
            app.graph.setDirtyCanvas(true, false);
        });
    },

    async nodeCreated(node) {
        if (node.type !== NODE_TYPE) return;
        node.title = "📂 文件夹图像加载器";
    },
});
