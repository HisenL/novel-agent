import type {
  ChangeSet,
  EventEnvelope,
  PluginManifest,
  Revision,
} from "../src/index.js";

export const HASH_A = `sha256:${"a".repeat(64)}`;
export const HASH_B = `sha256:${"b".repeat(64)}`;

export function makeEvent(
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    eventId: "evt-1",
    streamId: "session-1",
    sequence: 1,
    type: "session.created",
    schemaVersion: 1,
    timestamp: "2026-08-31T00:00:00.000Z",
    actor: { kind: "user", id: "author-1" },
    correlationId: "corr-1",
    visibility: "author",
    payload: { summary: "开始新的小说会话" },
    ...overrides,
  };
}

export function makeManifest(
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    manifestVersion: "1",
    id: "org.example.suspense-editor",
    name: "悬疑伏笔编辑",
    version: "1.0.0",
    license: "Apache-2.0",
    novelAgent: ">=0.1 <0.2",
    executionTier: "declarative",
    entrypoints: { skills: ["skills/foreshadowing/SKILL.md"] },
    provides: ["review.foreshadowing.analyze"],
    permissions: ["story.read", "draft.create"],
    network: { default: "deny", allow: [] },
    configSchema: "schemas/config.json",
    compatibility: { protocol: "1.x", proposal: "1.x", workspace: "1.x" },
    ...overrides,
  };
}

export function makeChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    schemaVersion: 1,
    changeSetId: "changeset-1",
    workspaceId: "workspace-1",
    summary: "收紧开场冲突",
    rationale: "当前开场缺少可见阻力。",
    expectedEffect: "主角在第一场景更早面对选择。",
    scope: {
      resourcePaths: ["manuscript/book-1/chapter-1.md"],
      crossScope: false,
    },
    evidence: [
      { resourcePath: "manuscript/book-1/chapter-1.md", contentHash: HASH_A },
    ],
    risks: ["可能改变原有舒缓节奏"],
    alternatives: ["只调整最后两段"],
    estimatedBudget: { maxInputTokens: 2000, maxOutputTokens: 1200 },
    operations: [
      {
        operationId: "operation-1",
        kind: "replace",
        resourcePath: "manuscript/book-1/chapter-1.md",
        baseHash: HASH_A,
        resultHash: HASH_B,
        candidateRef: "candidate-1",
      },
    ],
    createdAt: "2026-08-31T00:00:00.000Z",
    createdBy: { kind: "agent", id: "main-agent" },
    ...overrides,
  };
}

export function makeRevision(overrides: Partial<Revision> = {}): Revision {
  return {
    schemaVersion: 1,
    revisionId: "revision-1",
    workspaceId: "workspace-1",
    source: "changeset",
    changeSetId: "changeset-1",
    approvalId: "approval-1",
    previousRevisionIds: [],
    resources: [
      {
        resourcePath: "manuscript/book-1/chapter-1.md",
        previousHash: HASH_A,
        contentHash: HASH_B,
      },
    ],
    idempotencyKey: "publish-changeset-1",
    publishedAt: "2026-08-31T00:01:00.000Z",
    ...overrides,
  };
}
