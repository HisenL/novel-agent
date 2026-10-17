import type {
  AuthoringSession,
  ProposalView,
  SelectionScope,
} from "@novel-agent/kernel";
import { taskCandidateScope } from "./task-controls.js";

export function proposalCandidateScope(
  session: AuthoringSession,
  proposal: ProposalView,
) {
  const index = session.events.findIndex(
    (event) =>
      event.type === "proposal.created" &&
      (event.payload as { changeSet?: { changeSetId?: string } }).changeSet
        ?.changeSetId === proposal.id,
  );
  if (index < 0) throw new Error("未找到原候选的范围记录，请重新打开任务。");
  return taskCandidateScope(session.events.slice(0, index + 1));
}

export function proposalSelection(
  session: AuthoringSession,
  proposal: ProposalView,
): SelectionScope | undefined {
  let selection: SelectionScope | undefined;
  for (const event of session.events) {
    if (event.type === "context.compiled")
      selection =
        (event.payload as { selection?: SelectionScope | null }).selection ??
        undefined;
    if (
      event.type === "proposal.created" &&
      (event.payload as { changeSet?: { changeSetId?: string } }).changeSet
        ?.changeSetId === proposal.id
    )
      return selection?.path === proposal.path ? selection : undefined;
  }
  return undefined;
}
