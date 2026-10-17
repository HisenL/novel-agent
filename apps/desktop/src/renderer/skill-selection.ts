import {
  BUILTIN_SKILLS,
  getBuiltinSkill,
} from "@novel-agent/kernel/builtin-skills";

/** Historical rules stay visible when resumed, without advertising them for new tasks. */
export function skillSelection(skillId: string) {
  const selected = getBuiltinSkill(skillId);
  const historical =
    selected && !BUILTIN_SKILLS.some((skill) => skill.id === selected.id)
      ? selected
      : undefined;
  return { selected, historical };
}
