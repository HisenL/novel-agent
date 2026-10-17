import { describe, expect, it } from "vitest";
import { resolveAuthoringMode } from "../src/authoring-mode.js";

describe("authoring mode boundary", () => {
  it("keeps legacy turns coauthor and resolves only exact supported modes", () => {
    expect(resolveAuthoringMode(undefined)).toBe("coauthor");
    expect(resolveAuthoringMode("coauthor")).toBe("coauthor");
    expect(resolveAuthoringMode("explore")).toBe("explore");
    expect(resolveAuthoringMode("batch")).toBe("batch");
    for (const mode of ["EXPLORE", "", null, {}, true]) {
      expect(() => resolveAuthoringMode(mode)).toThrow("尚不可用");
    }
  });
});
