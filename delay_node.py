# -*- coding: utf-8 -*-
"""
延迟节点：工作流经过此节点时等待指定时间后继续执行。
"""

import time


class DelayNode:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "passthrough": ("*", {"tooltip": "任意输入，原样透传输出"}),
                "delay_seconds": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 3600.0,
                        "step": 0.1,
                        "tooltip": "等待时间（秒）",
                    },
                ),
            }
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("passthrough",)
    FUNCTION = "delay"
    CATEGORY = "ToolBag/utils"
    DESCRIPTION = "工作流经过此节点时暂停指定秒数，然后将输入原样传递。"

    @classmethod
    def IS_CHANGED(cls, passthrough, delay_seconds):
        return float("nan")

    def delay(self, passthrough, delay_seconds):
        if delay_seconds > 0:
            time.sleep(delay_seconds)
        return (passthrough,)


NODE_CLASS_MAPPINGS = {
    "DelayNode": DelayNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DelayNode": "Delay (ToolBag)",
}
