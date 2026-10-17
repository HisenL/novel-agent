import { describe, expect, it } from "vitest";

import {
  CORE_CAPABILITY_REGISTRY,
  SESSION_METHODS,
  validateContract,
} from "../src/index.js";
import {
  HASH_A,
  makeChangeSet,
  makeEvent,
  makeManifest,
  makeRevision,
} from "./fixtures.js";

describe("Phase 0 JSON Schemas", () => {
  it("accepts the frozen EventEnvelope shape and unknown event types", () => {
    const event = makeEvent({ type: "community.future_event" });
    expect(validateContract("event-envelope", event)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects invalid event ordering fields and unknown envelope properties", () => {
    expect(
      validateContract("event-envelope", { ...makeEvent(), sequence: 0 }).valid,
    ).toBe(false);
    expect(
      validateContract("event-envelope", {
        ...makeEvent(),
        rawProviderPayload: {},
      }).valid,
    ).toBe(false);
  });

  it("validates the core capability registry", () => {
    expect(
      validateContract("capability-registry", CORE_CAPABILITY_REGISTRY),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("validates permission request and expanded decision contracts", () => {
    const request = {
      schemaVersion: 1,
      requestId: "permission-1",
      requestedCapabilities: ["story.read"],
      requestedBy: { kind: "agent", id: "main-agent" },
      reason: "需要读取当前作品以编译上下文。",
      scope: { resourcePaths: ["manuscript/book-1/chapter-1.md"] },
      createdAt: "2026-08-31T00:00:00.000Z",
    };
    const decision = {
      schemaVersion: 1,
      decisionId: "decision-1",
      requestId: "permission-1",
      outcome: "allow",
      expandedPermissions: [
        "story.canon.read",
        "story.manuscript.read",
        "story.outline.read",
        "story.timeline.read",
      ],
      decidedBy: { kind: "user", id: "author-1" },
      policyVersion: "1",
      decidedAt: "2026-08-31T00:00:01.000Z",
    };
    expect(validateContract("permission-request", request).valid).toBe(true);
    expect(validateContract("permission-decision", decision).valid).toBe(true);
  });

  it("validates ChangeSet, Revision, and Manifest examples", () => {
    expect(validateContract("change-set", makeChangeSet()).valid).toBe(true);
    expect(validateContract("revision", makeRevision()).valid).toBe(true);
    expect(validateContract("plugin-manifest", makeManifest()).valid).toBe(
      true,
    );
    expect(
      validateContract("change-set", {
        ...makeChangeSet(),
        operations: [
          { ...makeChangeSet().operations[0]!, baseHash: HASH_A.toUpperCase() },
        ],
      }).valid,
    ).toBe(false);
  });

  it("accepts only the frozen JSON-RPC request methods and event notification", () => {
    for (const method of SESSION_METHODS) {
      expect(
        validateContract("json-rpc-message", {
          jsonrpc: "2.0",
          id: `request-${method}`,
          method,
          params: {},
        }).valid,
      ).toBe(true);
    }
    expect(
      validateContract("json-rpc-message", {
        jsonrpc: "2.0",
        id: "request-unknown",
        method: "database.write",
      }).valid,
    ).toBe(false);
    expect(
      validateContract("json-rpc-message", {
        jsonrpc: "2.0",
        method: "event",
        params: makeEvent(),
      }).valid,
    ).toBe(true);
  });
});
