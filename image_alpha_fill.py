# -*- coding: utf-8 -*-
"""
Alpha 背景填充节点
将带有透明通道（RGBA）的图像叠加到纯色背景上，输出 RGB 图像。
对于不含 alpha 通道的普通 RGB 图像，原样返回。
"""

import torch


def _parse_hex_color(hex_str: str) -> tuple:
    """解析 #RRGGBB 或 RRGGBB 格式的十六进制颜色，返回 (r, g, b) float 0-1。"""
    s = hex_str.strip().lstrip("#")
    if len(s) != 6:
        raise ValueError(f"颜色格式无效，请使用 #RRGGBB，当前值：{hex_str!r}")
    r = int(s[0:2], 16) / 255.0
    g = int(s[2:4], 16) / 255.0
    b = int(s[4:6], 16) / 255.0
    return r, g, b


class ImageAlphaFill:
    """
    将 RGBA 图像的 alpha 通道叠加到指定纯色背景上，输出 RGB 图像。
    公式：out = alpha * rgb + (1 - alpha) * bg_color
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": "输入图像，支持 RGB（3通道）或 RGBA（4通道）",
                }),
                "background_color": ("STRING", {
                    "default": "#FFFFFF",
                    "tooltip": "背景颜色，格式 #RRGGBB，例如 #FFFFFF（白）、#000000（黑）",
                }),
            },
            "optional": {
                "mask": ("MASK", {
                    "tooltip": "可选：外部遮罩（0=透明，1=不透明），会覆盖图像自带的 alpha 通道",
                }),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"
    CATEGORY = "ToolBag/image"

    def run(self, image: torch.Tensor, background_color: str, mask: torch.Tensor = None):
        # image: [B, H, W, C]，C 为 3 (RGB) 或 4 (RGBA)
        r, g, b = _parse_hex_color(background_color)

        C = image.shape[-1]

        if mask is not None:
            # mask: [B, H, W] 或 [1, H, W]，值域 0-1，1=不透明
            alpha = mask.to(image.device, dtype=image.dtype)
            # 广播到 [B, H, W]
            if alpha.ndim == 2:
                alpha = alpha.unsqueeze(0)
            # 扩展 batch 维
            if alpha.shape[0] == 1 and image.shape[0] > 1:
                alpha = alpha.expand(image.shape[0], -1, -1)
            alpha = alpha.unsqueeze(-1)          # [B, H, W, 1]
            rgb = image[..., :3]                 # 取 RGB 部分
        elif C == 4:
            rgb   = image[..., :3]               # [B, H, W, 3]
            alpha = image[..., 3:4]              # [B, H, W, 1]，值域 0-1
        else:
            # 普通 RGB 图像，无 alpha，直接返回
            return (image,)

        bg = torch.tensor([r, g, b], dtype=image.dtype, device=image.device)
        bg = bg.view(1, 1, 1, 3).expand_as(rgb)

        # Alpha 合成：out = alpha * fg + (1 - alpha) * bg
        result = alpha * rgb + (1.0 - alpha) * bg
        result = result.clamp(0.0, 1.0)

        return (result,)


NODE_CLASS_MAPPINGS = {
    "ImageAlphaFill": ImageAlphaFill,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageAlphaFill": "Alpha 背景填充 (ToolBag)",
}
