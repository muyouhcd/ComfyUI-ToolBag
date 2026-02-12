# -*- coding: utf-8 -*-
"""
图像中心对齐合成节点
将三个输入图像按顺序叠加，叠加方式为中心对齐。
底层 = 图像1，中层 = 图像2，顶层 = 图像3。
"""

import torch
import comfy.utils
import node_helpers
from comfy.comfy_types import InputTypeDict

# 复用 ComfyUI 官方的 composite 逻辑（与 nodes_mask 一致）
def _composite(destination, source, x, y, mask=None, multiplier=1, resize_source=False):
    """将 source 合成到 destination 的 (x,y) 位置。destination/source 格式为 (B, C, H, W)。"""
    source = source.to(destination.device)
    if resize_source:
        source = torch.nn.functional.interpolate(
            source, size=(destination.shape[-2], destination.shape[-1]), mode="bilinear"
        )
    source = comfy.utils.repeat_to_batch_size(source, destination.shape[0])
    x = max(-source.shape[-1] * multiplier, min(x, destination.shape[-1] * multiplier))
    y = max(-source.shape[-2] * multiplier, min(y, destination.shape[-2] * multiplier))
    left, top = (x // multiplier, y // multiplier)
    right, bottom = (left + source.shape[-1], top + source.shape[-2])
    if mask is None:
        mask = torch.ones_like(source)
    else:
        mask = mask.to(destination.device, copy=True)
        mask = torch.nn.functional.interpolate(
            mask.reshape((-1, 1, mask.shape[-2], mask.shape[-1])),
            size=(source.shape[-2], source.shape[-1]),
            mode="bilinear",
        )
        mask = comfy.utils.repeat_to_batch_size(mask, source.shape[0])
    visible_width = destination.shape[-1] - left + min(0, x)
    visible_height = destination.shape[-2] - top + min(0, y)
    mask = mask[:, :, :visible_height, :visible_width]
    if mask.ndim < source.ndim:
        mask = mask.unsqueeze(1)
    inverse_mask = torch.ones_like(mask) - mask
    source_portion = mask * source[..., :visible_height, :visible_width]
    destination_portion = inverse_mask * destination[..., top:bottom, left:right]
    destination[..., top:bottom, left:right] = source_portion + destination_portion
    return destination


def _center_offset(dest_h, dest_w, src_h, src_w):
    """计算中心对齐时 source 左上角在 destination 上的 (x, y) 像素坐标。"""
    x = (dest_w - src_w) // 2
    y = (dest_h - src_h) // 2
    return x, y


class ImageCompositeCenter:
    """
    三图中心对齐合成节点。
    三个图像输入从上到下依次为：底层、中层、顶层；叠加对齐方式为中心对齐。
    画布尺寸以第一个输入（底层）为准，其余图像按中心对齐叠加上去。
    """

    @classmethod
    def INPUT_TYPES(cls) -> InputTypeDict:
        return {
            "required": {
                "image_1": ("IMAGE", {"tooltip": "底层图像（背景）"}),
                "image_2": ("IMAGE", {"tooltip": "中层图像"}),
                "image_3": ("IMAGE", {"tooltip": "顶层图像"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "composite_center"
    CATEGORY = "ToolBag/image"

    def composite_center(self, image_1, image_2, image_3):
        # ComfyUI IMAGE 格式: (B, H, W, C)，composite 需要 (B, C, H, W)
        # 以第一张为画布
        dest, img2 = node_helpers.image_alpha_fix(image_1, image_2)
        dest = dest.clone().movedim(-1, 1)
        img2 = img2.movedim(-1, 1)
        dest_h, dest_w = dest.shape[-2], dest.shape[-1]
        src2_h, src2_w = img2.shape[-2], img2.shape[-1]
        x2, y2 = _center_offset(dest_h, dest_w, src2_h, src2_w)
        dest = _composite(dest, img2, x2, y2, multiplier=1, resize_source=False)

        dest_img3, img3 = node_helpers.image_alpha_fix(
            dest.movedim(1, -1), image_3
        )
        dest = dest_img3.clone().movedim(-1, 1)
        img3 = img3.movedim(-1, 1)
        src3_h, src3_w = img3.shape[-2], img3.shape[-1]
        x3, y3 = _center_offset(dest_h, dest_w, src3_h, src3_w)
        dest = _composite(dest, img3, x3, y3, multiplier=1, resize_source=False)

        out = dest.movedim(1, -1)
        return (out,)


NODE_CLASS_MAPPINGS = {
    "ImageCompositeCenter": ImageCompositeCenter,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageCompositeCenter": "图像中心对齐合成 (ToolBag)",
}
