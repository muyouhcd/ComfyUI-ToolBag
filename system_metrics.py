import os
from pathlib import Path
import platform
import socket
import time

import psutil


_PSEUDO_FILESYSTEMS = {
    "autofs",
    "cgroup",
    "cgroup2",
    "configfs",
    "debugfs",
    "devpts",
    "devtmpfs",
    "fusectl",
    "hugetlbfs",
    "mqueue",
    "overlay",
    "proc",
    "pstore",
    "securityfs",
    "squashfs",
    "sysfs",
    "tmpfs",
    "tracefs",
}


def _read_number(path):
    try:
        return int(Path(path).read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _percent(used, total):
    if not total:
        return 0.0
    return round(min(max(used / total * 100, 0.0), 100.0), 1)


def _memory_payload(total, used, available=None, percent=None):
    total = max(int(total or 0), 0)
    used = min(max(int(used or 0), 0), total)
    if available is None:
        available = total - used
    available = min(max(int(available or 0), 0), total)
    return {
        "total": total,
        "used": used,
        "available": available,
        "percent": round(
            float(percent if percent is not None else _percent(used, total)),
            1,
        ),
    }


class SystemMetricsCollector:
    def __init__(self, psutil_module=psutil, drm_root="/sys/class/drm"):
        self.psutil = psutil_module
        self.drm_root = Path(drm_root)
        # The first non-blocking psutil sample has no previous interval.
        self.psutil.cpu_percent(interval=None)

    def _temperature_value(self, value):
        if value is None:
            return None
        value = round(float(value), 1)
        return value if -50 <= value <= 250 else None

    def get_temperatures(self):
        try:
            groups = self.psutil.sensors_temperatures(fahrenheit=False)
        except (AttributeError, OSError):
            return []

        temperatures = []
        for group, sensors in sorted(groups.items()):
            for index, sensor in enumerate(sensors, start=1):
                current = self._temperature_value(sensor.current)
                if current is None:
                    continue
                temperatures.append(
                    {
                        "device": group,
                        "label": sensor.label or f"传感器 {index}",
                        "current": current,
                        "high": self._temperature_value(sensor.high),
                        "critical": self._temperature_value(sensor.critical),
                    }
                )
        return temperatures

    def _gpu_name(self, card_path, device_path):
        product_name = _read_text(device_path / "product_name")
        if product_name:
            return product_name
        vendor = _read_text(device_path / "vendor").lower()
        if vendor == "0x1002":
            return f"AMD GPU ({card_path.name})"
        return f"GPU ({card_path.name})"

    def _gpu_temperature(self, device_path):
        for path in sorted(device_path.glob("hwmon/hwmon*/temp*_input")):
            value = _read_number(path)
            if value is not None:
                return self._temperature_value(value / 1000)
        return None

    def get_gpus(self):
        if not self.drm_root.exists():
            return []

        gpus = []
        seen_devices = set()
        for card_path in sorted(self.drm_root.glob("card[0-9]*")):
            device_path = card_path / "device"
            try:
                resolved_device = str(device_path.resolve(strict=True))
            except OSError:
                continue
            if resolved_device in seen_devices:
                continue
            seen_devices.add(resolved_device)

            vram_total = _read_number(device_path / "mem_info_vram_total")
            vram_used = _read_number(device_path / "mem_info_vram_used")
            if vram_total is None or vram_used is None:
                continue

            gtt_total = _read_number(device_path / "mem_info_gtt_total") or 0
            gtt_used = _read_number(device_path / "mem_info_gtt_used") or 0
            utilization = _read_number(device_path / "gpu_busy_percent")
            try:
                driver = (device_path / "driver").resolve(strict=True).name
            except OSError:
                driver = ""

            gpus.append(
                {
                    "id": card_path.name,
                    "name": self._gpu_name(card_path, device_path),
                    "driver": driver,
                    "utilization_percent": (
                        min(max(utilization, 0), 100)
                        if utilization is not None
                        else None
                    ),
                    "temperature": self._gpu_temperature(device_path),
                    "memory": _memory_payload(vram_total, vram_used),
                    "gtt": _memory_payload(gtt_total, gtt_used),
                }
            )
        return gpus

    def get_disks(self):
        disks = []
        seen_mounts = set()
        try:
            partitions = self.psutil.disk_partitions(all=False)
        except OSError:
            partitions = []

        for partition in partitions:
            if (
                partition.mountpoint in seen_mounts
                or partition.fstype.lower() in _PSEUDO_FILESYSTEMS
            ):
                continue
            seen_mounts.add(partition.mountpoint)
            try:
                usage = self.psutil.disk_usage(partition.mountpoint)
            except (OSError, PermissionError):
                continue
            disks.append(
                {
                    "device": partition.device,
                    "mountpoint": partition.mountpoint,
                    "filesystem": partition.fstype,
                    "total": int(usage.total),
                    "used": int(usage.used),
                    "free": int(usage.free),
                    "percent": round(float(usage.percent), 1),
                }
            )
        return disks

    def collect(self):
        memory = self.psutil.virtual_memory()
        swap = self.psutil.swap_memory()
        try:
            load_average = [round(value, 2) for value in os.getloadavg()]
        except (AttributeError, OSError):
            load_average = []

        return {
            "timestamp": time.time(),
            "hostname": socket.gethostname(),
            "platform": platform.system(),
            "uptime_seconds": max(time.time() - self.psutil.boot_time(), 0),
            "cpu": {
                "percent": round(float(self.psutil.cpu_percent(interval=None)), 1),
                "physical_cores": self.psutil.cpu_count(logical=False),
                "logical_cores": self.psutil.cpu_count(logical=True),
                "load_average": load_average,
            },
            "memory": _memory_payload(
                memory.total,
                memory.used,
                memory.available,
                memory.percent,
            ),
            "swap": _memory_payload(
                swap.total,
                swap.used,
                swap.free,
                swap.percent,
            ),
            "gpus": self.get_gpus(),
            "temperatures": self.get_temperatures(),
            "disks": self.get_disks(),
        }
