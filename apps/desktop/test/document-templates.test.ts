import { describe, expect, it } from "vitest";
import {
  documentTemplates,
  templateContent,
} from "../src/renderer/document-templates.js";

describe("author document templates", () => {
  it("creates editable structures with the author's filename as title", () => {
    expect(templateContent("character", "canon/characters/林舟.md")).toContain(
      "# 林舟\n",
    );
    expect(templateContent("character", "canon/characters/林舟.md")).toContain(
      "尚不知道的信息",
    );
    for (const key of Object.keys(
      documentTemplates,
    ) as (keyof typeof documentTemplates)[])
      expect(templateContent(key, documentTemplates[key].path)).toMatch(/^# /u);
  });
  it("does not put Markdown templates in YAML files", () => {
    expect(templateContent("blank", "canon/data.yaml")).toBe("");
    expect(templateContent("blank", "canon/data.yml")).toBe("");
    expect(() => templateContent("timeline", "canon/timeline.yaml")).toThrow(
      "Markdown",
    );
  });
});
