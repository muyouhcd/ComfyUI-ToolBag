# -*- coding: utf-8 -*-
"""
将图像缩放后居中补全为正方形。
步骤：
  1. 等比缩放，使最长边等于 target_size。
  2. 在短边两侧对称补全纯色（默认白色）至 target_size × target_size。
"""

import torch
import torch.nn.functional as F


class ResizeAndPadToSquare:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "target_size": ("INT", {
                    "default": 512,
                    "min": 64,
                    "max": 8192,
                    "step": 8,
                    "tooltip": "输出尺寸（正方形边长）",
                }),
                "fill_value": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.01,
                    "tooltip": "补全颜色：1.0 = 白色，0.0 = 黑色",
                }),
                "interpolation": (["bilinear", "nearest", "bicubic", "area"], {
                    "default": "bilinear",
                }),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"
    CATEGORY = "ToolBag/image"

    def run(self, image: torch.Tensor, target_size: int, fill_value: float, interpolation: str):
        # image: [B, H, W, C] float32 0..1
        B, H, W, C = image.shape

        # Step 1: 等比缩放，最长边 = target_size
        scale = target_size / max(H, W)
        new_h = max(1, round(H * scale))
        new_w = max(1, round(W * scale))

        x = image.permute(0, 3, 1, 2)  # [B, C, H, W]
        interp_kwargs = {"size": (new_h, new_w), "mode": interpolation}
        if interpolation not in ("nearest", "area"):
            interp_kwargs["align_corners"] = False
        x = F.interpolate(x, **interp_kwargs)

        # Step 2: 居中补全到 target_size × target_size
        pad_h = target_size - new_h
        pad_w = target_size - new_w
        pad_top    = pad_h // 2
        pad_bottom = pad_h - pad_top
        pad_left   = pad_w // 2
        pad_right  = pad_w - pad_left

        # F.pad 最后两维顺序：(left, right, top, bottom)
        x = F.pad(x, (pad_left, pad_right, pad_top, pad_bottom), value=fill_value)

        result = x.permute(0, 2, 3, 1).contiguous()  # [B, H, W, C]
        return (result,)


NODE_CLASS_MAPPINGS = {
    "ResizeAndPadToSquare": ResizeAndPadToSquare,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ResizeAndPadToSquare": "Resize and Pad to Square",
}
