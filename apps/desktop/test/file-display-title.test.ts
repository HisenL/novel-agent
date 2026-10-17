import { expect, it } from "vitest";
import { fileDisplayTitle } from "../src/renderer/file-display-title.js";

it("shows nested folders without cluttering the standard chapter label", () => {
  expect(
    fileDisplayTitle({
      path: "manuscript/main/chapter-1.md",
      title: "chapter-1",
      kind: "manuscript",
    }),
  ).toBe("chapter-1");
  expect(
    fileDisplayTitle({
      path: "manuscript/imported/第一卷/章节/第一章.md",
      title: "第一章",
      kind: "manuscript",
    }),
  ).toBe("第一卷 / 章节 / 第一章");
  expect(
    fileDisplayTitle({
      path: "canon/imported/资料/人物.yaml",
      title: "人物",
      kind: "canon",
    }),
  ).toBe("资料 / 人物");
});
