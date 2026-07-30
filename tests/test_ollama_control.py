from pathlib import Path
import sys
import unittest

from aiohttp import web

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT))

from ollama_control import OllamaModelController


class OllamaModelControllerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.generate_requests = []
        app = web.Application()
        app.router.add_get("/api/ps", self._list_models)
        app.router.add_post("/api/generate", self._generate)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await self.site.start()
        port = self.site._server.sockets[0].getsockname()[1]
        self.controller = OllamaModelController(
            f"http://127.0.0.1:{port}",
            timeout_seconds=2,
        )

    async def asyncTearDown(self):
        await self.runner.cleanup()

    async def _list_models(self, request):
        return web.json_response(
            {
                "models": [
                    {"name": "qwen3:latest"},
                    {"model": "gemma3:4b"},
                ]
            }
        )

    async def _generate(self, request):
        self.generate_requests.append(await request.json())
        return web.json_response({"done": True})

    async def test_unload_all_uses_zero_keep_alive(self):
        result = await self.controller.unload_all()

        self.assertTrue(result["available"])
        self.assertEqual(result["loaded"], ["qwen3:latest", "gemma3:4b"])
        self.assertEqual(result["unloaded"], result["loaded"])
        self.assertEqual(result["errors"], [])
        self.assertEqual(
            self.generate_requests,
            [
                {
                    "model": "qwen3:latest",
                    "keep_alive": 0,
                    "stream": False,
                },
                {
                    "model": "gemma3:4b",
                    "keep_alive": 0,
                    "stream": False,
                },
            ],
        )
