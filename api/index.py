from __future__ import annotations

import gzip
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.convert_gif import convert  # noqa: E402

MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_OUTPUT_BYTES = 64 * 1024


def safe_filename(value: str | None) -> str:
    name = os.path.basename(value or "sticker.gif")
    name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in name)
    if not name.lower().endswith(".gif"):
        name += ".gif"
    return name[:-4] + ".tgs"


def json_error(message: str, status: int) -> tuple[int, bytes, str]:
    return status, json.dumps({"error": message}, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8"


class handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-File-Name")
        self.send_header("Access-Control-Expose-Headers", "Content-Disposition, X-TGS-Size, X-TGS-FPS, X-TGS-Frames, X-TGS-Duration, X-TGS-Width, X-TGS-Height")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            self._send_error(*json_error("No GIF payload received.", 400))
            return
        if length > MAX_INPUT_BYTES:
            self._send_error(*json_error("Input rejected: maximum GIF size is 8 MB.", 413))
            return
        body = self.rfile.read(length)
        input_path: str | None = None
        output_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".gif", delete=False) as source:
                source.write(body)
                input_path = source.name
            output_path = tempfile.mktemp(suffix=".tgs")
            convert(Path(input_path), Path(output_path))
            output = Path(output_path).read_bytes()
            if len(output) > MAX_OUTPUT_BYTES:
                raise ValueError(f"TGS output is {(len(output) + 1023) // 1024} KB. Telegram allows a maximum of 64 KB; try a shorter or simpler GIF.")
            animation = json.loads(gzip.decompress(output).decode("utf-8"))
            fps = float(animation.get("fr", 60) or 60)
            frames = max(1, round(float(animation.get("op", 0)) - float(animation.get("ip", 0))))
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/gzip")
            self.send_header("Content-Disposition", f'attachment; filename="{safe_filename(self.headers.get("X-File-Name"))}"')
            self.send_header("Content-Length", str(len(output)))
            self.send_header("X-TGS-Size", str(len(output)))
            self.send_header("X-TGS-FPS", str(int(fps) if fps.is_integer() else fps))
            self.send_header("X-TGS-Frames", str(frames))
            self.send_header("X-TGS-Duration", f"{frames / fps:.2f}")
            self.send_header("X-TGS-Width", str(animation.get("w", 512)))
            self.send_header("X-TGS-Height", str(animation.get("h", 512)))
            self.end_headers()
            self.wfile.write(output)
        except Exception as exc:
            detail = str(exc)
            if "No module named" in detail and "pixelart2tgs" in detail:
                detail = "Python converter is not installed. Check requirements.txt in the deployment."
            elif detail.lower().startswith("file reading error:"):
                detail = "GIF could not be read: " + detail.split(":", 1)[1].strip()
            self._send_error(*json_error(detail or "Conversion failed.", 422))
        finally:
            for path in (input_path, output_path):
                if path:
                    try:
                        os.unlink(path)
                    except FileNotFoundError:
                        pass

    def do_GET(self) -> None:  # noqa: N802
        self._send_error(*json_error("POST a GIF file to convert.", 405))

    def _send_error(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return
