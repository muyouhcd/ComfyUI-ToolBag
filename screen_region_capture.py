#! -*- coding: utf-8 -*-
"""
屏幕指定区域截取为 IMAGE 的节点。
- 支持选择屏幕（多显示器）
- 支持在屏幕上拖拽框选区域
- 也可以手动输入 left/top/width/height
"""

import torch
import numpy as np
from PIL import Image
from comfy.comfy_types import InputTypeDict

try:
    import mss  # type: ignore
except ImportError as e:  # pragma: no cover - 环境缺少依赖时的友好提示
    mss = None
    _mss_import_error = e
else:
    _mss_import_error = None


_LAST_SCREEN_REGION = None  # (monitor_index, left, top, width, height)


class ScreenRegionCapture:
    """
    从指定屏幕的指定区域截取一帧图像作为 IMAGE 输出。
    - 支持选择屏幕（多显示器）
    - 支持在屏幕上拖拽框选区域
    - 也可以手动输入 left/top/width/height
    """

    @classmethod
    def INPUT_TYPES(cls) -> InputTypeDict:
        return {
            "required": {
                "action": (
                    ["capture", "select_region_and_capture"],
                    {
                        "default": "select_region_and_capture",
                        "tooltip": "capture: 使用已有区域或手动参数\n"
                        "select_region_and_capture: 弹出窗口在屏幕上框选区域后截取",
                    },
                ),
                "monitor_index": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 16,
                        "tooltip": "多显示器时的屏幕编号（1 = 第一个）",
                    },
                ),
                "left": (
                    "INT",
                    {
                        "default": 0,
                        "min": -10000,
                        "max": 10000,
                        "tooltip": "区域左上角 X（相对所选屏幕）",
                    },
                ),
                "top": (
                    "INT",
                    {
                        "default": 0,
                        "min": -10000,
                        "max": 10000,
                        "tooltip": "区域左上角 Y（相对所选屏幕）",
                    },
                ),
                "width": (
                    "INT",
                    {
                        "default": 640,
                        "min": 1,
                        "max": 10000,
                        "tooltip": "区域宽度",
                    },
                ),
                "height": (
                    "INT",
                    {
                        "default": 360,
                        "min": 1,
                        "max": 10000,
                        "tooltip": "区域高度",
                    },
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "capture_region"
    CATEGORY = "ToolBag/image"

    def _ensure_mss(self):
        if mss is None:
            raise RuntimeError(
                "ScreenRegionCapture 节点需要安装 mss 库：pip install mss\n"
                f"原始错误: {_mss_import_error}"
            )

    def _select_region_with_tk(self, monitor_index: int):
        import tkinter as tk

        self._ensure_mss()
        with mss.mss() as sct:
            monitors = sct.monitors
        if monitor_index < 1 or monitor_index >= len(monitors):
            raise ValueError(
                f"monitor_index 超出范围: {monitor_index}, 当前共有 {len(monitors) - 1} 个屏幕"
            )

        mon = monitors[monitor_index]
        x, y = mon["left"], mon["top"]
        w, h = mon["width"], mon["height"]

        root = tk.Tk()
        root.withdraw()  # 隐藏主窗口

        overlay = tk.Toplevel(root)
        overlay.attributes("-topmost", True)
        overlay.attributes("-alpha", 0.3)
        overlay.overrideredirect(True)
        overlay.geometry(f"{w}x{h}+{x}+{y}")

        canvas = tk.Canvas(overlay, bg="black")
        canvas.pack(fill="both", expand=True)

        start = {"x": 0, "y": 0}
        rect = {"id": None}

        def to_global(ex, ey):
            return x + ex, y + ey

        def on_press(event):
            start["x"], start["y"] = event.x, event.y
            if rect["id"] is not None:
                canvas.delete(rect["id"])
            rect["id"] = canvas.create_rectangle(
                start["x"], start["y"], start["x"], start["y"], outline="red", width=2
            )

        def on_move(event):
            if rect["id"] is None:
                return
            canvas.coords(rect["id"], start["x"], start["y"], event.x, event.y)

        result = {}

        def on_release(event):
            if rect["id"] is None:
                return
            x1, y1, x2, y2 = canvas.coords(rect["id"])
            left_rel, top_rel = min(x1, x2), min(y1, y2)
            right_rel, bottom_rel = max(x1, x2), max(y1, y2)
            left_g, top_g = to_global(left_rel, top_rel)
            right_g, bottom_g = to_global(right_rel, bottom_rel)
            width = int(max(1, right_g - left_g))
            height = int(max(1, bottom_g - top_g))

            result["left"] = int(left_g - x)
            result["top"] = int(top_g - y)
            result["width"] = width
            result["height"] = height

            overlay.destroy()
            root.quit()

        canvas.bind("<ButtonPress-1>", on_press)
        canvas.bind("<B1-Motion>", on_move)
        canvas.bind("<ButtonRelease-1>", on_release)

        root.mainloop()
        root.destroy()

        if not result:
            raise RuntimeError("未选择任何区域")

        return (
            monitor_index,
            result["left"],
            result["top"],
            result["width"],
            result["height"],
        )

    def capture_region(self, action, monitor_index, left, top, width, height):
        global _LAST_SCREEN_REGION

        self._ensure_mss()

        if action == "select_region_and_capture":
            _LAST_SCREEN_REGION = self._select_region_with_tk(monitor_index)
        elif _LAST_SCREEN_REGION is None:
            _LAST_SCREEN_REGION = (monitor_index, left, top, width, height)

        mon_idx, l, t, w, h = _LAST_SCREEN_REGION

        with mss.mss() as sct:
            monitors = sct.monitors
            if mon_idx < 1 or mon_idx >= len(monitors):
                raise ValueError(f"保存的 monitor_index 超出范围: {mon_idx}")
            mon = monitors[mon_idx]

            region = {
                "left": mon["left"] + int(l),
                "top": mon["top"] + int(t),
                "width": int(w),
                "height": int(h),
            }

            shot = sct.grab(region)

        img = Image.frombytes("RGB", shot.size, shot.rgb)  # PIL 图像
        np_img = np.array(img).astype(np.float32) / 255.0  # (H, W, C)

        # 转成 ComfyUI IMAGE 格式: (B, H, W, C)
        tensor = torch.from_numpy(np_img)[None, ...]
        return (tensor,)


NODE_CLASS_MAPPINGS = {
    "ScreenRegionCapture": ScreenRegionCapture,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ScreenRegionCapture": "屏幕区域截取为图像 (ToolBag)",
}

