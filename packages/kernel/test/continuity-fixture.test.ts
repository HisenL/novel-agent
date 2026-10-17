import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AuthoringKernel } from "../src/index.js";

describe("independent continuity acceptance fixture", () => {
  it("opens all evidence without importing the grading answers or changing the manuscript", () => {
    const source = fileURLToPath(
      new URL("../../../examples/continuity-review/", import.meta.url),
    );
    const root = mkdtempSync(join(tmpdir(), "novel-continuity-fixture-"));
    cpSync(source, root, { recursive: true });
    const path = "manuscript/main/chapter-1.md";
    const before = readFileSync(join(root, path), "utf8");
    const kernel = new AuthoringKernel(root, true);
    try {
      expect(
        kernel.files
          .list()
          .map((file) => file.path)
          .sort(),
      ).toEqual([
        "canon/characters.md",
        "canon/locations.md",
        "manuscript/main/chapter-1.md",
        "outline/author-notes.md",
        "story.yaml",
      ]);
      expect(kernel.files.read(path).content).toBe(before);
      expect(kernel.revisions()).toEqual([]);
      expect(kernel.files.read("canon/characters.md").content).toContain(
        "此前沈遥不知道",
      );
      expect(kernel.files.read("outline/author-notes.md").content).toContain(
        "有意保留的信息",
      );
    } finally {
      kernel.close();
    }
  });
});
