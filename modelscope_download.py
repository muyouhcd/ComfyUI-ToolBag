import asyncio
import os
import re
import time
import uuid
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

import aiohttp
import folder_paths


MAX_WORKERS = 8
MAX_ACTIVE_DOWNLOADS = 1
MIN_PART_SIZE = 16 * 1024 * 1024
SOCKET_READ_TIMEOUT = 30
SPEED_UPDATE_INTERVAL = 0.5
SPEED_STALE_AFTER = 5
MAX_RANGE_RETRIES = 8
ALLOWED_EXTENSIONS = {
    ".bin",
    ".ckpt",
    ".gguf",
    ".onnx",
    ".pt",
    ".pth",
    ".safetensors",
    ".sft",
}
CONTENT_RANGE_RE = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")

_downloads = {}
_tasks = {}
ACTIVE_STATUSES = {"queued", "running", "paused"}


class DownloadError(RuntimeError):
    pass


class RetryableDownloadError(DownloadError):
    pass


def validate_modelscope_url(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {"modelscope.cn", "www.modelscope.cn"}:
        raise ValueError("仅支持 ModelScope HTTPS 下载地址")
    if parsed.port not in {None, 443}:
        raise ValueError("ModelScope 下载地址端口不合法")

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 6 or parts[0] != "models" or parts[3] != "resolve":
        raise ValueError("不是有效的 ModelScope 模型文件地址")
    return url


def validate_huggingface_url(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "huggingface.co":
        raise ValueError("仅支持 Hugging Face HTTPS 回退地址")
    if parsed.port not in {None, 443}:
        raise ValueError("Hugging Face 下载地址端口不合法")

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 5 or parts[2] != "resolve":
        raise ValueError("不是有效的 Hugging Face 模型文件地址")
    return url


def build_download_sources(url, token=None, fallback_url=None):
    sources = [
        {
            "provider": "ModelScope",
            "url": validate_modelscope_url(url),
            "token": token,
        }
    ]
    if fallback_url:
        sources.append(
            {
                "provider": "Hugging Face",
                "url": validate_huggingface_url(fallback_url),
                "token": None,
            }
        )
    return sources


def resolve_target_path(directory, name):
    directory = folder_paths.map_legacy(directory)
    if directory not in folder_paths.folder_names_and_paths:
        raise ValueError(f"未知模型目录：{directory}")

    normalized_name = name.replace("\\", "/")
    relative = PurePosixPath(normalized_name)
    if relative.is_absolute() or ".." in relative.parts or not relative.name:
        raise ValueError("模型文件名不合法")
    if relative.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise ValueError(f"不支持的模型文件类型：{relative.suffix}")

    root = Path(folder_paths.get_folder_paths(directory)[0]).resolve()
    target = root.joinpath(*relative.parts).resolve()
    if not folder_paths.is_within_directory(str(root), str(target)):
        raise ValueError("模型保存路径超出目标目录")
    return directory, target


def split_ranges(total_size, workers):
    part_size = (total_size + workers - 1) // workers
    ranges = []
    start = 0
    while start < total_size:
        end = min(start + part_size - 1, total_size - 1)
        ranges.append((start, end))
        start = end + 1
    return ranges


def public_status(task_id):
    status = _downloads.get(task_id)
    if status is None:
        return None

    result = {key: value for key, value in status.items() if not key.startswith("_")}
    result["stalled"] = False
    if status["status"] == "queued":
        queued = sorted(
            (
                item
                for item in _downloads.values()
                if item["status"] == "queued"
            ),
            key=lambda item: item["created_at"],
        )
        result["queue_position"] = next(
            (
                index
                for index, item in enumerate(queued, start=1)
                if item["task_id"] == task_id
            ),
            None,
        )
        result["speed"] = 0
    elif status["status"] == "paused":
        result["speed"] = 0
    elif status["status"] == "running":
        if time.monotonic() - status["_last_progress_at"] >= SPEED_STALE_AFTER:
            result["speed"] = 0
            result["stalled"] = True
    return result


def list_downloads():
    latest_by_path = {}
    for task_id, status in sorted(
        _downloads.items(),
        key=lambda item: item[1]["created_at"],
    ):
        latest_by_path[status["path"]] = task_id

    return [
        public_status(task_id)
        for task_id in sorted(
            latest_by_path.values(),
            key=lambda item: _downloads[item]["created_at"],
        )
    ]


def _model_is_installed(directory, name):
    directory = folder_paths.map_legacy(directory)
    if directory not in folder_paths.folder_names_and_paths:
        return False

    normalized_name = name.replace("\\", "/")
    relative = PurePosixPath(normalized_name)
    if relative.is_absolute() or ".." in relative.parts or not relative.name:
        return False

    for root_path in folder_paths.get_folder_paths(directory):
        root = Path(root_path).resolve()
        target = root.joinpath(*relative.parts).resolve()
        if (
            folder_paths.is_within_directory(str(root), str(target))
            and target.is_file()
        ):
            return True
    return False


def inspect_models(models):
    result = []
    for model in models:
        if not isinstance(model, dict):
            continue
        name = model.get("name")
        directory = model.get("directory")
        if not isinstance(name, str) or not name.strip():
            continue
        if not isinstance(directory, str) or not directory.strip():
            result.append(
                {
                    **model,
                    "installed": False,
                    "downloadable": False,
                    "reason": "工作流没有提供模型目录",
                }
            )
            continue
        mapped_directory = folder_paths.map_legacy(directory)
        known_directory = mapped_directory in folder_paths.folder_names_and_paths
        result.append(
            {
                **model,
                "directory": mapped_directory,
                "installed": (
                    _model_is_installed(mapped_directory, name)
                    if known_directory
                    else False
                ),
                "downloadable": known_directory,
                "reason": None if known_directory else "未知模型目录",
            }
        )
    return result


def _has_active_slot():
    active = sum(
        1
        for status in _downloads.values()
        if status.get("_started")
        and status["status"] in {"running", "paused"}
    )
    return active < MAX_ACTIVE_DOWNLOADS


def _schedule_downloads():
    while _has_active_slot():
        queued = min(
            (
                status
                for status in _downloads.values()
                if status["status"] == "queued"
            ),
            key=lambda status: status["created_at"],
            default=None,
        )
        if queued is None:
            return
        task_id = queued["task_id"]
        queued["status"] = "running"
        queued["_started"] = True
        queued["_last_progress_at"] = time.monotonic()
        queued["_speed_window_started"] = time.monotonic()
        queued["_pause_event"].set()
        _tasks[task_id] = asyncio.create_task(
            _run_download(
                task_id,
                queued["_sources"],
                queued["_directory"],
                queued["_target"],
            )
        )


def _prune_downloads():
    completed = [
        (task_id, status)
        for task_id, status in _downloads.items()
        if status["status"] not in ACTIVE_STATUSES
    ]
    completed.sort(key=lambda item: item[1]["created_at"])
    for task_id, _status in completed[:-50]:
        _downloads.pop(task_id, None)
        _tasks.pop(task_id, None)


def _validate_download_response(response, provider):
    content_type = response.headers.get("Content-Type", "").lower()
    if content_type.startswith("text/html") or "json" in content_type:
        raise DownloadError(f"{provider} 返回了登录页或错误信息，请检查登录授权")


def _record_progress(status, size):
    now = time.monotonic()
    status["downloaded"] += size
    status["_speed_window_bytes"] += size
    status["_last_progress_at"] = now

    elapsed = now - status["_speed_window_started"]
    if elapsed >= SPEED_UPDATE_INTERVAL:
        status["speed"] = int(status["_speed_window_bytes"] / elapsed)
        status["_speed_window_bytes"] = 0
        status["_speed_window_started"] = now


async def _probe_file(session, url, provider):
    headers = {"Range": "bytes=0-0", "Accept-Encoding": "identity"}
    async with session.get(url, headers=headers) as response:
        if response.status in {401, 403, 451}:
            raise DownloadError(f"模型需要登录或授权，请先在 {provider} 完成登录和模型授权")
        if response.status not in {200, 206}:
            raise DownloadError(f"{provider} 返回 HTTP {response.status}")
        _validate_download_response(response, provider)

        content_range = response.headers.get("Content-Range")
        if response.status == 206 and content_range:
            match = CONTENT_RANGE_RE.match(content_range)
            if not match:
                raise DownloadError(f"{provider} 返回了无效的分段信息")
            total_size = int(match.group(3))
            return total_size, True

        content_length = response.headers.get("Content-Length")
        if not content_length:
            raise DownloadError("无法获取模型文件大小")
        return int(content_length), False


async def _download_range(session, url, temp_path, start, end, status, provider):
    positions = status.setdefault("_range_positions", {})
    position = positions.get(start, start)
    failures = 0
    with temp_path.open("r+b", buffering=0) as output:
        output.seek(position)
        while position <= end:
            await status["_pause_event"].wait()
            request_start = position
            headers = {
                "Range": f"bytes={position}-{end}",
                "Accept-Encoding": "identity",
            }
            try:
                async with session.get(url, headers=headers) as response:
                    if response.status != 206:
                        if response.status in {408, 425, 429, 500, 502, 503, 504}:
                            raise RetryableDownloadError(
                                f"分段下载暂时失败：HTTP {response.status}"
                            )
                        raise DownloadError(f"分段下载失败：HTTP {response.status}")
                    _validate_download_response(response, provider)

                    async for chunk in response.content.iter_chunked(1024 * 1024):
                        await status["_pause_event"].wait()
                        await asyncio.to_thread(output.write, chunk)
                        position += len(chunk)
                        positions[start] = position
                        _record_progress(status, len(chunk))
                if position <= end:
                    raise aiohttp.ClientPayloadError("分段连接提前结束")
            except (aiohttp.ClientError, RetryableDownloadError) as error:
                failures = 0 if position > request_start else failures + 1
                if failures > MAX_RANGE_RETRIES:
                    raise DownloadError(f"分段多次重连失败：{error}") from error
                await status["_pause_event"].wait()
                await asyncio.sleep(min(2 ** max(failures - 1, 0), 8))

    expected_end = end + 1
    if position != expected_end:
        raise DownloadError(f"分段大小不匹配：预期结束于 {expected_end}，实际 {position}")


async def _download_single(session, url, temp_path, status, provider):
    async with session.get(url, headers={"Accept-Encoding": "identity"}) as response:
        if response.status != 200:
            raise DownloadError(f"下载失败：HTTP {response.status}")
        _validate_download_response(response, provider)

        with temp_path.open("wb", buffering=0) as output:
            async for chunk in response.content.iter_chunked(1024 * 1024):
                await status["_pause_event"].wait()
                await asyncio.to_thread(output.write, chunk)
                _record_progress(status, len(chunk))


async def _attempt_download(source, temp_path, status):
    provider = source["provider"]
    timeout = aiohttp.ClientTimeout(
        total=None,
        connect=30,
        sock_read=SOCKET_READ_TIMEOUT,
    )
    headers = {"User-Agent": "ComfyUI-ToolBag/ModelDownloader"}
    if source.get("token"):
        headers["Authorization"] = f"Bearer {source['token']}"

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        total_size, supports_ranges = await _probe_file(
            session,
            source["url"],
            provider,
        )
        workers = min(
            MAX_WORKERS,
            max(1, (total_size + MIN_PART_SIZE - 1) // MIN_PART_SIZE),
        )
        ranges = split_ranges(total_size, workers)
        can_resume_ranges = (
            supports_ranges
            and workers > 1
            and temp_path.is_file()
            and status.get("_range_total") == total_size
        )

        status["total"] = total_size
        status["provider"] = provider
        if supports_ranges and workers > 1:
            if not can_resume_ranges:
                with temp_path.open("wb") as output:
                    output.truncate(total_size)
                status["_range_positions"] = {
                    start: start for start, _end in ranges
                }
                status["_range_total"] = total_size
                status["downloaded"] = 0
            else:
                positions = status.setdefault("_range_positions", {})
                status["downloaded"] = sum(
                    max(0, min(positions.get(start, start), end + 1) - start)
                    for start, end in ranges
                )

            range_tasks = [
                asyncio.create_task(
                    _download_range(
                        session,
                        source["url"],
                        temp_path,
                        start,
                        end,
                        status,
                        provider,
                    )
                )
                for start, end in ranges
                if status["_range_positions"].get(start, start) <= end
            ]
            try:
                await asyncio.gather(*range_tasks)
            except BaseException:
                for task in range_tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*range_tasks, return_exceptions=True)
                raise
        else:
            status["downloaded"] = 0
            status.pop("_range_positions", None)
            status.pop("_range_total", None)
            await _download_single(
                session,
                source["url"],
                temp_path,
                status,
                provider,
            )

    if temp_path.stat().st_size != total_size:
        raise DownloadError("下载完成后的文件大小不匹配")
    return total_size


async def _run_download(task_id, sources, directory, target):
    status = _downloads[task_id]
    temp_path = target.with_name(f".{target.name}.toolbag.part")
    errors = []

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        temp_path.unlink(missing_ok=True)

        total_size = 0
        for index, source in enumerate(sources):
            status.update({
                "provider": source["provider"],
                "fallback_used": index > 0,
                "fallback_reason": errors[-1] if errors else None,
                "error": None,
                "speed": 0,
                "stalled": False,
            })
            now = time.monotonic()
            status["_last_progress_at"] = now
            status["_speed_window_started"] = now
            status["_speed_window_bytes"] = 0
            try:
                total_size = await _attempt_download(source, temp_path, status)
                break
            except asyncio.CancelledError:
                raise
            except Exception as error:
                errors.append(f"{source['provider']}：{error}")
        else:
            raise DownloadError("；".join(errors))

        os.replace(temp_path, target)
        folder_paths.filename_list_cache.pop(directory, None)
        status.update({
            "status": "complete",
            "downloaded": total_size,
            "path": str(target),
            "error": None,
        })
    except asyncio.CancelledError:
        temp_path.unlink(missing_ok=True)
        status.update({
            "status": "canceled",
            "downloaded": 0,
            "total": 0,
            "speed": 0,
            "stalled": False,
            "error": None,
        })
        raise
    except Exception as error:
        temp_path.unlink(missing_ok=True)
        status.update({
            "status": "error",
            "error": str(error),
        })
    finally:
        status["_started"] = False
        _tasks.pop(task_id, None)
        _schedule_downloads()


def start_download(url, directory, name, token=None, fallback_url=None):
    sources = build_download_sources(url, token, fallback_url)
    directory, target = resolve_target_path(directory, name)

    if target.is_file():
        return {
            "status": "complete",
            "existing": True,
            "path": str(target),
            "name": name,
        }

    for task_id, status in _downloads.items():
        if status["status"] in ACTIVE_STATUSES and status["path"] == str(target):
            return {"task_id": task_id, **public_status(task_id)}

    _prune_downloads()
    task_id = uuid.uuid4().hex
    _downloads[task_id] = {
        "task_id": task_id,
        "status": "queued",
        "name": name,
        "path": str(target),
        "downloaded": 0,
        "total": 0,
        "speed": 0,
        "stalled": False,
        "error": None,
        "provider": sources[0]["provider"],
        "fallback_used": False,
        "fallback_reason": None,
        "created_at": time.time(),
        "_last_progress_at": time.monotonic(),
        "_speed_window_started": time.monotonic(),
        "_speed_window_bytes": 0,
        "_pause_event": asyncio.Event(),
        "_started": False,
        "_sources": sources,
        "_directory": directory,
        "_target": target,
    }
    _downloads[task_id]["_pause_event"].set()
    _schedule_downloads()
    return public_status(task_id)


def toggle_pause(task_id):
    status = _downloads.get(task_id)
    if status is None:
        raise ValueError("下载任务不存在")

    if status["status"] == "queued":
        status["status"] = "paused"
        status["speed"] = 0
    elif status["status"] == "running":
        status["_started"] = status.get("_started", True)
        status["_pause_event"].clear()
        status["status"] = "paused"
        status["speed"] = 0
    elif status["status"] == "paused":
        if status.get("_started"):
            now = time.monotonic()
            status["_last_progress_at"] = now
            status["_speed_window_started"] = now
            status["_speed_window_bytes"] = 0
            status["_pause_event"].set()
            status["status"] = "running"
        else:
            status["status"] = "queued"
            _schedule_downloads()
    else:
        raise ValueError("当前下载任务不能暂停或继续")
    return public_status(task_id)


def pause_all_downloads():
    paused_count = 0
    for status in _downloads.values():
        if status["status"] == "queued":
            status["status"] = "paused"
            status["speed"] = 0
            paused_count += 1
        elif status["status"] == "running":
            status["_started"] = status.get("_started", True)
            status["_pause_event"].clear()
            status["status"] = "paused"
            status["speed"] = 0
            paused_count += 1

    return {
        "paused_count": paused_count,
        "downloads": list_downloads(),
    }


async def cancel_download(task_id):
    status = _downloads.get(task_id)
    if status is None:
        raise ValueError("下载任务不存在")
    if status["status"] not in ACTIVE_STATUSES:
        raise ValueError("当前下载任务不能取消")

    status["_pause_event"].set()
    task = _tasks.get(task_id)
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    else:
        target = status.get("_target")
        if target is not None:
            Path(target).with_name(
                f".{Path(target).name}.toolbag.part"
            ).unlink(missing_ok=True)
        status.update(
            {
                "status": "canceled",
                "downloaded": 0,
                "total": 0,
                "speed": 0,
                "stalled": False,
                "error": None,
            }
        )
        _schedule_downloads()
    return public_status(task_id)
