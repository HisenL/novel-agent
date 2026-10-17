import { describe, expect, it } from "vitest";

import {
  CORE_CAPABILITY_REGISTRY,
  CapabilityPolicyError,
  ContractPolicyError,
  assertCapabilityRegistry,
  assertChangeSetPolicy,
  assertEventPolicy,
  assertExpandedGrantSet,
  assertRevisionPolicy,
  expandPermissionIds,
  validatePluginManifestPolicy,
  type CapabilityRegistry,
} from "../src/index.js";
import {
  HASH_A,
  HASH_B,
  makeChangeSet,
  makeEvent,
  makeManifest,
  makeRevision,
} from "./fixtures.js";

describe("capability policy", () => {
  it("expands aggregates to sorted exact runtime grants", () => {
    expect(
      expandPermissionIds(CORE_CAPABILITY_REGISTRY, [
        "story.read",
        "draft.create",
      ]),
    ).toEqual([
      "draft.create",
      "story.canon.read",
      "story.manuscript.read",
      "story.outline.read",
      "story.timeline.read",
    ]);
  });

  it("never infers a grant from a string prefix", () => {
    expect(() =>
      expandPermissionIds(CORE_CAPABILITY_REGISTRY, ["story.canon.read.extra"]),
    ).toThrowError(CapabilityPolicyError);
    expect(() =>
      assertExpandedGrantSet(CORE_CAPABILITY_REGISTRY, ["story.read"]),
    ).toThrowError(/expanded exact permission/u);
  });

  it("keeps provides separate from requested permissions", () => {
    expect(() =>
      expandPermissionIds(CORE_CAPABILITY_REGISTRY, [
        "review.foreshadowing.analyze",
      ]),
    ).toThrowError(/not a permission/u);
    expect(() =>
      validatePluginManifestPolicy(
        makeManifest({ provides: ["draft.create"] }),
        CORE_CAPABILITY_REGISTRY,
      ),
    ).toThrowError(/not a provided capability/u);
  });

  it("rejects aggregate cycles", () => {
    const registry: CapabilityRegistry = {
      schemaVersion: 1,
      registryVersion: "1.0.0",
      capabilities: [
        {
          id: "cycle.a",
          kind: "permission",
          description: "Cycle A",
          grantable: false,
          expandsTo: ["cycle.b"],
        },
        {
          id: "cycle.b",
          kind: "permission",
          description: "Cycle B",
          grantable: false,
          expandsTo: ["cycle.a"],
        },
      ],
    };
    expect(() => assertCapabilityRegistry(registry)).toThrowError(/cycle/u);
  });
});

describe("contract semantic policy", () => {
  it("allows secret references but rejects secrets and hidden reasoning in all visibilities", () => {
    expect(() =>
      assertEventPolicy(
        makeEvent({
          visibility: "secret",
          payload: { secretRef: "keyring:openai" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertEventPolicy(
        makeEvent({
          visibility: "secret",
          payload: { apiKey: `sk-${"x".repeat(24)}` },
        }),
      ),
    ).toThrowError(ContractPolicyError);
    expect(() =>
      assertEventPolicy(
        makeEvent({ payload: { chain_of_thought: "private reasoning" } }),
      ),
    ).toThrowError(/Forbidden event field/u);
  });

  it("rejects unsafe paths and executable declarative manifests", () => {
    expect(() =>
      validatePluginManifestPolicy(
        makeManifest({ configSchema: "../outside.json" }),
        CORE_CAPABILITY_REGISTRY,
      ),
    ).toThrowError(/safe portable relative path/u);
    expect(() =>
      validatePluginManifestPolicy(
        makeManifest({ entrypoints: { tools: ["dist/tools.js"] } }),
        CORE_CAPABILITY_REGISTRY,
      ),
    ).toThrowError(/declarative plugin/u);
  });

  it("validates manifests but fails closed for execution in Phase 0", () => {
    expect(
      validatePluginManifestPolicy(makeManifest(), CORE_CAPABILITY_REGISTRY),
    ).toEqual({
      expandedPermissions: [
        "draft.create",
        "story.canon.read",
        "story.manuscript.read",
        "story.outline.read",
        "story.timeline.read",
      ],
      hasExecutableEntrypoints: false,
      executionEnabledInPhase0: false,
    });
  });

  it("enforces ChangeSet base/result hash transitions", () => {
    expect(() => assertChangeSetPolicy(makeChangeSet())).not.toThrow();
    expect(() =>
      assertChangeSetPolicy(
        makeChangeSet({
          operations: [
            {
              ...makeChangeSet().operations[0]!,
              baseHash: HASH_A,
              resultHash: HASH_A,
            },
          ],
        }),
      ),
    ).toThrowError(/inconsistent/u);
    expect(() =>
      assertChangeSetPolicy(
        makeChangeSet({
          operations: [
            {
              operationId: "delete-1",
              kind: "delete",
              resourcePath: "manuscript/book-1/chapter-1.md",
              baseHash: HASH_A,
              resultHash: null,
              candidateRef: "must-not-exist",
            },
          ],
        }),
      ),
    ).toThrowError(/inconsistent/u);
  });

  it("binds published revisions to approval and treats external imports separately", () => {
    expect(() => assertRevisionPolicy(makeRevision())).not.toThrow();
    const unapproved = makeRevision();
    delete unapproved.approvalId;
    expect(() => assertRevisionPolicy(unapproved)).toThrowError(
      /origin fields/u,
    );

    const external = makeRevision({
      source: "external-import",
      externalChangeEventId: "external-event-1",
      resources: [
        {
          resourcePath: "manuscript/book-1/chapter-1.md",
          previousHash: HASH_A,
          contentHash: HASH_B,
        },
      ],
    });
    delete external.changeSetId;
    delete external.approvalId;
    expect(() => assertRevisionPolicy(external)).not.toThrow();
  });
});
