#!/usr/bin/env python3
import gzip
import json
import sys

with gzip.open(sys.argv[1], "rb") as source:
    data = json.loads(source.read())
layer = data["layers"][0]
print("layer", json.dumps({key: layer.get(key) for key in ("ddd", "ind", "ip", "op", "st", "ks")}, indent=2))
for index, item in enumerate(layer["shapes"][0]["it"]):
    print("item", index, json.dumps(item, indent=2))
