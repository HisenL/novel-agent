export const documentTemplates = {
  blank: { label: "空白文件", path: "manuscript/main/新章节.md", body: "" },
  scene: {
    label: "章节与场景计划",
    path: "outline/章节计划.md",
    body: "## 本章目标\n\n## 场景安排\n\n- 时间与地点：\n- 视角人物：\n- 人物目标：\n- 阻力与冲突：\n- 场景转折：\n- 结尾留下的问题：\n\n## 连续性检查\n\n- 承接前章：\n- 人物已知信息：\n- 需要铺设或回收的伏笔：\n",
  },
  character: {
    label: "人物卡",
    path: "canon/characters/新人物.md",
    body: "## 身份与关系\n\n## 核心目标\n\n## 动机与恐惧\n\n## 性格与说话方式\n\n## 当前状态\n\n- 所在位置：\n- 已知信息：\n- 尚不知道的信息：\n\n## 变化记录\n\n- 章节／场景：\n- 变化与依据：\n",
  },
  location: {
    label: "地点与世界规则",
    path: "canon/locations/新地点.md",
    body: "## 地点描述\n\n## 空间与通行关系\n\n## 世界规则与限制\n\n## 关联人物\n\n## 已发生事件与章节依据\n",
  },
  timeline: {
    label: "时间线",
    path: "canon/timeline.md",
    body: "## 时间基准\n\n## 事件顺序\n\n| 故事时间 | 事件 | 参与人物 | 章节依据 | 待确认事项 |\n| --- | --- | --- | --- | --- |\n| 待填写 | | | | |\n",
  },
  foreshadowing: {
    label: "伏笔记录",
    path: "canon/foreshadowing.md",
    body: "## 伏笔清单\n\n| 线索 | 铺设章节 | 谁已知情 | 预期回收 | 当前状态 |\n| --- | --- | --- | --- | --- |\n| 待填写 | | | | 未确认 |\n\n## 回收与修改依据\n",
  },
} as const;

export type DocumentTemplate = keyof typeof documentTemplates;

export function templateContent(
  template: DocumentTemplate,
  path: string,
): string {
  if (template !== "blank" && !path.endsWith(".md"))
    throw new Error("资料模板使用 Markdown，请将文件扩展名设为 .md。");
  if (template === "blank" && /\.ya?ml$/u.test(path)) return "";
  const title = path.split(/[\\/]/u).at(-1)?.replace(/\.md$/u, "") ?? "新文件";
  return `# ${title}\n\n${documentTemplates[template].body}`;
}
