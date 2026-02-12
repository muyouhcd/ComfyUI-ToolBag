# ComfyUI 提示词组合节点 (Prompt Combine Node)
# 将多个可勾选的提示词输入框组合为一个文本输出

# 默认 5 个输入框，最多 20 个（可视为“自行添加”的槽位）
NUM_DEFAULT = 5
NUM_MAX = 20

# “可添加/移除”的增强版：默认更少、上限更高
NUM_DEFAULT_DYNAMIC = 3
NUM_MAX_DYNAMIC = 50


def build_input_types(num_default: int, num_max: int):
    """动态生成 INPUT_TYPES：每组为 (勾选, 输入框)。

    说明：ComfyUI 的节点输入项数量通常需要在注册时固定；
    所谓“添加/移除”一般通过预留更多槽位，然后用启用开关控制生效/失效来实现。
    """
    required = {}
    for i in range(1, num_max + 1):
        required[f"enable_{i}"] = ("BOOLEAN", {"default": i <= num_default, "label_on": "启用", "label_off": "禁用"})
        required[f"text_{i}"] = ("STRING", {"default": "", "multiline": True, "placeholder": f"提示词 {i}"})
    return {"required": required}


class PromptCombineNode:
    """提示词组合节点：多个带勾选的输入框，仅勾选中的内容会拼接到输出文本。"""

    @classmethod
    def INPUT_TYPES(cls):
        return build_input_types(NUM_DEFAULT, NUM_MAX)

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "combine"
    CATEGORY = "prompt"

    def combine(self, **kwargs):
        parts = []
        for i in range(1, NUM_MAX + 1):
            enabled = kwargs.get(f"enable_{i}", False)
            text = (kwargs.get(f"text_{i}") or "").strip()
            if enabled and text:
                parts.append(text)
        result = "\n".join(parts) if parts else ""
        return (result,)


class PromptCombineToolbagNode(PromptCombineNode):
    """同上，但归入 toolbag 分类。"""
    CATEGORY = "toolbag"


class PromptCombineDynamicToolbagNode:
    """描述词组合（可增删项）：多个带勾选的输入框，启用且非空的内容会用换行拼接输出。

    说明：通过预留更多输入“槽位”并用开关控制生效/失效，达到“自行添加/移除”的体验。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return build_input_types(NUM_DEFAULT_DYNAMIC, NUM_MAX_DYNAMIC)

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "combine"
    CATEGORY = "toolbag"

    def combine(self, **kwargs):
        parts = []
        for i in range(1, NUM_MAX_DYNAMIC + 1):
            enabled = kwargs.get(f"enable_{i}", False)
            text = (kwargs.get(f"text_{i}") or "").strip()
            if enabled and text:
                parts.append(text)
        result = "\n".join(parts) if parts else ""
        return (result,)


# 注册节点（prompt 与 toolbag 各一份）
NODE_CLASS_MAPPINGS = {
    "PromptCombine": PromptCombineNode,
    "PromptCombineToolbag": PromptCombineToolbagNode,
    "PromptCombineDynamicToolbag": PromptCombineDynamicToolbagNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptCombine": "提示词组合",
    "PromptCombineToolbag": "提示词组合",
    "PromptCombineDynamicToolbag": "描述词组合（可增删）",
}
