from aiohttp import web
from server import PromptServer

from .system_metrics import SystemMetricsCollector


system_metrics_collector = SystemMetricsCollector()


@PromptServer.instance.routes.get("/toolbag/system/metrics")
async def get_system_metrics(request):
    return web.json_response(system_metrics_collector.collect())
