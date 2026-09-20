#!/usr/bin/env python3
import gzip
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
with gzip.open(path, "rb") as source:
    data = json.loads(source.read())

times = []
animated_flags = []
shape_keys = set()

def visit(value):
    if isinstance(value, dict):
        if "t" in value and isinstance(value["t"], (int, float)):
            times.append(value["t"])
        if "a" in value and isinstance(value["a"], (int, float)):
            animated_flags.append(value["a"])
        shape_keys.update(value.keys())
        for child in value.values():
            visit(child)
    elif isinstance(value, list):
        for child in value:
            visit(child)

visit(data)
floats = [item for item in times if isinstance(item, float) and not item.is_integer()]
print(path.name)
print("op", data.get("op"), "time_count", len(times), "fractional_times", len(floats), "sample", floats[:12])
print("animated_flags", sorted(set(animated_flags)))
print("keys", sorted(shape_keys))
