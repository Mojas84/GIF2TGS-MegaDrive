#!/usr/bin/env python3
import gzip
import json
import sys
from collections import Counter
from pathlib import Path

path = Path(sys.argv[1])
with gzip.open(path, "rb") as source:
    data = json.loads(source.read())

print("file", path.name)
print("compressed_bytes", path.stat().st_size)
print("top_level_keys", sorted(data.keys()))
print("metadata", {key: data.get(key) for key in ("v", "fr", "ip", "op", "w", "h", "ddd", "nm")})
print("layers", len(data.get("layers", [])))
print("layer_types", Counter(layer.get("ty") for layer in data.get("layers", [])))
print("blend_modes", Counter(layer.get("bm") for layer in data.get("layers", []) if "bm" in layer))
shape_types = []
animated_properties = 0
for layer in data.get("layers", []):
    for shape in layer.get("shapes", []):
        shape_types.append(shape.get("ty"))
        for value in shape.values():
            if isinstance(value, dict) and value.get("a") == 1:
                animated_properties += 1
print("shape_types", Counter(shape_types))
print("animated_properties", animated_properties)
print("assets", len(data.get("assets", [])))
print("markers", len(data.get("markers", [])))
print("has_expressions", "expressions" in json.dumps(data).lower())
