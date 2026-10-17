import type { DocumentFile } from "@novel-agent/kernel";

/** Keep imported and nested chapters distinguishable in the flat sidebar. */
export function fileDisplayTitle(file: DocumentFile): string {
  const parents = file.path.split("/").slice(1, -1);
  if (parents[0] === "main" || parents[0] === "imported") parents.shift();
  return parents.length ? `${parents.join(" / ")} / ${file.title}` : file.title;
}
