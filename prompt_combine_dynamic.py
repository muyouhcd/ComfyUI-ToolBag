# -*- coding: utf-8 -*-
"""
描述词组合节点

说明：
- ComfyUI 标准节点 API 不支持动态「添加/移除」按钮，输入数量在注册时固定。
- 本节点提供若干固定槽位，用「启用」勾选表示该条参与组合，取消勾选即相当于移除该条。
- 仅启用且非空的文本框会按顺序用换行拼接成最终描述词。
"""

from comfy.comfy_types import InputTypeDict


# 槽位数量：ComfyUI 无法动态增删，这里用固定 8 条，通过勾选开关“启用/不用”来控制是否参与组合
NUM_DEFAULT = 3
NUM_MAX = 8


def build_input_types(num_default: int = NUM_DEFAULT, num_max: int = NUM_MAX) -> InputTypeDict:
    """动态生成 INPUT_TYPES：顶部图片输入，然后每组为 (输入框, 勾选)，勾选显示在对应提示词下方。"""
    required = {
        "image": ("IMAGE", {"tooltip": "输入图片"}),
    }
    for i in range(1, num_max + 1):
        required[f"text_{i}"] = (
            "STRING",
            {
                "default": "",  # 确保默认值为空字符串
                "multiline": True,
                "placeholder": f"描述词 {i}",
                "lines": 2,  # 多行框显示行数，部分前端支持
            },
        )
        required[f"enable_{i}"] = (
            "BOOLEAN",
            {"default": i <= num_default, "label_on": "启用", "label_off": "禁用"},
        )
    return {"required": required}


class PromptCombineDynamic:
    """多个带开关的文本输入，启用且非空的内容会用换行拼接为一个输出字符串。
    顶部有图片输入槽位，节点会输出图片和组合后的描述词。
    无增删按钮：ComfyUI 限制，仅能通过勾选「启用/禁用」控制某条是否参与组合。"""

    @classmethod
    def INPUT_TYPES(cls) -> InputTypeDict:
        return build_input_types()

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "text")
    FUNCTION = "combine"
    CATEGORY = "ToolBag/text"

    def combine(self, image, **kwargs):
        parts = []
        for i in range(1, NUM_MAX + 1):
            enabled = kwargs.get(f"enable_{i}", False)
            text = (kwargs.get(f"text_{i}") or "").strip()
            if enabled and text:
                parts.append(text)
        text_result = "\n".join(parts) if parts else ""
        return (image, text_result)


NODE_CLASS_MAPPINGS = {
    "PromptCombineDynamic": PromptCombineDynamic,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptCombineDynamic": "描述词组合(ToolBag)",
}

