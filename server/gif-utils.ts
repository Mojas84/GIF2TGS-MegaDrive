import path from "path";

export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024;

export function safeFilename(raw?: string) {
  let decoded = "sticker.gif";
  if (raw) {
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
  }
  const base = path.basename(decoded).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.toLowerCase().endsWith(".gif") ? base : `${base}.gif`;
}

export function isInputSizeAllowed(size: number) {
  return Number.isFinite(size) && size > 0 && size <= MAX_INPUT_BYTES;
}
