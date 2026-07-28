import asyncio
from pathlib import Path
import sys
import time
import unittest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
COMFY_ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(PLUGIN_ROOT), str(COMFY_ROOT)]

import folder_paths
from aiohttp import web

import modelscope_download


class ModelScopeDownloadTest(unittest.TestCase):
    def test_validate_modelscope_url(self):
        url = "https://www.modelscope.cn/models/Comfy-Org/test/resolve/master/model.safetensors"
        self.assertEqual(modelscope_download.validate_modelscope_url(url), url)

        with self.assertRaises(ValueError):
            modelscope_download.validate_modelscope_url(
                "https://huggingface.co/Comfy-Org/test/resolve/main/model.safetensors"
            )

    def test_resolve_target_path_rejects_traversal(self):
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            category = "toolbag_test_models"
            folder_paths.folder_names_and_paths[category] = ([temp_dir], {".safetensors"})
            try:
                resolved_category, target = modelscope_download.resolve_target_path(
                    category, "nested/model.safetensors"
                )
                self.assertEqual(resolved_category, category)
                self.assertEqual(
                    target,
                    Path(temp_dir, "nested", "model.safetensors").resolve(),
                )

                with self.assertRaises(ValueError):
                    modelscope_download.resolve_target_path(
                        category, "../outside/model.safetensors"
                    )
            finally:
                del folder_paths.folder_names_and_paths[category]

    def test_split_ranges_covers_file_without_overlap(self):
        ranges = modelscope_download.split_ranges(10, 3)
        self.assertEqual(ranges, [(0, 3), (4, 7), (8, 9)])

    def test_pause_and_resume(self):
        task_id = "pause-test"
        pause_event = asyncio.Event()
        pause_event.set()
        modelscope_download._downloads[task_id] = {
            "task_id": task_id,
            "status": "running",
            "name": "model.safetensors",
            "path": "model.safetensors",
            "downloaded": 1024,
            "total": 2048,
            "speed": 0,
            "stalled": False,
            "error": None,
            "created_at": time.time(),
            "_last_progress_at": time.monotonic(),
            "_speed_window_started": time.monotonic(),
            "_speed_window_bytes": 0,
            "_pause_event": pause_event,
        }
        try:
            paused = modelscope_download.toggle_pause(task_id)
            self.assertEqual(paused["status"], "paused")
            self.assertFalse(pause_event.is_set())

            resumed = modelscope_download.toggle_pause(task_id)
            self.assertEqual(resumed["status"], "running")
            self.assertTrue(pause_event.is_set())
        finally:
            modelscope_download._downloads.pop(task_id, None)

    def test_stalled_download_reports_zero_speed(self):
        task_id = "stalled-test"
        pause_event = asyncio.Event()
        pause_event.set()
        modelscope_download._downloads[task_id] = {
            "task_id": task_id,
            "status": "running",
            "name": "model.safetensors",
            "path": "model.safetensors",
            "downloaded": 1024,
            "total": 2048,
            "speed": 512,
            "stalled": False,
            "error": None,
            "created_at": time.time(),
            "_last_progress_at": (
                time.monotonic() - modelscope_download.SPEED_STALE_AFTER - 1
            ),
            "_speed_window_started": time.monotonic(),
            "_speed_window_bytes": 0,
            "_pause_event": pause_event,
        }
        try:
            status = modelscope_download.public_status(task_id)
            self.assertTrue(status["stalled"])
            self.assertEqual(status["speed"], 0)
        finally:
            modelscope_download._downloads.pop(task_id, None)

    def test_parallel_download_writes_complete_file(self):
        asyncio.run(self._run_parallel_download_test())

    async def _run_parallel_download_test(self):
        payload = bytes(range(256)) * 2048

        async def serve_file(request):
            range_header = request.headers.get("Range")
            if not range_header:
                return web.Response(
                    body=payload,
                    content_type="application/octet-stream",
                )

            start_text, end_text = range_header.removeprefix("bytes=").split("-")
            start = int(start_text)
            end = int(end_text)
            return web.Response(
                status=206,
                body=payload[start:end + 1],
                headers={"Content-Range": f"bytes {start}-{end}/{len(payload)}"},
                content_type="application/octet-stream",
            )

        app = web.Application()
        app.router.add_get("/model.safetensors", serve_file)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]

        from tempfile import TemporaryDirectory

        task_id = "parallel-test"
        old_part_size = modelscope_download.MIN_PART_SIZE
        try:
            with TemporaryDirectory() as temp_dir:
                target = Path(temp_dir, "model.safetensors")
                modelscope_download.MIN_PART_SIZE = 64 * 1024
                pause_event = asyncio.Event()
                pause_event.set()
                modelscope_download._downloads[task_id] = {
                    "task_id": task_id,
                    "status": "running",
                    "name": target.name,
                    "path": str(target),
                    "downloaded": 0,
                    "total": 0,
                    "speed": 0,
                    "stalled": False,
                    "error": None,
                    "created_at": time.time(),
                    "_last_progress_at": time.monotonic(),
                    "_speed_window_started": time.monotonic(),
                    "_speed_window_bytes": 0,
                    "_pause_event": pause_event,
                }
                await modelscope_download._run_download(
                    task_id,
                    f"http://127.0.0.1:{port}/model.safetensors",
                    "checkpoints",
                    target,
                    None,
                )
                self.assertEqual(
                    modelscope_download._downloads[task_id]["status"],
                    "complete",
                    modelscope_download._downloads[task_id]["error"],
                )
                self.assertEqual(target.read_bytes(), payload)
        finally:
            modelscope_download.MIN_PART_SIZE = old_part_size
            modelscope_download._downloads.pop(task_id, None)
            await runner.cleanup()


if __name__ == "__main__":
    unittest.main()
