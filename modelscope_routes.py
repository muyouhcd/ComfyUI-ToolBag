from aiohttp import web
from server import PromptServer

from .modelscope_download import (
    cancel_download,
    inspect_models,
    list_downloads,
    pause_all_downloads,
    public_status,
    start_download,
    toggle_pause,
)


@PromptServer.instance.routes.post("/toolbag/models/missing")
async def inspect_missing_models(request):
    try:
        data = await request.json()
        models = data.get("models", [])
        if not isinstance(models, list):
            raise ValueError("模型列表格式不正确")
        if len(models) > 2000:
            raise ValueError("一次最多检查 2000 个模型")
        return web.json_response(inspect_models(models))
    except (TypeError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.post("/toolbag/modelscope/download")
async def start_modelscope_download(request):
    try:
        data = await request.json()
        result = start_download(
            data.get("url", ""),
            data.get("directory", ""),
            data.get("name", ""),
            data.get("token"),
        )
        return web.json_response(result)
    except (TypeError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.get("/toolbag/modelscope/downloads")
async def get_modelscope_downloads(request):
    return web.json_response(list_downloads())


@PromptServer.instance.routes.post("/toolbag/modelscope/downloads/pause")
async def pause_all_modelscope_downloads(request):
    return web.json_response(pause_all_downloads())


@PromptServer.instance.routes.get("/toolbag/modelscope/download/{task_id}")
async def get_modelscope_download(request):
    status = public_status(request.match_info["task_id"])
    if status is None:
        return web.json_response({"error": "下载任务不存在"}, status=404)
    return web.json_response(status)


@PromptServer.instance.routes.post("/toolbag/modelscope/download/{task_id}/pause")
async def pause_modelscope_download(request):
    try:
        return web.json_response(toggle_pause(request.match_info["task_id"]))
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.delete("/toolbag/modelscope/download/{task_id}")
async def cancel_modelscope_download(request):
    try:
        return web.json_response(
            await cancel_download(request.match_info["task_id"])
        )
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
