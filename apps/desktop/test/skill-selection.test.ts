import { expect, test } from "vitest";
import {
  BUILTIN_SKILLS,
  getBuiltinSkill,
} from "@novel-agent/kernel/builtin-skills";
import { skillSelection } from "../src/renderer/skill-selection.js";

test("current and empty selections do not advertise historical rules", () => {
  expect(skillSelection("")).toEqual({
    selected: undefined,
    historical: undefined,
  });
  for (const skill of BUILTIN_SKILLS) {
    expect(skillSelection(skill.id)).toEqual({
      selected: skill,
      historical: undefined,
    });
  }
});

test("resumed legacy review displays exact original rules and remains read-only", () => {
  const result = skillSelection("continuity-review.v1");
  expect(result.selected).toEqual(getBuiltinSkill("continuity-review.v1"));
  expect(result.historical).toBe(result.selected);
  expect(result.selected?.version).toBe(1);
  expect(result.selected?.readOnly).toBe(true);
  expect(result.selected?.instructions).not.toEqual(
    getBuiltinSkill("continuity-review.v2")?.instructions,
  );
  expect(skillSelection("continuity-review.v2").historical).toEqual(
    getBuiltinSkill("continuity-review.v2"),
  );
  expect(skillSelection("continuity-review.v3").historical).toBeUndefined();
});

test("new review rules preserve v2 and require verifiable concise findings", () => {
  const old = getBuiltinSkill("continuity-review.v2")!;
  const current = getBuiltinSkill("continuity-review.v3")!;
  expect(old.version).toBe(2);
  expect(old.instructions).not.toContain("逐字连续");
  expect(current.version).toBe(3);
  expect(current.instructions).toContain(old.instructions);
  expect(current.instructions).toContain("逐字连续");
  expect(current.instructions).toContain("不能同时成立");
  expect(current.instructions).toContain("至多三项");
  expect(current.readOnly).toBe(true);
});

test("new dialogue rules preserve the old version and use exact local replacement", () => {
  const old = getBuiltinSkill("dialogue-polish.v1")!;
  const current = getBuiltinSkill("dialogue-polish.v2")!;
  expect(old.version).toBe(1);
  expect(current.version).toBe(2);
  expect(current.instructions).toContain(old.instructions);
  expect(current.instructions).toContain("propose_replacement");
  expect(skillSelection("dialogue-polish.v1").historical).toEqual(old);
  expect(skillSelection("dialogue-polish.v2").historical).toBeUndefined();
});
