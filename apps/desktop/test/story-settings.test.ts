import { describe, it, expect } from "vitest";
import { parseDocument } from "yaml";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StorySettingsDialog } from "../src/renderer/StorySettingsDialog.js";
import {
  readStorySettings,
  writeStorySettings,
  unboundStoryFields,
} from "../src/renderer/story-settings.js";
describe("story settings form", () => {
  it("shows imported fields as a visible warning, not as mapped form values", () => {
    const html = renderToStaticMarkup(
      createElement(StorySettingsDialog, {
        document: {
          path: "story.yaml",
          hash: null,
          content: "title: 测试\npov: 限知\n",
        },
        onSave: async () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("空白表单项不代表没有相关约定");
    expect(html).toContain("pov");
    expect(html).toContain("保存表单不会迁移或删除这些字段");
  });
  it("reports unbound imported rules without guessing mappings or changing bytes", () => {
    const source =
      "schemaVersion: 1\ntitle: 回声证词\npov:\n  rule: 第三人称限知\nworld_rules: [可追溯]\n";
    expect(unboundStoryFields(source)).toEqual(["pov", "world_rules"]);
    const values = readStorySettings(source);
    expect(values.viewpoint).toBe("");
    expect(writeStorySettings(source, values)).toBe(source);
    expect(
      unboundStoryFields("title: 测试\ncreativeBrief:\n  viewpoint: 限知\n"),
    ).toEqual([]);
  });
  const source =
    "# 作者注释\nschemaVersion: 1\ntitle: 旧名\ncustom: [甲, 乙]\ncreativeBrief:\n  customRule: 保留\n";
  it("changes only managed fields and preserves extra content", () => {
    const values = readStorySettings(source);
    values.title = "雨夜档案";
    values.viewpoint = "第三人称限知";
    const result = writeStorySettings(source, values);
    expect(result).toContain("# 作者注释");
    expect(parseDocument(result).toJS().custom).toEqual(["甲", "乙"]);
    expect(result).toContain("customRule: 保留");
    expect(readStorySettings(result).viewpoint).toBe(values.viewpoint);
  });
  it("returns identical bytes when unchanged", () => {
    expect(writeStorySettings(source, readStorySettings(source))).toBe(source);
  });
  it("refuses ambiguous structures instead of silently replacing them", () => {
    for (const source of [
      "title: [甲, 乙]",
      "title: 甲\ncreativeBrief: 不可覆盖",
      "title: [",
      "title: 甲\ntitle: 乙",
    ])
      expect(() => readStorySettings(source)).toThrow();
  });
});
