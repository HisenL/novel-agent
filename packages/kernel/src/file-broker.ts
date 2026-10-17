import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fdatasyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { assertSafeRelativeResourcePath } from "@novel-agent/protocol";
import { zipSync, strToU8 } from "fflate";
import { initializeWorkspace } from "./workspace.js";

export const contentHash = (text: string): string =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
export interface DocumentFile {
  path: string;
  title: string;
  kind: "manuscript" | "outline" | "canon" | "rules";
}
export interface DocumentContent {
  path: string;
  content: string;
  hash: string | null;
}
export interface RootImportEntry {
  source: string;
  target: string;
  sourceHash: string;
  targetExists: boolean;
}
const MAX_BYTES = 1024 * 1024;
const IMPORT_LIMIT = 50;
const IMPORT_SCAN_LIMIT = 2000;
const IMPORT_MAX_DEPTH = 8;
const MANAGED_ROOTS = new Set(["manuscript", "outline", "canon", "skills"]);

/** The only filesystem surface exposed to authoring tools. Runtime files are never tool-visible. */
export class FileBroker {
  readonly root: string;
  readonly workspaceId: string;
  constructor(root: string, create = false) {
    const resolved = resolve(root);
    if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink())
      throw new Error("作品目录不能是符号链接。");
    if (!create && !existsSync(resolved))
      throw new Error(
        "作品文件夹不存在，可能已移动或改名。请重新选择正确的作品文件夹。",
      );
    if (create) mkdirSync(resolved, { recursive: true });
    this.root = realpathSync(resolved);
    this.checkedPath(".novel-agent/config.toml", true);
    if (create) {
      this.checkedPath("manuscript/main", true);
      this.checkedPath("story.yaml");
      initializeWorkspace(this.root);
    }
    const configPath = this.checkedPath(".novel-agent/config.toml", true);
    if (!existsSync(configPath))
      throw new Error(
        "此文件夹还不是作品。请使用“新建 / 导入作品”初始化这个文件夹；当前作品保持打开。",
      );
    const config = readFileSync(configPath, "utf8");
    const id = /^workspace_id\s*=\s*"([a-zA-Z0-9-]+)"/mu.exec(config)?.[1];
    if (!id) throw new Error("此文件夹还不是作品，请选择“导入／新建作品”。");
    this.workspaceId = id;
    for (const dir of [".novel-agent/objects", ".novel-agent/candidates"])
      mkdirSync(this.checkedPath(dir, true), { recursive: true });
  }

  checkedPath(resource: string, internal = false): string {
    assertSafeRelativeResourcePath(resource);
    const segments = resource.split("/");
    for (const segment of segments) {
      if (
        /[<>:"|?*\x00-\x1f]/u.test(segment) ||
        /[. ]$/u.test(segment) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)
      )
        throw new Error("文件名包含不支持的字符。");
    }
    if (
      !internal &&
      !/^(?:story\.yaml|NOVEL\.md|(?:manuscript|outline|canon|skills)\/.+\.(?:md|yaml|yml))$/u.test(
        resource,
      )
    )
      throw new Error("只能访问作品正文、规划、设定和创作规则。");
    let cursor = this.root;
    for (const segment of segments) {
      if (existsSync(cursor)) {
        const caseMatch = readdirSync(cursor).find(
          (name) =>
            name.toLocaleLowerCase("en-US") ===
            segment.toLocaleLowerCase("en-US"),
        );
        if (caseMatch !== undefined && caseMatch !== segment)
          throw new Error("文件路径大小写与已有文件不一致。");
      }
      cursor = join(cursor, segment);
      if (existsSync(cursor)) {
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))
          throw new Error("作品资源不能通过链接访问其他位置。");
      }
    }
    return cursor;
  }

  read(path: string): DocumentContent {
    const file = this.checkedPath(path);
    if (!existsSync(file)) return { path, content: "", hash: null };
    if (!lstatSync(file).isFile() || lstatSync(file).size > MAX_BYTES)
      throw new Error("单个作品文件必须是小于 1 MB 的文本文件。");
    const content = readFileSync(file, "utf8");
    return { path, content, hash: contentHash(content) };
  }

  /** Author-invoked import only. Never exposed as an agent tool. */
  readRootImport(source: string): DocumentContent {
    assertSafeRelativeResourcePath(source);
    const segments = source.split("/");
    if (
      segments.some((segment) => segment.startsWith(".")) ||
      MANAGED_ROOTS.has(segments[0]!.toLocaleLowerCase("en-US")) ||
      (segments.length === 1 && /^(?:story\.yaml|NOVEL\.md)$/iu.test(source)) ||
      segments.length > IMPORT_MAX_DEPTH + 1 ||
      !/\.(?:md|yaml|yml)$/iu.test(source)
    )
      throw new Error("导入来源必须是所选文件夹内的 Markdown/YAML 稿件。");
    const file = this.checkedPath(source, true);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error("导入文件必须小于 1 MB。");
    const content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(readFileSync(file));
    return { path: source, content, hash: contentHash(content) };
  }

  rootImportPreview(): { entries: RootImportEntry[]; warnings: string[] } {
    const entries: RootImportEntry[] = [];
    const warnings: string[] = [];
    const sources: string[] = [];
    let scanned = 0;
    let truncated: "files" | "entries" | null = null;
    const walk = (relative: string, depth: number): void => {
      if (truncated) return;
      for (const entry of readdirSync(
        relative ? this.checkedPath(relative, true) : this.root,
        {
          withFileTypes: true,
        },
      ).sort((a, b) => a.name.localeCompare(b.name))) {
        if (++scanned > IMPORT_SCAN_LIMIT) {
          truncated = "entries";
          return;
        }
        if (entry.name.startsWith(".")) continue;
        const source = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) {
          warnings.push(`${source}：链接不会导入。`);
          continue;
        }
        if (entry.isDirectory()) {
          if (
            !relative &&
            MANAGED_ROOTS.has(entry.name.toLocaleLowerCase("en-US"))
          )
            continue;
          if (depth < IMPORT_MAX_DEPTH) {
            try {
              walk(source, depth + 1);
            } catch {
              warnings.push(`${source}：目录无法安全读取，未扫描。`);
            }
          } else
            warnings.push(
              `${source}：目录层级超过 ${IMPORT_MAX_DEPTH}，未扫描。`,
            );
        } else if (
          /\.(?:md|yaml|yml)$/iu.test(entry.name) &&
          !(relative === "" && /^(?:story\.yaml|NOVEL\.md)$/iu.test(entry.name))
        ) {
          sources.push(source);
          if (sources.length > IMPORT_LIMIT) {
            truncated = "files";
            return;
          }
        }
      }
    };
    walk("", 0);
    if (truncated === "files")
      warnings.push("只显示前 50 个稿件；其他文件或目录未扫描、未导入。");
    if (truncated === "entries")
      warnings.push("文件夹条目超过 2,000 个；后续文件或目录未扫描、未导入。");
    for (const source of sources.slice(0, IMPORT_LIMIT)) {
      try {
        const doc = this.readRootImport(source);
        const name = source.replace(/\.(md|yaml|yml)$/iu, (extension) =>
          extension.toLowerCase(),
        );
        const target = `${/\.md$/iu.test(source) ? "manuscript" : "canon"}/imported/${name}`;
        this.checkedPath(target);
        entries.push({
          source,
          target,
          sourceHash: doc.hash!,
          targetExists: this.read(target).hash !== null,
        });
      } catch {
        warnings.push(`${source}：未导入，请检查编码、大小、文件名或链接。`);
      }
    }
    return { entries, warnings };
  }

  list(): DocumentFile[] {
    const files: DocumentFile[] = [];
    const walk = (relative: string, depth: number): void => {
      if (depth > 8 || files.length >= 1000) return;
      const dir = this.checkedPath(relative, true);
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        if (entry.isSymbolicLink()) continue;
        const path = `${relative}/${entry.name}`;
        if (entry.isDirectory()) walk(path, depth + 1);
        else if (/\.(?:md|yaml|yml)$/u.test(entry.name)) {
          this.checkedPath(path);
          const kind = relative.startsWith("manuscript")
            ? "manuscript"
            : relative.startsWith("outline")
              ? "outline"
              : relative.startsWith("canon")
                ? "canon"
                : "rules";
          files.push({
            path,
            title: entry.name.replace(/\.(?:md|yaml|yml)$/u, ""),
            kind,
          });
        }
      }
    };
    for (const path of ["story.yaml", "NOVEL.md"])
      if (this.read(path).hash !== null)
        files.push({
          path,
          title: path === "story.yaml" ? "创作约定" : "创作规则",
          kind: "rules",
        });
    for (const dir of ["manuscript", "outline", "canon", "skills"])
      walk(dir, 0);
    return files;
  }

  storeObject(content: string): string {
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw new Error("候选正文超过 1 MB 上限。");
    const hash = contentHash(content);
    const target = this.checkedPath(
      `.novel-agent/objects/${hash.slice(7)}.txt`,
      true,
    );
    if (!existsSync(target)) this.durableWrite(target, content);
    return hash;
  }

  object(hash: string): string {
    if (!/^sha256:[a-f0-9]{64}$/u.test(hash))
      throw new Error("版本内容引用无效。");
    const content = readFileSync(
      this.checkedPath(`.novel-agent/objects/${hash.slice(7)}.txt`, true),
      "utf8",
    );
    if (contentHash(content) !== hash)
      throw new Error("版本内容已损坏，已停止恢复。");
    return content;
  }

  prepare(path: string, resultHash: string | null): string {
    const target = this.checkedPath(path);
    mkdirSync(dirname(target), { recursive: true });
    const name = `${path}.novel-agent-${randomUUID()}.tmp`;
    if (resultHash !== null)
      this.durableWrite(this.checkedPath(name, true), this.object(resultHash));
    return name;
  }

  materialize(
    path: string,
    temp: string,
    baseHash: string | null,
    resultHash: string | null,
  ): void {
    if (this.read(path).hash !== baseHash)
      throw new Error("正文已在其他位置修改，请重新检查差异。");
    const source = this.checkedPath(temp, true);
    const destination = this.checkedPath(path);
    if (
      dirname(source) !== dirname(destination) ||
      !basename(source).startsWith(`${basename(destination)}.novel-agent-`)
    )
      throw new Error("发布临时文件不在目标目录。");
    if (resultHash === null) {
      renameSync(destination, source);
      return;
    }
    if (contentHash(readFileSync(source, "utf8")) !== resultHash)
      throw new Error("临时文件内容不匹配。");
    renameSync(source, destination);
  }

  exportZip(): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    let total = 0;
    for (const file of this.list()) {
      const data = strToU8(this.read(file.path).content);
      total += data.length;
      if (total > 30 * MAX_BYTES)
        throw new Error("当前 ZIP 导出上限为 30 MB。");
      entries[file.path] = data;
    }
    return zipSync(entries, { level: 6 });
  }

  private durableWrite(target: string, content: string): void {
    const fd = openSync(target, "wx");
    try {
      writeFileSync(fd, content, "utf8");
      fdatasyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
