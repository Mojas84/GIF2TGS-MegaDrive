#!/usr/bin/env python3
"""GIF -> Telegram TGS converter with integer Lottie frame times."""
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


def convert(input_path: Path, output_path: Path) -> None:
    durations, frames = open_gif_file(input_path)
    animation = generate_lottie((durations, frames), "SEGA TGS STUDIO")
    animation = normalize_frame_times(animation)
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
