#!/usr/bin/env python3
"""Telegram TGS compatibility checks used by the GIF converter and Vercel API.

Telegram's published limits cover the compressed TGS size, canvas, duration and
frame rate.  A conservative cap for the decompressed Lottie JSON is also used
here: it prevents stickers that are small after gzip but fail to load reliably
in Telegram's TGS pipeline.
"""
from __future__ import annotations

import argparse
import gzip
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

MAX_COMPRESSED_BYTES = 64 * 1024
# Keep a safety margin below the historic one-megabyte TGS parsing boundary.
MAX_UNCOMPRESSED_BYTES = 1_000_000
# The supplied Cammy file works with 998 paths, while files around 1,370 paths
# are rejected by Telegram despite satisfying the published byte limits.
MAX_SHAPE_PATHS = 950
CANVAS_SIZE = 512
FRAME_RATE = 60
MAX_DURATION_SECONDS = 3
MAX_FRAMES = FRAME_RATE * MAX_DURATION_SECONDS

FORBIDDEN_SHAPE_TYPES = {
    "mm": "Merge Paths",
    "rp": "Repeaters",
    "sr": "Star Shapes",
    "gs": "Gradient Strokes",
}
FORBIDDEN_LAYER_TYPES = {
    1: "Solid layers",
    2: "Image layers",
    5: "Text layers",
    9: "Video layers",
}


@dataclass(frozen=True)
class TgsMetadata:
    compressed_bytes: int
    uncompressed_bytes: int
    width: int
    height: int
    fps: float
    frames: int
    duration_seconds: float


def _walk(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def sanitize_animation(animation: Any) -> Any:
    """Remove Lottie constructs Telegram explicitly does not support.

    pixelart2tgs adds an ``mm`` Merge Paths item to every contour group.  For
    the converter's closed, non-overlapping pixel contours this item is
    redundant: the fill and stroke already apply to all paths in the group.
    Removing it preserves the artwork while producing valid Telegram TGS JSON
    and substantially reduces the decompressed payload.
    """
    if isinstance(animation, dict):
        for key, child in tuple(animation.items()):
            animation[key] = sanitize_animation(child)
        return animation
    if isinstance(animation, (list, tuple)):
        return [
            sanitize_animation(item)
            for item in animation
            if not (isinstance(item, dict) and item.get("ty") == "mm")
        ]
    return animation


def _metadata(animation: dict[str, Any], compressed_bytes: int, uncompressed_bytes: int) -> TgsMetadata:
    fps = float(animation.get("fr", 0) or 0)
    start = float(animation.get("ip", 0) or 0)
    end = float(animation.get("op", 0) or 0)
    frames = max(0, round(end - start))
    return TgsMetadata(
        compressed_bytes=compressed_bytes,
        uncompressed_bytes=uncompressed_bytes,
        width=int(animation.get("w", 0) or 0),
        height=int(animation.get("h", 0) or 0),
        fps=fps,
        frames=frames,
        duration_seconds=(frames / fps) if fps > 0 else 0,
    )


def validate_animation(animation: Any, *, compressed_bytes: int = 0, uncompressed_bytes: int | None = None) -> tuple[TgsMetadata, list[str]]:
    """Return metadata and readable Telegram-compatibility errors."""
    errors: list[str] = []
    if not isinstance(animation, dict):
        return TgsMetadata(compressed_bytes, 0, 0, 0, 0, 0, 0), ["TGS content must be a JSON object."]

    if uncompressed_bytes is None:
        raw = json.dumps(animation, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        uncompressed_bytes = len(raw)
    meta = _metadata(animation, compressed_bytes, uncompressed_bytes)

    if meta.width != CANVAS_SIZE or meta.height != CANVAS_SIZE:
        errors.append(f"Canvas must be {CANVAS_SIZE}×{CANVAS_SIZE}px; received {meta.width}×{meta.height}px.")
    if meta.fps != FRAME_RATE:
        errors.append(f"Frame rate must be {FRAME_RATE} FPS; received {meta.fps:g} FPS.")
    if meta.frames < 1:
        errors.append("Animation has no frames.")
    elif meta.frames > MAX_FRAMES:
        errors.append(f"Animation has {meta.frames} frames ({meta.duration_seconds:.2f}s); Telegram permits at most {MAX_FRAMES} frames / {MAX_DURATION_SECONDS}s.")
    if compressed_bytes and compressed_bytes > MAX_COMPRESSED_BYTES:
        errors.append(f"Compressed TGS is {compressed_bytes} bytes; Telegram permits at most {MAX_COMPRESSED_BYTES} bytes.")
    if meta.uncompressed_bytes > MAX_UNCOMPRESSED_BYTES:
        errors.append(
            f"Uncompressed Lottie JSON is {meta.uncompressed_bytes} bytes; safe Telegram compatibility limit is {MAX_UNCOMPRESSED_BYTES} bytes."
        )

    shape_path_count = sum(1 for item in _walk(animation) if item.get("ty") == "sh")
    if shape_path_count > MAX_SHAPE_PATHS:
        errors.append(
            f"Animation contains {shape_path_count} vector paths; safe Telegram compatibility limit is {MAX_SHAPE_PATHS} paths."
        )

    forbidden_counts: dict[str, int] = {}
    for item in _walk(animation):
        shape_type = item.get("ty")
        if shape_type in FORBIDDEN_SHAPE_TYPES:
            forbidden_counts[FORBIDDEN_SHAPE_TYPES[shape_type]] = forbidden_counts.get(FORBIDDEN_SHAPE_TYPES[shape_type], 0) + 1
        if isinstance(shape_type, int) and shape_type in FORBIDDEN_LAYER_TYPES:
            forbidden_counts[FORBIDDEN_LAYER_TYPES[shape_type]] = forbidden_counts.get(FORBIDDEN_LAYER_TYPES[shape_type], 0) + 1
        if item.get("ddd") not in (None, 0):
            forbidden_counts["3D layers"] = forbidden_counts.get("3D layers", 0) + 1
        if item.get("masksProperties") is not None or item.get("hasMask") is True:
            forbidden_counts["Masks"] = forbidden_counts.get("Masks", 0) + 1
        if item.get("ef"):
            forbidden_counts["Layer Effects"] = forbidden_counts.get("Layer Effects", 0) + 1
        if item.get("tm") is not None:
            forbidden_counts["Time Remapping"] = forbidden_counts.get("Time Remapping", 0) + 1
        if item.get("ao") == 1:
            forbidden_counts["Auto-Oriented Layers"] = forbidden_counts.get("Auto-Oriented Layers", 0) + 1
        if isinstance(item.get("x"), str) and item["x"].strip():
            forbidden_counts["Expressions"] = forbidden_counts.get("Expressions", 0) + 1

    for name, count in sorted(forbidden_counts.items()):
        errors.append(f"Telegram does not support {name} (found {count}).")
    return meta, errors


def validate_tgs_file(path: Path) -> tuple[TgsMetadata, list[str]]:
    """Validate a gzip-compressed .tgs file without trusting its extension."""
    compressed = path.read_bytes()
    try:
        raw = gzip.decompress(compressed)
    except (OSError, EOFError) as error:
        return TgsMetadata(len(compressed), 0, 0, 0, 0, 0, 0), [f"TGS is not a readable gzip stream: {error}"]
    try:
        animation = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        return TgsMetadata(len(compressed), len(raw), 0, 0, 0, 0, 0), [f"TGS gzip payload is not valid UTF-8 Lottie JSON: {error}"]
    return validate_animation(animation, compressed_bytes=len(compressed), uncompressed_bytes=len(raw))


def _main() -> int:
    parser = argparse.ArgumentParser(description="Validate or sanitize a Telegram TGS file.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--sanitize", metavar="OUTPUT", type=Path, help="Write a clean TGS with redundant Merge Paths removed.")
    args = parser.parse_args()

    input_data = args.input.read_bytes()
    animation = json.loads(gzip.decompress(input_data).decode("utf-8"))
    if args.sanitize:
        animation = sanitize_animation(animation)
        with gzip.open(args.sanitize, "wb", compresslevel=9) as output:
            output.write(json.dumps(animation, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        print(f"Wrote {args.sanitize}")
        target = args.sanitize
    else:
        target = args.input

    metadata, errors = validate_tgs_file(target)
    print(
        f"compressed={metadata.compressed_bytes} raw={metadata.uncompressed_bytes} "
        f"canvas={metadata.width}x{metadata.height} fps={metadata.fps:g} "
        f"frames={metadata.frames} duration={metadata.duration_seconds:.2f}s"
    )
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print("PASS: Telegram-compatible TGS checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
