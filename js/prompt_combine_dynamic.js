import { app } from "../../../scripts/app.js";

/**
 * 描述词组合节点扩展：当启用/禁用勾选改变时，对应的文本框会变灰（禁用）
 */
app.registerExtension({
    name: "ComfyUI.ToolBag.PromptCombineDynamic",
    
    async nodeCreated(node) {
        // 只处理我们的描述词组合节点
        if (node.constructor.name !== "PromptCombineDynamic") {
            return;
        }

        // 等待节点完全创建后再设置监听器
        setTimeout(() => {
            setupEnableDisableHandlers(node);
        }, 200);
    }
});

/**
 * 设置启用/禁用处理逻辑
 */
function setupEnableDisableHandlers(node) {
    const widgets = node.widgets || [];
    
    // 找到所有 enable_* 和 text_* 控件
    const enableWidgets = {};
    const textWidgets = {};
    
    widgets.forEach((widget) => {
        if (widget.name && widget.name.startsWith('enable_')) {
            const num = widget.name.replace('enable_', '');
            enableWidgets[num] = widget;
        } else if (widget.name && widget.name.startsWith('text_')) {
            const num = widget.name.replace('text_', '');
            textWidgets[num] = widget;
        }
    });

    // 为每个 enable_* 控件设置变化监听器
    Object.keys(enableWidgets).forEach(num => {
        const enableWidget = enableWidgets[num];
        const textWidget = textWidgets[num];
        
        if (!enableWidget || !textWidget) {
            return;
        }

        // 初始状态设置
        updateTextWidgetState(enableWidget, textWidget);

        // 监听 enable 控件的变化
        const originalCallback = enableWidget.callback;
        enableWidget.callback = function(value) {
            // 调用原始回调
            if (originalCallback) {
                originalCallback.call(this, value);
            }
            // 更新对应的文本框状态
            updateTextWidgetState(enableWidget, textWidget);
        };
    });
}

/**
 * 更新文本框的禁用状态
 */
function updateTextWidgetState(enableWidget, textWidget) {
    if (!enableWidget || !textWidget) {
        return;
    }

    const isEnabled = enableWidget.value === true || enableWidget.value === 1 || enableWidget.value === "true";
    
    // 获取文本框的 DOM 元素
    let inputEl = null;
    
    // 尝试多种方式获取输入元素
    if (textWidget.inputEl) {
        inputEl = textWidget.inputEl;
    } else if (textWidget.htmlElement) {
        inputEl = textWidget.htmlElement.querySelector('input, textarea');
    } else if (textWidget.computeSize) {
        // 如果是自定义控件，尝试查找其子元素
        const widgetEl = document.querySelector(`[data-node-id="${textWidget.node?.id || ''}"][data-widget-name="${textWidget.name}"]`);
        if (widgetEl) {
            inputEl = widgetEl.querySelector('input, textarea');
        }
    }
    
    // 如果还是找不到，尝试通过节点查找
    if (!inputEl && textWidget.node) {
        const nodeEl = document.querySelector(`[data-node-id="${textWidget.node.id}"]`);
        if (nodeEl) {
            // 查找对应的输入框（通过名称匹配）
            const allInputs = nodeEl.querySelectorAll('input, textarea');
            for (let input of allInputs) {
                const widgetName = input.closest('.widget')?.getAttribute('data-widget-name');
                if (widgetName === textWidget.name) {
                    inputEl = input;
                    break;
                }
            }
        }
    }
    
    // 如果找到了输入元素，更新其状态
    if (inputEl) {
        inputEl.disabled = !isEnabled;
        if (isEnabled) {
            inputEl.style.opacity = "1";
            inputEl.style.cursor = "text";
            inputEl.style.backgroundColor = "";
        } else {
            inputEl.style.opacity = "0.5";
            inputEl.style.cursor = "not-allowed";
            inputEl.style.backgroundColor = "#f0f0f0";
        }
    }
    
    // 也尝试更新 widget 本身的样式
    if (textWidget.htmlElement) {
        const widgetContainer = textWidget.htmlElement.closest('.widget');
        if (widgetContainer) {
            if (isEnabled) {
                widgetContainer.style.opacity = "1";
            } else {
                widgetContainer.style.opacity = "0.5";
            }
        }
    }
}
