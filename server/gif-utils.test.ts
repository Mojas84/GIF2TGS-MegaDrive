import { describe, expect, it } from "vitest";
import { isInputSizeAllowed, MAX_INPUT_BYTES, safeFilename } from "./gif-utils";

describe("GIF upload validation", () => {
  it("normalizes a user filename without allowing path traversal", () => {
    expect(safeFilename("my sticker.gif")).toBe("my_sticker.gif");
    expect(safeFilename("..%2F..%2Fsecret.gif")).toBe("secret.gif");
    expect(safeFilename("animation")).toBe("animation.gif");
  });

  it("accepts non-empty GIFs up to the 8 MB input limit", () => {
    expect(isInputSizeAllowed(1)).toBe(true);
    expect(isInputSizeAllowed(MAX_INPUT_BYTES)).toBe(true);
    expect(isInputSizeAllowed(0)).toBe(false);
    expect(isInputSizeAllowed(MAX_INPUT_BYTES + 1)).toBe(false);
    expect(isInputSizeAllowed(Number.NaN)).toBe(false);
  });
});
