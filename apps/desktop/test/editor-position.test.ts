import { describe, expect, it } from "vitest";
import { restoredCursor } from "../src/renderer/editor-position.js";

describe("editor cursor recovery", () => {
  it("restores a cursor and clamps after external shortening", () => {
    expect(restoredCursor("12", 40)).toBe(12);
    expect(restoredCursor("12", 5)).toBe(5);
    expect(restoredCursor("12", 0)).toBe(0);
  });
  it("ignores missing, malformed and unsafe storage values", () => {
    for (const value of [
      null,
      "",
      "-1",
      "1.5",
      "NaN",
      "{}",
      "1e2",
      "9007199254740992",
    ])
      expect(restoredCursor(value, 100)).toBe(0);
  });
});
