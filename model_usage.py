import json
import logging
import os
import tempfile
import time
from collections import Counter

import folder_paths


class ModelUsageManager:
    folder_blacklist = {"configs", "custom_nodes"}

    def __init__(self, model_file_manager, usage_file=None):
        self.model_file_manager = model_file_manager
        self.usage_file = usage_file or os.path.join(
            folder_paths.get_system_user_directory("toolbag"),
            "model_usage.json",
        )
        self.usage = None

    def get_model_folders(self):
        return [
            folder
            for folder in folder_paths.folder_names_and_paths
            if folder not in self.folder_blacklist
        ]

    def get_usage(self):
        if self.usage is not None:
            return self.usage
        try:
            with open(self.usage_file, encoding="utf-8") as file:
                usage = json.load(file)
                self.usage = usage if isinstance(usage, dict) else {}
        except FileNotFoundError:
            self.usage = {}
        except (OSError, json.JSONDecodeError) as error:
            logging.warning("[ToolBag] Unable to read model usage data: %s", error)
            self.usage = {}
        return self.usage

    def save_usage(self):
        directory = os.path.dirname(self.usage_file) or "."
        os.makedirs(directory, exist_ok=True)
        temp_file = None
        try:
            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=directory,
                delete=False,
            ) as file:
                temp_file = file.name
                json.dump(
                    self.get_usage(),
                    file,
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            os.replace(temp_file, self.usage_file)
        finally:
            if temp_file and os.path.exists(temp_file):
                os.remove(temp_file)

    @staticmethod
    def usage_key(path):
        return os.path.normcase(os.path.abspath(path))

    def iter_model_files(self):
        seen = set()
        for folder_name in self.get_model_folders():
            roots = folder_paths.get_folder_paths(folder_name)
            for model in self.model_file_manager.get_model_file_list(folder_name):
                path_index = model["pathIndex"]
                if path_index >= len(roots):
                    continue
                full_path = os.path.abspath(
                    os.path.join(roots[path_index], model["name"])
                )
                key = self.usage_key(full_path)
                if key in seen:
                    continue
                seen.add(key)
                yield folder_name, full_path, model

    def get_model_usage_list(self):
        usage = self.get_usage()
        models = []
        for folder_name, full_path, model in self.iter_model_files():
            model_usage = usage.get(self.usage_key(full_path), {})
            models.append(
                {
                    **model,
                    "folder": folder_name,
                    "usage_count": model_usage.get("count", 0),
                    "last_used": model_usage.get("last_used"),
                }
            )
        return sorted(
            models,
            key=lambda model: (
                model["usage_count"],
                model["last_used"] or 0,
                model["name"].lower(),
            ),
        )

    @staticmethod
    def prompt_values(value):
        if isinstance(value, str):
            yield value
        elif isinstance(value, list):
            for item in value:
                yield from ModelUsageManager.prompt_values(item)
        elif isinstance(value, dict):
            for item in value.values():
                yield from ModelUsageManager.prompt_values(item)

    def record_prompt(self, prompt):
        selected = Counter()
        for node in prompt.values():
            if isinstance(node, dict):
                selected.update(self.prompt_values(node.get("inputs", {})))
        selected = Counter(
            {
                filename: count
                for filename, count in selected.items()
                if os.path.splitext(filename)[1].lower()
                in folder_paths.supported_pt_extensions
            }
        )
        if not selected:
            return

        usage = self.get_usage()
        now = int(time.time())
        changed = False
        for filename, count in selected.items():
            matched_paths = set()
            for folder_name in self.get_model_folders():
                for root in folder_paths.get_folder_paths(folder_name):
                    full_path = os.path.normpath(os.path.join(root, filename))
                    if (
                        not folder_paths.is_within_directory(root, full_path)
                        or not os.path.isfile(full_path)
                    ):
                        continue
                    key = self.usage_key(full_path)
                    if key in matched_paths:
                        continue
                    matched_paths.add(key)
                    model_usage = usage.setdefault(
                        key,
                        {"count": 0, "last_used": None},
                    )
                    model_usage["count"] += count
                    model_usage["last_used"] = now
                    changed = True
        if changed:
            try:
                self.save_usage()
            except OSError as error:
                logging.warning(
                    "[ToolBag] Unable to save model usage data: %s",
                    error,
                )

    def delete_model(self, folder_name, path_index, filename):
        if folder_name not in self.get_model_folders():
            raise FileNotFoundError
        roots = folder_paths.get_folder_paths(folder_name)
        if path_index < 0 or path_index >= len(roots) or not filename:
            raise FileNotFoundError

        root = roots[path_index]
        full_path = os.path.normpath(os.path.join(root, filename))
        if not folder_paths.is_within_directory(root, full_path):
            raise PermissionError
        listed = any(
            model["pathIndex"] == path_index and model["name"] == filename
            for model in self.model_file_manager.get_model_file_list(folder_name)
        )
        if not listed or not os.path.isfile(full_path):
            raise FileNotFoundError

        os.remove(full_path)
        self.get_usage().pop(self.usage_key(full_path), None)
        try:
            self.save_usage()
        except OSError as error:
            logging.warning(
                "[ToolBag] Unable to save model usage data: %s",
                error,
            )
        self.model_file_manager.clear_cache()
        folder_paths.filename_list_cache.pop(
            folder_paths.map_legacy(folder_name),
            None,
        )
