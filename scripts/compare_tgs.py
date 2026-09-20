#!/usr/bin/env python3
import gzip
import json
import sys
from collections import Counter
from pathlib import Path


def load(path):
    with gzip.open(path, "rb") as source:
        return json.loads(source.read())


def key_paths(value, path="root"):
    result = Counter()
    if isinstance(value, dict):
        for key, child in value.items():
            result[path + "." + key] += 1
            result.update(key_paths(child, path + "." + key))
    elif isinstance(value, list):
        for index, child in enumerate(value[:3]):
            result.update(key_paths(child, path + f"[{index}]"))
    return result

reference = load(Path(sys.argv[1]))
current = load(Path(sys.argv[2]))
print("top_only_reference", sorted(set(reference) - set(current)))
print("top_only_current", sorted(set(current) - set(reference)))
ref_keys = key_paths(reference)
cur_keys = key_paths(current)
print("paths_only_reference", [key for key in sorted(ref_keys) if key not in cur_keys][:80])
print("paths_only_current", [key for key in sorted(cur_keys) if key not in ref_keys][:80])
for label, data in (("reference", reference), ("current", current)):
    layer = data["layers"][0]
    print(label, "layer_keys", sorted(layer.keys()))
    print(label, "first_shape_item_keys", [sorted(item.keys()) for item in layer["shapes"][0]["it"]])
