import asyncio

from aiohttp import web
from server import PromptServer

from .ollama_control import OllamaModelController
from .service_control import ServiceRestartController
from .system_metrics import SystemMetricsCollector


system_metrics_collector = SystemMetricsCollector()
service_restart_controller = ServiceRestartController()
ollama_model_controller = OllamaModelController()


@PromptServer.instance.routes.get("/toolbag/system/metrics")
async def get_system_metrics(request):
    metrics = system_metrics_collector.collect()
    metrics["service_control"] = {
        "restart_supported": service_restart_controller.supported,
        "restart_scheduled": service_restart_controller.scheduled,
    }
    return web.json_response(metrics)


@PromptServer.instance.routes.post("/toolbag/system/restart")
async def restart_comfyui(request):
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "请求必须是 JSON"}, status=400)

    if payload.get("confirm") != "RESTART_COMFYUI":
        return web.json_response({"error": "缺少重启确认"}, status=400)
    if not service_restart_controller.supported:
        return web.json_response(
            {"error": "当前 ComfyUI 不是由受支持的 systemd 服务管理"},
            status=503,
        )

    scheduled = service_restart_controller.schedule(asyncio.get_running_loop())
    return web.json_response(
        {
            "status": "restarting",
            "scheduled": scheduled,
            "retry_after_seconds": 6,
        },
        status=202,
    )


@PromptServer.instance.routes.post("/toolbag/system/unload-models")
async def unload_runtime_models(request):
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "请求必须是 JSON"}, status=400)

    if payload.get("confirm") != "UNLOAD_RUNTIME_MODELS":
        return web.json_response({"error": "缺少模型卸载确认"}, status=400)

    PromptServer.instance.prompt_queue.set_flag("unload_models", True)
    PromptServer.instance.prompt_queue.set_flag("free_memory", True)
    ollama_result = await ollama_model_controller.unload_all()
    return web.json_response(
        {
            "status": "requested",
            "comfyui": {
                "unload_requested": True,
                "free_memory_requested": True,
            },
            "ollama": ollama_result,
        }
    )
