# -*- coding: utf-8 -*-
"""
文件夹图像顺序加载节点
按顺序逐一读取指定文件夹中的所有图像，配合 JS 自动队列实现全自动批处理。
状态（当前索引）完全由 Python 端管理，JS 只负责触发续队。
"""

import numpy as np
import torch
from pathlib import Path
from PIL import Image, ImageOps

SUPPORTED_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif'}

# 按节点 unique_id 保存当前索引：{unique_id: index}
_node_states: dict = {}


def _scan_folder(folder_path: str, recursive: bool = False) -> list:
    p = Path(folder_path)
    if not p.is_dir():
        return []
    glob = p.rglob("*") if recursive else p.iterdir()
    return sorted([
        str(f) for f in glob
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTS
    ])


def _load_image(path: str) -> torch.Tensor:
    """加载图像，处理 EXIF 旋转，返回 [1, H, W, C] float32 0‥1"""
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    img = img.convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


class FolderImageLoader:
    """
    从指定文件夹中按文件名顺序逐一输出图像。

    索引状态由 Python 端通过 unique_id 管理：
    - 每次执行后自动推进到下一张
    - 最后一张执行完后自动重置为 0
    JS 扩展只负责在 has_more=true 时触发下一次 Queue。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {
                    "default": "",
                    "placeholder": "图像文件夹路径，例如 D:/images",
                    "tooltip": "包含图像文件的文件夹路径（支持 jpg/png/webp/bmp/tiff）",
                }),
            },
            "optional": {
                "recursive": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "开启后递归扫描所有子文件夹中的图像",
                }),
                "reset": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "设为 True 可强制从第一张重新开始",
                }),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT", "INT", "BOOLEAN")
    RETURN_NAMES = ("image", "filename", "index", "total", "has_more")
    FUNCTION = "run"
    CATEGORY = "ToolBag/loader"

    @classmethod
    def IS_CHANGED(cls, folder_path, recursive=False, reset=False, unique_id=None):
        return float("nan")

    def run(self, folder_path, recursive=False, reset=False, unique_id=None):
        folder_path = folder_path.strip()
        if not folder_path:
            raise ValueError("请输入文件夹路径")

        images = _scan_folder(folder_path, recursive)
        if not images:
            raise RuntimeError(
                f"未在以下路径找到受支持的图像文件：\n{folder_path}\n"
                f"支持格式：{', '.join(sorted(SUPPORTED_EXTS))}"
            )

        total = len(images)

        # reset=True 或首次运行时从 0 开始
        if reset or unique_id not in _node_states:
            _node_states[unique_id] = 0

        idx = _node_states[unique_id]
        # 防止越界（文件夹内容变化时）
        idx = max(0, min(idx, total - 1))

        img_path = images[idx]
        image = _load_image(img_path)
        filename = Path(img_path).name
        has_more = (idx + 1) < total

        # 推进状态：有更多则指向下一张，否则重置为 0
        _node_states[unique_id] = (idx + 1) if has_more else 0

        return {
            "ui": {
                "has_more": [has_more],
                "index": [idx],
                "total": [total],
                "filename": [filename],
            },
            "result": (image, filename, idx, total, has_more),
        }


NODE_CLASS_MAPPINGS = {
    "FolderImageLoader": FolderImageLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FolderImageLoader": "文件夹图像加载器 (ToolBag)",
}
