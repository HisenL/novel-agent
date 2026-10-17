import { isMap, parseDocument } from "yaml";

export const storyFields = [
  ["title", "作品名称"],
  ["genre", "题材"],
  ["viewpoint", "叙事视角"],
  ["protagonistGoal", "主角与目标"],
  ["worldRules", "世界规则"],
  ["style", "语言风格"],
  ["boundaries", "创作禁区"],
] as const;
export type StoryField = (typeof storyFields)[number][0];
export type StorySettings = Record<StoryField, string>;
/** Imported YAML remains authoritative; do not pretend unbound fields are empty rules. */
export function unboundStoryFields(source: string): string[] {
  const doc = documentOf(source);
  return (doc.contents as import("yaml").YAMLMap).items.flatMap((item) => {
    const key = String(item.key);
    return ["schemaVersion", "title", "creativeBrief"].includes(key)
      ? []
      : [key];
  });
}
function documentOf(source: string) {
  const doc = parseDocument(source);
  if (doc.errors.length || !isMap(doc.contents))
    throw new Error(
      "创作约定不是有效的 YAML 对象，请先在文本编辑器中修正；原文件不会被替换。",
    );
  const brief = doc.get("creativeBrief", true);
  if (brief !== undefined && !isMap(brief))
    throw new Error(
      "creativeBrief 已有非表单结构，请使用文本编辑器，避免覆盖已有内容。",
    );
  return doc;
}
const pathOf = (field: StoryField) =>
  field === "title" ? ["title"] : ["creativeBrief", field];
export function readStorySettings(source: string): StorySettings {
  const doc = documentOf(source);
  const values = {} as StorySettings;
  for (const [field] of storyFields) {
    const value = doc.getIn(pathOf(field));
    if (value !== undefined && typeof value !== "string")
      throw new Error(`${field} 不是文本，请使用文本编辑器保留已有结构。`);
    values[field] = (value as string) ?? "";
  }
  return values;
}
export function writeStorySettings(
  source: string,
  values: StorySettings,
): string {
  const previous = readStorySettings(source);
  const doc = documentOf(source);
  let changed = false;
  if (!values.title.trim()) throw new Error("请填写作品名称。");
  for (const [field] of storyFields) {
    if (values[field].length > 4000)
      throw new Error("单项约定不能超过 4000 字。");
    if (values[field] !== previous[field]) {
      doc.setIn(pathOf(field), values[field]);
      changed = true;
    }
  }
  return changed ? doc.toString() : source;
}
