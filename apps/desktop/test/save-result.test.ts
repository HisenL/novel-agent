import { describe, expect, it } from "vitest";
import type { DocumentContent } from "@novel-agent/kernel";
import { applySavedDocument } from "../src/renderer/save-result.js";

describe("late save acknowledgements", () => {
  const submitted: DocumentContent = {
    path: "manuscript/chapter.md",
    content: "旧稿",
    hash: "old",
  };
  const saved: DocumentContent = { ...submitted, content: "新稿", hash: "new" };

  it("updates the saved base for the original editor without changing draft text", () => {
    expect(applySavedDocument(submitted, submitted, saved)).toBe(saved);
  });

  it("does not replace another chapter, a reopened snapshot or an empty workspace", () => {
    const other = { ...submitted, path: "manuscript/other.md" };
    const reopened = { ...submitted };
    expect(applySavedDocument(other, submitted, saved)).toBe(other);
    expect(applySavedDocument(reopened, submitted, saved)).toBe(reopened);
    expect(applySavedDocument(null, submitted, saved)).toBeNull();
  });
});
