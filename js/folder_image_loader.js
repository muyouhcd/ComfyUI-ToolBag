import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_TYPE = "FolderImageLoader";

// 防止同一批次内重复触发队列
let _autoQueueScheduled = false;

app.registerExtension({
    name: "ComfyUI.ToolBag.FolderImageLoader",

    async setup() {
        /**
         * 监听节点执行完成事件。
         * 索引状态完全由 Python 端管理，JS 只负责：
         * - has_more=true：触发下一次 Queue
         * - has_more=false：停止，更新标题
         */
        api.addEventListener("executed", async ({ detail }) => {
            const { node: nodeId, output } = detail;

            if (!output || output.has_more === undefined) return;

            const node = app.graph.getNodeById(
                typeof nodeId === "string" ? parseInt(nodeId) : nodeId
            );
            if (!node || node.type !== NODE_TYPE) return;

            const hasMore  = output.has_more[0];
            const index    = output.index?.[0]    ?? 0;
            const total    = output.total?.[0]    ?? 0;
            const filename = output.filename?.[0] ?? "";

            node.title = hasMore
                ? `📂 加载中 [${index + 1}/${total}] ${filename}`
                : `📂 完成 ✅ [${total}/${total}]`;
            app.graph.setDirtyCanvas(true, false);

            if (!hasMore || _autoQueueScheduled) return;

            _autoQueueScheduled = true;
            await new Promise(r => setTimeout(r, 150));
            _autoQueueScheduled = false;
            app.queuePrompt(0, 1);
        });
    },

    async nodeCreated(node) {
        if (node.type !== NODE_TYPE) return;
        node.title = "📂 文件夹图像加载器";
    },
});
