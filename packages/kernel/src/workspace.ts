import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fdatasyncSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { assertSafeRelativeResourcePath } from "@novel-agent/protocol";

export interface WorkspaceInfo {
  readonly root: string;
  readonly workspaceId: string;
}

export function hashContent(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function resolveInside(root: string, resourcePath: string): string {
  assertSafeRelativeResourcePath(resourcePath);
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, ...resourcePath.split("/"));
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`Resource escapes workspace: ${resourcePath}`);
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(
      `Symbolic-link resource is not accessible: ${resourcePath}`,
    );
  }
  let cursor = dirname(target);
  while (cursor.startsWith(absoluteRoot) && cursor !== absoluteRoot) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Symbolic-link parent is not writable: ${resourcePath}`);
    }
    cursor = dirname(cursor);
  }
  return target;
}

function configText(workspaceId: string): string {
  return `schema_version = 1\nworkspace_id = "${workspaceId}"\nprovider = "mock"\n`;
}

export function initializeWorkspace(root: string): WorkspaceInfo {
  const absoluteRoot = resolve(root);
  mkdirSync(resolve(absoluteRoot, ".novel-agent", "candidates"), {
    recursive: true,
  });
  mkdirSync(resolve(absoluteRoot, ".novel-agent", "publish"), {
    recursive: true,
  });
  mkdirSync(resolve(absoluteRoot, "manuscript", "main"), { recursive: true });
  const configPath = resolve(absoluteRoot, ".novel-agent", "config.toml");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, configText(randomUUID()), "utf8");
  }
  const storyPath = resolve(absoluteRoot, "story.yaml");
  if (!existsSync(storyPath)) {
    writeFileSync(storyPath, "schemaVersion: 1\ntitle: 未命名作品\n", "utf8");
  }
  const chapterPath = resolve(
    absoluteRoot,
    "manuscript",
    "main",
    "chapter-1.md",
  );
  if (!existsSync(chapterPath)) {
    writeFileSync(chapterPath, "# 第一章\n\n", "utf8");
  }
  return openWorkspace(absoluteRoot);
}

export function openWorkspace(root: string): WorkspaceInfo {
  const absoluteRoot = resolve(root);
  const configPath = resolve(absoluteRoot, ".novel-agent", "config.toml");
  const config = readFileSync(configPath, "utf8");
  const workspaceId = /^workspace_id\s*=\s*"([^"]+)"\s*$/mu.exec(config)?.[1];
  if (workspaceId === undefined) {
    throw new Error(`Missing workspace_id in ${configPath}`);
  }
  return { root: absoluteRoot, workspaceId };
}

export function readResource(
  workspace: WorkspaceInfo,
  resourcePath: string,
): string {
  return readFileSync(resolveInside(workspace.root, resourcePath), "utf8");
}

export function writeCandidate(
  workspace: WorkspaceInfo,
  candidateId: string,
  content: string,
): string {
  const candidatePath = `.novel-agent/candidates/${candidateId}.md`;
  writeFileSync(resolveInside(workspace.root, candidatePath), content, "utf8");
  return candidatePath;
}

export function writePublicationTemp(
  workspace: WorkspaceInfo,
  resourcePath: string,
  revisionId: string,
  content: string,
): string {
  const target = resolveInside(workspace.root, resourcePath);
  const temp = `${target}.novel-agent-${revisionId}.tmp`;
  writeFileSync(temp, content, { encoding: "utf8", flag: "wx" });
  const descriptor = openSync(temp, "r+");
  try {
    fdatasyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return relative(workspace.root, temp).split(sep).join("/");
}

export function materializePublication(
  workspace: WorkspaceInfo,
  tempPath: string,
  resourcePath: string,
): void {
  const source = resolveInside(workspace.root, tempPath);
  const target = resolveInside(workspace.root, resourcePath);
  if (isAbsolute(tempPath))
    throw new Error("Publication temp path must be relative.");
  renameSync(source, target);
}

export function resourceExists(
  workspace: WorkspaceInfo,
  resourcePath: string,
): boolean {
  return existsSync(resolveInside(workspace.root, resourcePath));
}
