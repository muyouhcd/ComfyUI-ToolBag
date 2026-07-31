import os

import aiohttp


class OllamaModelController:
    def __init__(self, base_url=None, timeout_seconds=10):
        configured_url = (
            base_url
            or os.environ.get("TOOLBAG_OLLAMA_URL")
            or os.environ.get("OLLAMA_HOST")
            or "http://127.0.0.1:11434"
        )
        if "://" not in configured_url:
            configured_url = f"http://{configured_url}"
        self.base_url = configured_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    async def unload_all(self):
        result = {
            "available": False,
            "endpoint": self.base_url,
            "loaded": [],
            "unloaded": [],
            "errors": [],
        }
        timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(f"{self.base_url}/api/ps") as response:
                    if response.status != 200:
                        raise RuntimeError(
                            f"Ollama /api/ps returned HTTP {response.status}"
                        )
                    payload = await response.json()

                result["available"] = True
                result["loaded"] = [
                    name
                    for model in payload.get("models", [])
                    if isinstance(model, dict)
                    and isinstance(
                        name := model.get("name") or model.get("model"),
                        str,
                    )
                    and name
                ]

                for model_name in result["loaded"]:
                    try:
                        async with session.post(
                            f"{self.base_url}/api/generate",
                            json={
                                "model": model_name,
                                "keep_alive": 0,
                                "stream": False,
                            },
                        ) as response:
                            if response.status != 200:
                                message = (await response.text()).strip()
                                raise RuntimeError(
                                    f"HTTP {response.status}"
                                    + (f": {message}" if message else "")
                                )
                        result["unloaded"].append(model_name)
                    except Exception as error:
                        result["errors"].append(
                            {"model": model_name, "error": str(error)}
                        )
        except Exception as error:
            result["errors"].append({"model": None, "error": str(error)})

        return result
