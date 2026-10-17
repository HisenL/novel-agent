import { expect, it } from "vitest";
import { getBuiltinSkill } from "@novel-agent/kernel/builtin-skills";
import { validateResumeSkill } from "../src/renderer/resume-skill.js";

it("allows unchanged skill receipts and tasks without skills", () => {
  const skill = getBuiltinSkill("continuity-review.v2")!;
  expect(() => validateResumeSkill(skill.id, { ...skill })).not.toThrow();
  expect(() => validateResumeSkill("", undefined)).not.toThrow();
  const legacy = getBuiltinSkill("continuity-review.v1")!;
  expect(legacy.version).toBe(1);
  expect(legacy.instructions).not.toBe(skill.instructions);
  expect(() => validateResumeSkill(legacy.id, { ...legacy })).not.toThrow();
});

it("blocks changed or missing rules instead of silently using current rules", () => {
  const skill = getBuiltinSkill("continuity-review.v2")!;
  for (const receipt of [
    undefined,
    null,
    {},
    { ...skill, version: 1 },
    { ...skill, instructions: "old rules" },
    { ...skill, readOnly: false },
    { ...skill, id: "other" },
  ]) {
    expect(() => validateResumeSkill(skill.id, receipt)).toThrow(
      "未发送模型请求",
    );
  }
});
