import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  linkSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthoringKernel } from "../src/index.js";

describe("author-confirmed root manuscript import", () => {
  it("previews without copying, preserves original bytes and never overwrites a target", () => {
    const root = mkdtempSync(join(tmpdir(), "novel-import-"));
    const source = "\ufeff# 开场\r\n\r\n雨夜。\r\n";
    writeFileSync(join(root, "开场.md"), source);
    writeFileSync(join(root, "人物.yaml"), "name: 林舟\n");
    const kernel = new AuthoringKernel(root, true);
    const preview = kernel.files.rootImportPreview();
    expect(preview.entries).toHaveLength(2);
    expect(preview.entries.every((entry) => !entry.targetExists)).toBe(true);
    expect(kernel.files.read("manuscript/imported/开场.md").hash).toBeNull();
    const selected = preview.entries.map(({ source, sourceHash }) => ({
      source,
      sourceHash,
    }));
    const receipt = kernel.importRootFiles(selected);
    expect(receipt.imported).toHaveLength(2);
    expect(kernel.files.read("manuscript/imported/开场.md").content).toBe(
      source,
    );
    expect(readFileSync(join(root, "开场.md"), "utf8")).toBe(source);
    expect(kernel.revisions()).toHaveLength(2);
    expect(
      kernel.files
        .rootImportPreview()
        .entries.every((entry) => entry.targetExists),
    ).toBe(true);
    expect(kernel.importRootFiles(selected).imported).toHaveLength(0);
    expect(kernel.revisions()).toHaveLength(2);
    const target = "manuscript/imported/开场.md";
    kernel.save(
      target,
      "作者已在副本继续写作。",
      kernel.files.read(target).hash,
    );
    expect(kernel.importRootFiles(selected).imported).toHaveLength(0);
    expect(kernel.files.read(target).content).toBe("作者已在副本继续写作。");
    expect(kernel.revisions()).toHaveLength(3);
    writeFileSync(join(root, "开场.md"), "改变的来源");
    expect(() => kernel.importRootFiles(selected)).toThrow("已改变");
    expect(kernel.files.read("manuscript/imported/开场.md").content).toBe(
      "作者已在副本继续写作。",
    );
    kernel.close();
  });
  it("rejects traversal, runtime resources, invalid UTF-8 and hard links", () => {
    const root = mkdtempSync(join(tmpdir(), "novel-import-invalid-"));
    const kernel = new AuthoringKernel(root, true);
    writeFileSync(join(root, "乱码.md"), Buffer.from([0xff, 0xfe, 0x00]));
    writeFileSync(join(root, "原稿.md"), "正文");
    linkSync(join(root, "原稿.md"), join(root, "链接.md"));
    expect(kernel.files.rootImportPreview().warnings).toHaveLength(3);
    expect(kernel.files.rootImportPreview().entries).toHaveLength(0);
    for (const path of [
      "../outside.md",
      ".novel-agent/config.toml",
      "story.yaml",
      "NOVEL.md",
      "nested/file.md",
    ])
      expect(() => kernel.files.readRootImport(path)).toThrow();
    expect(() => kernel.files.read("原稿.md")).toThrow("只能访问");
    kernel.close();
  });
  it("previews and copies nested author files without changing the source tree", () => {
    const root = mkdtempSync(join(tmpdir(), "novel-nested-import-"));
    mkdirSync(join(root, "第一卷", "章节"), { recursive: true });
    mkdirSync(join(root, "资料"));
    writeFileSync(
      join(root, "第一卷", "章节", "开场.md"),
      "# 开场\n\n原稿。\n",
    );
    writeFileSync(join(root, "资料", "人物.yaml"), "name: 林舟\n");
    const kernel = new AuthoringKernel(root, true);
    const preview = kernel.files.rootImportPreview();
    expect(
      preview.entries.map(({ source, target }) => ({ source, target })),
    ).toEqual([
      {
        source: "第一卷/章节/开场.md",
        target: "manuscript/imported/第一卷/章节/开场.md",
      },
      { source: "资料/人物.yaml", target: "canon/imported/资料/人物.yaml" },
    ]);
    expect(
      kernel.files.read("manuscript/imported/第一卷/章节/开场.md").hash,
    ).toBeNull();
    const receipt = kernel.importRootFiles(
      preview.entries.map(({ source, sourceHash }) => ({ source, sourceHash })),
    );
    expect(receipt.imported).toEqual([
      "manuscript/imported/第一卷/章节/开场.md",
      "canon/imported/资料/人物.yaml",
    ]);
    expect(readFileSync(join(root, "第一卷", "章节", "开场.md"), "utf8")).toBe(
      "# 开场\n\n原稿。\n",
    );
    expect(
      kernel.files.read("manuscript/imported/第一卷/章节/开场.md").content,
    ).toBe("# 开场\n\n原稿。\n");
    expect(kernel.revisions()).toHaveLength(2);
    kernel.close();
  });
  it("excludes managed files and linked nested files from loose import", () => {
    const root = mkdtempSync(join(tmpdir(), "novel-import-boundary-"));
    mkdirSync(join(root, "资料"));
    writeFileSync(join(root, "资料", "原稿.md"), "来源");
    linkSync(join(root, "资料", "原稿.md"), join(root, "资料", "硬链接.md"));
    const kernel = new AuthoringKernel(root, true);
    writeFileSync(join(root, "manuscript", "main", "章.md"), "已在作品中");
    const preview = kernel.files.rootImportPreview();
    expect(preview.entries).toHaveLength(0);
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("资料/原稿.md"),
        expect.stringContaining("资料/硬链接.md"),
      ]),
    );
    for (const source of [
      "资料/../story.yaml",
      "manuscript/main/章.md",
      ".novel-agent/config.toml",
    ])
      expect(() => kernel.files.readRootImport(source)).toThrow();
    kernel.close();
  });
  it("explains when the preview reaches its file count limit", () => {
    const root = mkdtempSync(join(tmpdir(), "novel-import-limit-"));
    for (let index = 0; index < 51; index++)
      writeFileSync(
        join(root, `scene-${String(index).padStart(2, "0")}.md`),
        "正文",
      );
    const kernel = new AuthoringKernel(root, true);
    const preview = kernel.files.rootImportPreview();
    expect(preview.entries).toHaveLength(50);
    expect(preview.warnings).toContain(
      "只显示前 50 个稿件；其他文件或目录未扫描、未导入。",
    );
    kernel.close();
  });
});
