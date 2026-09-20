#!/usr/bin/env python3
"""GIF -> Telegram TGS converter matching the original Studio serializer."""
import argparse
import math
from numbers import Number
from pathlib import Path

from pixelart2tgs.__main__ import open_gif_file, save_tgs
from pixelart2tgs.lottie_generator import generate_lottie


def normalize_frame_times(value):
    if isinstance(value, dict):
        normalized = {}
        for key, child in value.items():
            if key == "t" and isinstance(child, Number):
                normalized[key] = int(round(child))
            else:
                normalized[key] = normalize_frame_times(child)
        return normalized
    if isinstance(value, (list, tuple)):
        return type(value)(normalize_frame_times(child) for child in value)
    return value


def normalize_integer_floats(value):
    if isinstance(value, dict):
        return {key: normalize_integer_floats(child) for key, child in value.items()}
    if isinstance(value, list):
        return [normalize_integer_floats(child) for child in value]
    if isinstance(value, Number) and not isinstance(value, bool) and float(value).is_integer():
        return int(value)
    return value


def static_property(value, default):
    if value is None:
        return {"a": 0, "k": default}
    if not isinstance(value, dict):
        return value
    value.setdefault("a", 0)
    value.setdefault("k", default)
    return value


def add_z(value, default=0):
    if isinstance(value, dict):
        try:
            vector = list(value["k"])
        except (KeyError, TypeError):
            vector = None
        if vector is not None and len(vector) == 2:
            value["k"] = vector + [default]
    return value


def normalize_tangent(point):
    try:
        if len(point) == 0:
            return [0, 0]
        return list(point) if not isinstance(point, list) else point
    except TypeError:
        return [0, 0]


def enrich_original_lottie_defaults(animation):
    for layer in animation.get("layers", []):
        layer.setdefault("ddd", 0)
        layer.setdefault("ind", 0)
        layer.setdefault("st", 0)
        ks = layer.setdefault("ks", {})
        add_z(ks.get("p"), 0)
        add_z(ks.get("s"), 0)
        static_property(ks.get("p"), [0, 0, 0])
        static_property(ks.get("s"), [100, 100, 0])
        static_property(ks.setdefault("a", {}), [0, 0, 0])
        static_property(ks.setdefault("r", {}), 0)
        static_property(ks.setdefault("o", {}), 100)

        for shape_group in layer.get("shapes", []):
            for item in shape_group.get("it", []):
                kind = item.get("ty")
                if kind == "sh":
                    shape_property = item.setdefault("ks", {})
                    static_property(shape_property, None)
                    points = shape_property.get("k")
                    if isinstance(points, dict):
                        for key in ("i", "o"):
                            values = points.get(key)
                            try:
                                points[key] = [normalize_tangent(point) for point in list(values)]
                            except TypeError:
                                pass
                elif kind == "st":
                    item["c"] = static_property(item.get("c"), [0, 0, 0])
                    item["o"] = static_property(item.get("o"), 100)
                    item["w"] = static_property(item.get("w"), 0)
                elif kind == "fl":
                    item["c"] = static_property(item.get("c"), [1, 1, 1])
                    item["o"] = static_property(item.get("o"), 100)
                elif kind == "tr":
                    item["a"] = static_property(item.setdefault("a", {}), [0, 0])
                    item["s"] = static_property(item.setdefault("s", {}), [100, 100])
                    item["r"] = static_property(item.setdefault("r", {}), 0)
                    item["o"] = static_property(item.get("o"), 100)
    return animation


def convert(input_path: Path, output_path: Path) -> None:
    durations, frames = open_gif_file(input_path)
    animation = generate_lottie((durations, frames), "SEGA TGS STUDIO")
    animation = normalize_frame_times(animation)
    animation = enrich_original_lottie_defaults(animation)
    animation = normalize_integer_floats(animation)
    animation["fr"] = 60
    animation["ip"] = 0
    animation["op"] = max(1, int(math.ceil(float(animation.get("op", 1)))))
    save_tgs(animation, output_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()
    convert(Path(args.input), Path(args.output))


if __name__ == "__main__":
    main()
