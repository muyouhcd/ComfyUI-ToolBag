import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
COMFY_ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(PLUGIN_ROOT), str(COMFY_ROOT)]

import folder_paths

from model_usage import ModelUsageManager


class FakeModelFileManager:
    def __init__(self):
        self.cache_cleared = False

    def get_model_file_list(self, folder_name):
        models = []
        for path_index, root in enumerate(folder_paths.get_folder_paths(folder_name)):
            for directory, _, filenames in os.walk(root):
                for filename in filenames:
                    if Path(filename).suffix.lower() not in folder_paths.supported_pt_extensions:
                        continue
                    full_path = os.path.join(directory, filename)
                    models.append(
                        {
                            "name": os.path.relpath(full_path, root),
                            "pathIndex": path_index,
                            "modified": os.path.getmtime(full_path),
                            "created": os.path.getctime(full_path),
                            "size": os.path.getsize(full_path),
                        }
                    )
        return models

    def clear_cache(self):
        self.cache_cleared = True


class ModelUsageManagerTest(unittest.TestCase):
    def test_records_and_sorts_model_usage(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir, "models")
            root.mkdir()
            (root / "used.safetensors").write_bytes(b"used")
            (root / "unused.safetensors").write_bytes(b"unused")
            usage_file = Path(temp_dir, "usage.json")

            with patch.dict(
                folder_paths.folder_names_and_paths,
                {"toolbag_test": ([str(root)], {".safetensors"})},
                clear=True,
            ):
                manager = ModelUsageManager(
                    FakeModelFileManager(),
                    str(usage_file),
                )
                manager.record_prompt(
                    {
                        "1": {
                            "inputs": {
                                "model": "used.safetensors",
                                "models": ["used.safetensors"],
                                "text": "not a model",
                            }
                        }
                    }
                )
                models = manager.get_model_usage_list()

            self.assertEqual(
                [(model["name"], model["usage_count"]) for model in models],
                [("unused.safetensors", 0), ("used.safetensors", 2)],
            )
            self.assertIsNone(models[0]["last_used"])
            self.assertIsNotNone(models[1]["last_used"])
            self.assertTrue(usage_file.exists())

    def test_delete_removes_only_listed_model(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir, "models")
            root.mkdir()
            model = root / "delete-me.safetensors"
            keep = root / "keep.safetensors"
            model.write_bytes(b"delete")
            keep.write_bytes(b"keep")
            file_manager = FakeModelFileManager()

            with patch.dict(
                folder_paths.folder_names_and_paths,
                {"toolbag_test": ([str(root)], {".safetensors"})},
                clear=True,
            ):
                manager = ModelUsageManager(
                    file_manager,
                    str(Path(temp_dir, "usage.json")),
                )
                manager.record_prompt(
                    {"1": {"inputs": {"model": "delete-me.safetensors"}}}
                )
                manager.delete_model(
                    "toolbag_test",
                    0,
                    "delete-me.safetensors",
                )

            self.assertFalse(model.exists())
            self.assertTrue(keep.exists())
            self.assertEqual(manager.get_usage(), {})
            self.assertTrue(file_manager.cache_cleared)

    def test_delete_rejects_path_traversal(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir, "models")
            root.mkdir()
            outside = Path(temp_dir, "outside.safetensors")
            outside.write_bytes(b"keep")

            with patch.dict(
                folder_paths.folder_names_and_paths,
                {"toolbag_test": ([str(root)], {".safetensors"})},
                clear=True,
            ):
                manager = ModelUsageManager(
                    FakeModelFileManager(),
                    str(Path(temp_dir, "usage.json")),
                )
                with self.assertRaises(PermissionError):
                    manager.delete_model(
                        "toolbag_test",
                        0,
                        "../outside.safetensors",
                    )

            self.assertTrue(outside.exists())


if __name__ == "__main__":
    unittest.main()
