import { describe, expect, it } from "vitest";
import type { AuthoringSession, ProposalView } from "@novel-agent/kernel";
import {
  proposalCandidateScope,
  proposalSelection,
} from "../src/renderer/proposal-scope.js";

const scope = {
  path: "manuscript/a.md",
  from: 2,
  to: 6,
  baseHash: "sha256:base",
};
const proposal = { id: "original", path: scope.path } as ProposalView;
const session = (events: unknown[]) => ({ events }) as AuthoringSession;
const context = (selection: unknown) => ({
  type: "context.compiled",
  payload: { selection },
});
const created = (id: string) => ({
  type: "proposal.created",
  payload: { changeSet: { changeSetId: id } },
});

describe("proposal redo scope", () => {
  it("restores the creating turn's file scope, not a later turn's scope", () => {
    expect(
      proposalCandidateScope(
        session([
          {
            type: "turn.started",
            payload: {
              candidateScope: [{ path: scope.path, baseHash: "old" }],
            },
          },
          created("original"),
          {
            type: "turn.started",
            payload: { candidateScope: [{ path: "story.yaml" }] },
          },
        ]),
        proposal,
      ),
    ).toEqual({ limited: true, paths: [scope.path] });
    expect(
      proposalCandidateScope(
        session([{ type: "turn.started", payload: {} }, created("original")]),
        proposal,
      ),
    ).toEqual({ limited: false, paths: [] });
    expect(() => proposalCandidateScope(session([]), proposal)).toThrow(
      "未找到原候选",
    );
  });
  it("restores the proposal's own scope rather than a later turn's selection", () => {
    expect(
      proposalSelection(
        session([
          context(scope),
          created("original"),
          context({ ...scope, from: 10, to: 20 }),
        ]),
        proposal,
      ),
    ).toEqual(scope);
  });
  it("does not apply selections from another document or unscoped turn", () => {
    expect(
      proposalSelection(
        session([
          context({ ...scope, path: "canon/a.md" }),
          created("original"),
        ]),
        proposal,
      ),
    ).toBeUndefined();
    expect(
      proposalSelection(
        session([context(scope), context(null), created("original")]),
        proposal,
      ),
    ).toBeUndefined();
    expect(
      proposalSelection(session([context(scope)]), proposal),
    ).toBeUndefined();
  });
});
