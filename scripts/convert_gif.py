#!/usr/bin/env python3
"""GIF -> Telegram TGS converter matching the original Studio serializer."""
import argparse
import math
from numbers import Number
from pathlib import Path

import numpy as np
from PIL import Image
from pixelart2tgs.__main__ import open_gif_file, save_tgs
from pixelart2tgs.lottie_generator import generate_lottie
from scipy import ndimage

try:
    # Import path when called by the Vercel handler from the project root.
    from scripts.tgs_validation import sanitize_animation, validate_animation, validate_tgs_file
except ModuleNotFoundError:
    # Import path when this file is launched directly as a CLI script.
    from tgs_validation import sanitize_animation, validate_animation, validate_tgs_file

MIN_SOURCE_SIDE = 32
# Each size divides the 512px Telegram canvas exactly.  This keeps resized
# pixel-art edges on whole output pixels instead of introducing soft scaling.
PIXEL_GRID_SIDES = (512, 256, 128, 64, 32)
# Prefer a 128px working grid where possible: it maps exactly 4× to Telegram's
# 512px canvas and keeps more pixel detail than a 64px fallback.
DETAIL_GRID_SIDE = 128
# Removing only tiny isolated same-colour islands cuts vector complexity while
# retaining the principal silhouette, palette and pixel-art highlights.
MAX_TINY_COMPONENT_AREA = 4


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


def resize_frame(frame: np.ndarray, maximum_side: int) -> np.ndarray:
    """Downscale pixel art only when necessary, preserving hard pixel edges."""
    height, width = frame.shape[:2]
    scale = min(1.0, maximum_side / max(width, height))
    if scale == 1.0:
        return frame
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return np.asarray(Image.fromarray(frame).resize(size, Image.Resampling.NEAREST))


def candidate_source_sides(frames: list[np.ndarray]):
    """Yield the original and then crisp 512px-compatible pixel grids."""
    original_side = max(max(frame.shape[:2]) for frame in frames)
    yield original_side
    for side in PIXEL_GRID_SIDES:
        if MIN_SOURCE_SIDE <= side < original_side:
            yield side


def pad_frame_to_grid(frame: np.ndarray, grid_side: int) -> np.ndarray:
    """Center a small frame on a square, integer-scale pixel-art grid."""
    height, width = frame.shape[:2]
    if height > grid_side or width > grid_side:
        raise ValueError("The frame does not fit in the requested pixel grid.")
    padded = np.zeros((grid_side, grid_side, 4), dtype=frame.dtype)
    top = (grid_side - height) // 2
    left = (grid_side - width) // 2
    padded[top:top + height, left:left + width] = frame
    return padded


def remove_tiny_components(frame: np.ndarray, maximum_area: int) -> np.ndarray:
    """Discard only isolated colour islands at or below ``maximum_area`` pixels."""
    simplified = frame.copy()
    structure = np.ones((3, 3), dtype=np.uint8)
    for color in np.unique(simplified.reshape(-1, 4), axis=0):
        if color[3] == 0:
            continue
        mask = np.all(simplified == color, axis=2)
        labels, count = ndimage.label(mask, structure=structure)
        if not count:
            continue
        areas = np.bincount(labels.ravel())
        for label, area in enumerate(areas[1:], start=1):
            if area <= maximum_area:
                simplified[labels == label] = (0, 0, 0, 0)
    return simplified


def candidate_frame_sets(frames: list[np.ndarray]):
    """Try full detail, then crisp 128px cleanup, then lower-grid fallbacks."""
    yield frames
    maximum_side = max(max(frame.shape[:2]) for frame in frames)
    if maximum_side <= DETAIL_GRID_SIDE:
        detailed = [pad_frame_to_grid(frame, DETAIL_GRID_SIDE) for frame in frames]
        yield detailed
        for area in range(1, MAX_TINY_COMPONENT_AREA + 1):
            yield [remove_tiny_components(frame, area) for frame in detailed]
    for side in candidate_source_sides(frames):
        if side < maximum_side:
            yield [resize_frame(frame, side) for frame in frames]


def create_animation(durations, frames):
    animation = generate_lottie((durations, frames), "SEGA TGS STUDIO")
    animation = normalize_frame_times(animation)
    animation = enrich_original_lottie_defaults(animation)
    animation = normalize_integer_floats(animation)
    # pixelart2tgs adds one Merge Paths item to every pixel contour group.
    # Telegram's TGS specification rejects Merge Paths, and they are redundant
    # for the converter's closed contours.
    animation = sanitize_animation(animation)
    animation["fr"] = 60
    animation["ip"] = 0
    animation["op"] = max(1, int(math.ceil(float(animation.get("op", 1)))))
    return animation


def convert(input_path: Path, output_path: Path) -> None:
    durations, frames = open_gif_file(input_path)
    last_errors: list[str] = []

    for candidate_frames in candidate_frame_sets(frames):
        animation = create_animation(durations, candidate_frames)
        _, errors = validate_animation(animation)
        if errors:
            last_errors = errors
            continue

        save_tgs(animation, output_path)
        _, errors = validate_tgs_file(output_path)
        if not errors:
            return
        try:
            output_path.unlink()
        except FileNotFoundError:
            pass
        last_errors = errors

    detail = " ".join(last_errors) or "The source GIF could not be converted into a supported TGS animation."
    raise ValueError("Telegram compatibility check failed after pixel-preserving simplification: " + detail)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()
    convert(Path(args.input), Path(args.output))


if __name__ == "__main__":
    main()
