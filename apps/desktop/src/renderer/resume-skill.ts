import { getBuiltinSkill } from "@novel-agent/kernel/builtin-skills";

/** Do not silently substitute updated rules when the author resumes a turn. */
export function validateResumeSkill(skillId: string, receipt: unknown): void {
  if (!skillId) return;
  const current = getBuiltinSkill(skillId);
  const previous = receipt as Record<string, unknown> | null | undefined;
  if (
    !current ||
    !previous ||
    previous.id !== current.id ||
    previous.version !== current.version ||
    previous.instructions !== current.instructions ||
    previous.readOnly !== current.readOnly
  ) {
    throw new Error(
      "原任务的技能规则已更新或历史规则记录不完整，未发送模型请求。请查看当前技能规则，确认后从输入框提交新一轮要求；原任务和候选仍保留。",
    );
  }
}
