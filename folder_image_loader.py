# -*- coding: utf-8 -*-
"""
文件夹图像顺序加载节点
JS 入队时逐张设置 start_index，Python 直接加载对应图像，无需状态追踪。
"""

import numpy as np
import torch
from pathlib import Path
from PIL import Image, ImageOps

SUPPORTED_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif'}


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


# ── API 路由：供 JS 提前查询文件夹图像数量 ──
try:
    from server import PromptServer
    from aiohttp import web

    @PromptServer.instance.routes.get("/toolbag/folder_image_count")
    async def _api_folder_image_count(request):
        path      = request.query.get("path", "").strip()
        recursive = request.query.get("recursive", "false").lower() == "true"
        if not path:
            return web.json_response({"count": 0, "error": "no path"})
        images = _scan_folder(path, recursive)
        return web.json_response({"count": len(images)})
except Exception:
    pass


class FolderImageLoader:
    """
    从指定文件夹中按 start_index 加载单张图像。
    JS 入队前会依次将 start_index 设为 0,1,2,…，
    每个 prompt 的输入不同，ComfyUI 自动重新执行，无需额外状态管理。
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
                "start_index": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 99999,
                    "step": 1,
                    "tooltip": "加载该序号对应的图像（0=第一张）。有连线时由外部控制，自动批量入队失效。",
                }),
                "recursive": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "开启后递归扫描所有子文件夹中的图像",
                }),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT", "INT", "BOOLEAN")
    RETURN_NAMES = ("image", "filename", "index", "total", "has_more")
    FUNCTION = "run"
    CATEGORY = "ToolBag/loader"

    @classmethod
    def IS_CHANGED(cls, folder_path, start_index=0, recursive=False):
        # start_index 每次不同，输入已变化，此处 nan 仅作保底
        return float("nan")

    def run(self, folder_path, start_index=0, recursive=False):
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
        idx   = max(0, min(start_index, total - 1))

        image    = _load_image(images[idx])
        filename = Path(images[idx]).name
        has_more = (idx + 1) < total

        return {
            "ui": {
                "has_more": [has_more],
                "index":    [idx],
                "total":    [total],
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
