const CONTINUITY_V2 = {
  id: "continuity-review.v2",
  name: "连续性审稿",
  version: 2,
  readOnly: true,
  instructions:
    "只读审稿。先读取约定、相关章节、人物状态、时间线与伏笔资料，资料缺失要明确说明，不补造事实。按问题逐项给出文件路径、原文短引、相互矛盾的依据、严重程度及修订建议。定位优先使用文件路径和可搜索的原文短引；只有逐项核实后才给出行号或段落编号，不编造位置。区分确定矛盾、角色有限认知、故意悬念和待作者确认事项；不要把猜测说成事实。不得推断作者原本打算如何埋设或回收伏笔；没有资料依据的作者意图只能列为待询问事项。最小修订优先保留现有设定，不为解释冲突擅加替身、义体、捷径或新信息来源；确需改变设定时先询问作者。检查时间顺序、谁知道什么、位置与物品状态。不得生成修改候选或声称已修改正文。",
} as const;

const DIALOGUE_V1 = {
  id: "dialogue-polish.v1",
  name: "对白润色",
  version: 1,
  readOnly: false,
  instructions:
    "先读取当前正文和相关人物说话方式。列出必须保留的事实、人物动机、信息披露顺序及对白潜台词。删减重复解释，用措辞、停顿和动作区分人物声音，不新增未经确认的事实。若有选区，只提交选区替换；否则先明确修改范围。生成候选后简短说明保留了什么、改变了什么，不自行接受。",
} as const;

/** Versioned declarative rules only: no code entrypoints or additional grants. */
export const BUILTIN_SKILLS = [
  {
    id: "scene-plan.v1",
    name: "场景规划",
    version: 1,
    readOnly: false,
    instructions:
      "先读取创作约定、当前章节与相关人物资料，列出引用依据。逐场景说明视角、时间地点、人物目标、阻力、转折、结果及衔接。区分已确定事实和建议；遇到会改变主线的缺项先询问作者。作者要求保存时才通过工具生成计划候选；不要顺带重写正文。结束前核对因果、视角和时间顺序。",
  },
  {
    id: "dialogue-polish.v2",
    name: "对白润色",
    version: 2,
    readOnly: false,
    instructions:
      DIALOGUE_V1.instructions +
      "如果作者没有在编辑器选区，但明确指定了几句或一段对白，先完整读取目标文件，确认其原文与唯一位置，再使用 propose_replacement 的 oldText/newText 提交局部候选。不要把只含改写片段的文本交给 propose_document 覆盖整章；不确定范围或原文不唯一时先询问作者。",
  },
  {
    id: "continuity-review.v3",
    name: "连续性审稿",
    version: 3,
    readOnly: true,
    instructions:
      CONTINUITY_V2.instructions +
      "报告默认不超过600字、至多三项重要问题，不在次要项追加问题；作者要求完整报告时按其要求。引号内必须是同一来源逐字连续的短引，不将概括、拼接或推测伪装为原文。明确矛盾必须给出不能同时成立的两项事实；集合中的某一项、角色猜测或自然省略不能仅凭数量或措辞不同判作矛盾。时刻写法歧义与空间交代不足归为表述建议或待确认，不当成已证实冲突。建议本身也需清晰无歧义。不强凑问题数，无确定矛盾就明确说明；先给结论，再给可核对的依据。",
  },
] as const;

export function getBuiltinSkill(id: unknown) {
  if (id === undefined || id === "") return undefined;
  if (id === "continuity-review.v1") return LEGACY_CONTINUITY_REVIEW;
  if (id === "continuity-review.v2") return CONTINUITY_V2;
  if (id === "dialogue-polish.v1") return DIALOGUE_V1;
  const skill = BUILTIN_SKILLS.find((item) => item.id === id);
  if (!skill) throw new Error("创作技能不可用，请重新选择已安装的内置技能。");
  return skill;
}

// Historical selection IDs remain resolvable but are not offered for new tasks.
const LEGACY_CONTINUITY_REVIEW = {
  id: "continuity-review.v1",
  name: "连续性审稿",
  version: 1,
  readOnly: true,
  instructions:
    "只读审稿。先读取约定、相关章节、人物状态、时间线与伏笔资料，资料缺失要明确说明，不补造事实。按问题逐项给出文件路径、原文短引、相互矛盾的依据、严重程度及修订建议。区分确定矛盾、角色有限认知、故意悬念和待作者确认事项；不要把猜测说成事实。检查时间顺序、谁知道什么、位置与物品状态。不得生成修改候选或声称已修改正文。",
} as const;
