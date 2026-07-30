import logging

from aiohttp import web
from server import PromptServer

from .model_usage import ModelUsageManager


model_usage_manager = ModelUsageManager(
    PromptServer.instance.model_file_manager
)


@PromptServer.instance.routes.get("/toolbag/models/usage")
async def get_model_usage(request):
    return web.json_response(model_usage_manager.get_model_usage_list())


@PromptServer.instance.routes.delete(
    "/toolbag/models/usage/{folder}/{path_index}/{filename:.*}"
)
async def delete_model(request):
    folder_name = request.match_info.get("folder", "")
    filename = request.match_info.get("filename", "")
    try:
        path_index = int(request.match_info.get("path_index", ""))
        model_usage_manager.delete_model(folder_name, path_index, filename)
    except ValueError:
        return web.json_response({"error": "Invalid model path."}, status=400)
    except PermissionError:
        return web.json_response(
            {"error": "Model path is outside its configured folder."},
            status=403,
        )
    except FileNotFoundError:
        return web.json_response({"error": "Model file not found."}, status=404)
    except OSError as error:
        logging.warning("[ToolBag] Unable to delete model %s: %s", filename, error)
        return web.json_response(
            {"error": "Unable to delete model file."},
            status=500,
        )
    return web.json_response({"deleted": True})


def record_model_usage(json_data):
    prompt = json_data.get("prompt")
    if isinstance(prompt, dict):
        model_usage_manager.record_prompt(prompt)
    return json_data


PromptServer.instance.add_on_prompt_handler(record_model_usage)
