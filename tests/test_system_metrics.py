from collections import namedtuple
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT))

from system_metrics import SystemMetricsCollector


Memory = namedtuple("Memory", "total used available percent")
Swap = namedtuple("Swap", "total used free percent")
Partition = namedtuple("Partition", "device mountpoint fstype opts")
DiskUsage = namedtuple("DiskUsage", "total used free percent")
Temperature = namedtuple("Temperature", "label current high critical")


class FakePsutil:
    def cpu_percent(self, interval=None):
        return 12.5

    def cpu_count(self, logical=True):
        return 32 if logical else 16

    def boot_time(self):
        return 100.0

    def virtual_memory(self):
        return Memory(1000, 400, 600, 40.0)

    def swap_memory(self):
        return Swap(500, 100, 400, 20.0)

    def sensors_temperatures(self, fahrenheit=False):
        return {
            "k10temp": [Temperature("Tctl", 72.25, None, None)],
            "nvme": [Temperature("Sensor 1", 40.0, 65261.85, 65261.85)],
        }

    def disk_partitions(self, all=False):
        return [
            Partition("/dev/root", "/", "ext4", "rw"),
            Partition("tmpfs", "/run", "tmpfs", "rw"),
        ]

    def disk_usage(self, mountpoint):
        return DiskUsage(2000, 500, 1500, 25.0)


def write_number(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(value), encoding="utf-8")


class SystemMetricsCollectorTest(unittest.TestCase):
    def test_collects_memory_temperatures_and_disks(self):
        with TemporaryDirectory() as temp_dir:
            collector = SystemMetricsCollector(FakePsutil(), temp_dir)
            result = collector.collect()

        self.assertEqual(result["cpu"]["percent"], 12.5)
        self.assertEqual(result["memory"]["available"], 600)
        self.assertEqual(result["swap"]["percent"], 20.0)
        self.assertEqual(len(result["disks"]), 1)
        self.assertEqual(result["disks"][0]["free"], 1500)
        self.assertEqual(result["temperatures"][0]["current"], 72.2)
        self.assertIsNone(result["temperatures"][1]["high"])

    def test_reads_amd_gpu_sysfs_metrics(self):
        with TemporaryDirectory() as temp_dir:
            card = Path(temp_dir, "card1")
            device = card / "device"
            device.mkdir(parents=True)
            write_number(device / "mem_info_vram_total", 64 * 1024**3)
            write_number(device / "mem_info_vram_used", 8 * 1024**3)
            write_number(device / "mem_info_gtt_total", 32 * 1024**3)
            write_number(device / "mem_info_gtt_used", 2 * 1024**3)
            write_number(device / "gpu_busy_percent", 38)
            write_number(device / "hwmon/hwmon0/temp1_input", 47500)
            (device / "vendor").write_text("0x1002", encoding="utf-8")

            collector = SystemMetricsCollector(FakePsutil(), temp_dir)
            gpu = collector.get_gpus()[0]

        self.assertEqual(gpu["name"], "AMD GPU (card1)")
        self.assertEqual(gpu["utilization_percent"], 38)
        self.assertEqual(gpu["memory"]["percent"], 12.5)
        self.assertEqual(gpu["gtt"]["used"], 2 * 1024**3)
        self.assertEqual(gpu["temperature"], 47.5)


if __name__ == "__main__":
    unittest.main()
