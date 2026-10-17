import { getBuiltinSkill } from "@novel-agent/kernel/builtin-skills";

export function taskCandidateScope(
  events: readonly { type: string; payload: unknown }[],
) {
  const last = [...events]
    .reverse()
    .find((event) => event.type === "turn.started")?.payload as
    | Record<string, unknown>
    | undefined;
  const scope = last?.candidateScope;
  return {
    limited: scope !== undefined || last?.mode === "batch",
    // Restore only the author's path selection. A new turn must read fresh base hashes.
    paths: Array.isArray(scope)
      ? scope.flatMap((entry: unknown) => {
          if (
            !entry ||
            typeof entry !== "object" ||
            !("path" in entry) ||
            typeof entry.path !== "string"
          )
            return [];
          return [entry.path];
        })
      : [],
  };
}

/** Restore author-visible controls on task selection, never on background refresh. */
export function taskControls(
  events: readonly { type: string; payload: unknown }[],
) {
  const payload = [...events]
    .reverse()
    .find((event) => event.type === "turn.started")?.payload;
  const last = payload as Record<string, unknown> | undefined;
  const mode =
    last?.mode === "explore" || last?.mode === "batch" ? last.mode : "coauthor";
  const skillId = typeof last?.skillId === "string" ? last.skillId : "";
  let skill;
  try {
    skill = getBuiltinSkill(skillId);
  } catch {
    /* Unavailable skills must not silently enable writing. */
  }
  return {
    mode,
    skillId: skill?.id ?? "",
    readOnly:
      last?.readOnly === true ||
      mode === "explore" ||
      skill?.readOnly === true ||
      (!!skillId && !skill),
  } as const;
}
