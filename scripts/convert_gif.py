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


def static_property(value, default):
    if not isinstance(value, dict):
        return value
    value.setdefault("a", 0)
    value.setdefault("k", default)
    return value


def add_z(value, default=0):
    if isinstance(value, dict) and isinstance(value.get("k"), list) and len(value["k"]) == 2:
        value["k"].append(default)
    return value


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
                    static_property(item.setdefault("ks", {}), None)
                elif kind == "st":
                    static_property(item.get("c"), [0, 0, 0])
                    static_property(item.get("o"), 100)
                    static_property(item.get("w"), 0)
                elif kind == "fl":
                    static_property(item.get("c"), [0, 0, 0])
                    static_property(item.get("o"), 100)
                elif kind == "tr":
                    static_property(item.setdefault("a", {}), [0, 0])
                    static_property(item.setdefault("s", {}), [100, 100])
                    static_property(item.setdefault("r", {}), 0)
    return animation


def convert(input_path: Path, output_path: Path) -> None:
    durations, frames = open_gif_file(input_path)
    animation = generate_lottie((durations, frames), "SEGA TGS STUDIO")
    animation = normalize_frame_times(animation)
    animation = enrich_original_lottie_defaults(animation)
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
