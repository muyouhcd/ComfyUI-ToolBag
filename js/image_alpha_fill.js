import { app } from "../../../scripts/app.js";

const NODE_TYPE = "ImageAlphaFill";

app.registerExtension({
    name: "ComfyUI.ToolBag.ImageAlphaFill",

    async nodeCreated(node) {
        if (node.type !== NODE_TYPE) return;

        const colorWidget = node.widgets?.find(w => w.name === "background_color");
        if (!colorWidget) return;

        // 创建一个不可见的 <input type="color"> 挂到 body，用于弹出系统原生颜色轮盘
        const picker = document.createElement("input");
        picker.type  = "color";
        Object.assign(picker.style, {
            position:      "absolute",
            opacity:       "0",
            pointerEvents: "none",
            width:         "0",
            height:        "0",
        });
        document.body.appendChild(picker);

        // 同步 widget 值 → picker
        const syncToPicker = () => {
            const v = colorWidget.value?.trim() ?? "#ffffff";
            picker.value = v.startsWith("#") ? v : "#" + v;
        };
        syncToPicker();

        // 用户在轮盘中选色 → 更新 widget 值
        picker.addEventListener("input",  () => { colorWidget.value = picker.value.toUpperCase(); app.graph.setDirtyCanvas(true, false); });
        picker.addEventListener("change", () => { colorWidget.value = picker.value.toUpperCase(); app.graph.setDirtyCanvas(true, false); });

        // 覆盖 draw：绘制颜色色块 + 十六进制文字
        colorWidget.draw = function(ctx, node, widgetWidth, y, H) {
            const margin  = 15;
            const swatchW = H + 4;
            const x0      = margin;

            // 色块
            ctx.fillStyle = this.value ?? "#ffffff";
            ctx.beginPath();
            ctx.roundRect?.(x0, y + 2, swatchW, H - 4, 3) || ctx.rect(x0, y + 2, swatchW, H - 4);
            ctx.fill();

            // 色块边框
            ctx.strokeStyle = "rgba(255,255,255,0.3)";
            ctx.lineWidth   = 1;
            ctx.stroke();

            // 十六进制文字
            ctx.fillStyle   = LiteGraph?.WIDGET_TEXT_COLOR ?? "#ddd";
            ctx.font        = `${LiteGraph?.WIDGET_FONT_SIZE ?? 12}px monospace`;
            ctx.textAlign   = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(this.value ?? "#FFFFFF", x0 + swatchW + 10, y + H / 2);
        };

        // 覆盖 mouse：点击时弹出颜色轮盘
        colorWidget.mouse = function(event, pos, node) {
            if (event.type !== "pointerdown") return;
            syncToPicker();
            picker.click();
        };

        // 节点销毁时清理 DOM
        const _origRemoved = node.onRemoved?.bind(node);
        node.onRemoved = function() {
            picker.remove();
            _origRemoved?.();
        };
    },
});
