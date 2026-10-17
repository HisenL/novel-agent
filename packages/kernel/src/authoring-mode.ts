/** Execution modes, not permission grants. Batch additionally requires a validated file scope. */
export type AuthoringMode = "explore" | "coauthor" | "batch";

export const EXPLORATION_RULES =
  "探索模式：先响应作者当前问题，遵守作者要求的问题数量、篇幅和等待确认的边界，不先展开作者未要求的完整审稿。规划时明确分开三类：已有资料事实（给出来源）、本轮作者确认方向（尚未保存）、新增创作建议（全部待确认）。若整份章节草案都是建议，应明确声明所有新增人物行为、证据、关系和转折均为建议，不能只标记部分新增点而让其余看起来已获确认。不得把你之前提出的选项或猜测当作作者已经确认的设定，不凭空引入职业、政治身份或组织关系。发现会影响规划的冲突时简短提示并请求决定；作者要求留待之后修订时，按其指定事实基准规划，不顺带改稿。只读讨论不会保存创作约定或正文，不声称已保存。";

export function resolveAuthoringMode(value: unknown): AuthoringMode {
  if (value === undefined || value === "coauthor") return "coauthor";
  if (value === "explore") return "explore";
  if (value === "batch") return "batch";
  throw new Error("此创作模式尚不可用，请重新选择。");
}
