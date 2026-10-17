import { expect, test } from "vitest";
import {
  taskCandidateScope,
  taskControls,
} from "../src/renderer/task-controls.js";

test("restores only latest exact candidate paths without reusing base hashes", () => {
  const previous = {
    type: "turn.started",
    payload: {
      mode: "batch",
      candidateScope: [{ path: "outline/a.md", baseHash: "old" }],
    },
  };
  expect(taskCandidateScope([previous])).toEqual({
    limited: true,
    paths: ["outline/a.md"],
  });
  expect(
    taskCandidateScope([
      previous,
      { type: "turn.started", payload: { mode: "explore" } },
    ]),
  ).toEqual({ limited: false, paths: [] });
  expect(
    taskCandidateScope([{ type: "turn.started", payload: { mode: "batch" } }]),
  ).toEqual({ limited: true, paths: [] });
  expect(
    taskCandidateScope([
      {
        type: "turn.started",
        payload: { candidateScope: [null, {}, { path: 1 }] },
      },
    ]),
  ).toEqual({ limited: true, paths: [] });
});

test("reopened exploration stays read-only and uses the latest turn", () => {
  expect(
    taskControls([
      { type: "turn.started", payload: { mode: "coauthor" } },
      { type: "turn.started", payload: { mode: "explore", readOnly: true } },
      { type: "turn.completed", payload: {} },
    ]),
  ).toEqual({ mode: "explore", readOnly: true, skillId: "" });
});

test("restores legacy skills without upgrading and fails closed for unavailable skills", () => {
  expect(
    taskControls([
      { type: "turn.started", payload: { skillId: "continuity-review.v1" } },
    ]),
  ).toEqual({
    mode: "coauthor",
    readOnly: true,
    skillId: "continuity-review.v1",
  });
  expect(
    taskControls([{ type: "turn.started", payload: { skillId: "missing.v1" } }])
      .readOnly,
  ).toBe(true);
  expect(taskControls([])).toEqual({
    mode: "coauthor",
    readOnly: false,
    skillId: "",
  });
});
