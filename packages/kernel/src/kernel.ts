import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { SQLiteEventStore } from "@novel-agent/event-store";
import {
  type ChangeSet,
  type EventEnvelope,
  type Revision,
  assertChangeSetPolicy,
  assertRevisionPolicy,
} from "@novel-agent/protocol";

import { BudgetBroker, PermissionBroker } from "./brokers.js";
import {
  ModelGateway,
  MockModelAdapter,
  type ModelAdapter,
} from "./model-gateway.js";
import { ToolRuntime } from "./tool-runtime.js";
import {
  hashContent,
  initializeWorkspace,
  materializePublication,
  openWorkspace,
  readResource,
  resourceExists,
  type WorkspaceInfo,
  writeCandidate,
  writePublicationTemp,
} from "./workspace.js";

export type SessionStatus =
  | "awaiting_approval"
  | "completed"
  | "conflicted"
  | "rejected"
  | "running";

export interface SessionView {
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly task: string;
  readonly resourcePath: string;
  readonly candidatePath?: string;
  readonly changeSet?: ChangeSet;
  readonly revision?: Revision;
  readonly events: readonly EventEnvelope[];
}

export interface StartTaskInput {
  readonly task: string;
  readonly resourcePath?: string;
}

export interface ApproveOptions {
  readonly faultAfterPrepare?: boolean;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function payloadOf(event: EventEnvelope): JsonRecord {
  if (typeof event.payload !== "object" || event.payload === null) return {};
  return event.payload as JsonRecord;
}

function eventOfType(
  events: readonly EventEnvelope[],
  type: string,
): EventEnvelope | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === type) return event;
  }
  return undefined;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Missing ${label}.`);
  return value;
}

export class NovelAgentKernel {
  readonly #workspace: WorkspaceInfo;
  readonly #events: SQLiteEventStore;
  readonly #permissions = new PermissionBroker();
  readonly #tools: ToolRuntime;
  readonly #models: ModelGateway;

  public static initialize(workspaceRoot: string): WorkspaceInfo {
    return initializeWorkspace(workspaceRoot);
  }

  public constructor(
    workspaceRoot: string,
    adapter: ModelAdapter = new MockModelAdapter(),
  ) {
    this.#workspace = openWorkspace(workspaceRoot);
    this.#events = new SQLiteEventStore(
      resolve(this.#workspace.root, ".novel-agent", "events.sqlite3"),
    );
    this.#permissions.grantExact("story.manuscript.read");
    this.#permissions.grantExact("draft.create");
    this.#tools = new ToolRuntime(this.#permissions);
    this.#models = new ModelGateway(adapter, new BudgetBroker());
  }

  public async startTask(input: StartTaskInput): Promise<SessionView> {
    const task = input.task.trim();
    if (task.length === 0) throw new Error("Task cannot be empty.");
    const resourcePath = input.resourcePath ?? "manuscript/main/chapter-1.md";
    const sessionId = randomUUID();
    this.#append(sessionId, "session.created", {
      workspaceId: this.#workspace.workspaceId,
      task,
      resourcePath,
    });
    this.#append(sessionId, "plan.created", {
      steps: ["读取当前正文", "生成修改候选", "等待作者审批", "发布不可变版本"],
    });
    this.#append(sessionId, "tool.requested", {
      toolId: "manuscript.read",
      capability: "story.manuscript.read",
      resourcePath,
    });
    const manuscript = this.#tools.readManuscript(
      this.#workspace,
      resourcePath,
    );
    this.#append(sessionId, "tool.completed", {
      toolId: "manuscript.read",
      resourcePath,
      contentHash: hashContent(manuscript),
    });
    this.#append(sessionId, "budget.reserved", {
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
    });
    this.#append(sessionId, "model.started", {
      adapterId: this.#models.adapterId,
    });
    const result = await this.#models.generate({
      task,
      manuscript,
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
    });
    this.#append(
      sessionId,
      "model.completed",
      { adapterId: result.adapterId },
      {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedTokens: 0,
      },
    );
    this.#append(sessionId, "budget.settled", {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      chargedAmount: 0,
      currency: "USD",
    });
    this.#permissions.requireExact("draft.create");
    const candidateId = randomUUID();
    const candidatePath = writeCandidate(
      this.#workspace,
      candidateId,
      result.content,
    );
    const now = new Date().toISOString();
    const changeSet: ChangeSet = {
      schemaVersion: 1,
      changeSetId: randomUUID(),
      workspaceId: this.#workspace.workspaceId,
      summary: `根据任务生成 ${resourcePath} 的候选修改`,
      rationale: task,
      expectedEffect: "仅在作者批准后替换目标正文。",
      scope: { resourcePaths: [resourcePath], crossScope: false },
      evidence: [{ resourcePath, contentHash: hashContent(manuscript) }],
      risks: ["Mock Provider 仅用于验证执行闭环，候选不代表最终创作质量。"],
      alternatives: ["拒绝候选并保持当前正文不变。"],
      estimatedBudget: { maxInputTokens: 8_000, maxOutputTokens: 2_000 },
      operations: [
        {
          operationId: randomUUID(),
          kind: "replace",
          resourcePath,
          baseHash: hashContent(manuscript),
          resultHash: hashContent(result.content),
          candidateRef: candidateId,
        },
      ],
      createdAt: now,
      createdBy: { kind: "agent", id: "kernel.mock-agent" },
    };
    assertChangeSetPolicy(changeSet);
    this.#append(sessionId, "candidate.created", {
      candidateId,
      candidatePath,
      changeSet,
    });
    this.#append(sessionId, "approval.requested", {
      approvalId: randomUUID(),
      changeSetId: changeSet.changeSetId,
      requiredCapability: "revision.publish",
    });
    return this.getSession(sessionId);
  }

  public getSession(sessionId: string): SessionView {
    const events = this.#events.loadStream(sessionId);
    if (events.length === 0) throw new Error(`Unknown session '${sessionId}'.`);
    const created = payloadOf(events[0]!);
    const candidateEvent = eventOfType(events, "candidate.created");
    const materializedEvent = eventOfType(events, "revision.materialized");
    const conflict = eventOfType(events, "publication.conflicted");
    const cancelled = eventOfType(events, "session.cancelled");
    const candidate =
      candidateEvent === undefined ? {} : payloadOf(candidateEvent);
    const materialized =
      materializedEvent === undefined ? {} : payloadOf(materializedEvent);
    const view: SessionView = {
      sessionId,
      status:
        materializedEvent !== undefined
          ? "completed"
          : conflict !== undefined
            ? "conflicted"
            : cancelled !== undefined
              ? "rejected"
              : candidateEvent !== undefined
                ? "awaiting_approval"
                : "running",
      task: requireString(created.task, "session task"),
      resourcePath: requireString(
        created.resourcePath,
        "session resource path",
      ),
      events,
      ...(typeof candidate.candidatePath === "string"
        ? { candidatePath: candidate.candidatePath }
        : {}),
      ...(candidate.changeSet !== undefined
        ? { changeSet: candidate.changeSet as ChangeSet }
        : {}),
      ...(materialized.revision !== undefined
        ? { revision: materialized.revision as Revision }
        : {}),
    };
    return view;
  }

  public resume(sessionId: string): SessionView {
    this.#reconcilePrepared(sessionId);
    return this.getSession(sessionId);
  }

  public approve(sessionId: string, options: ApproveOptions = {}): SessionView {
    this.#reconcilePrepared(sessionId);
    let view = this.getSession(sessionId);
    if (view.status === "rejected")
      throw new Error("作者已拒绝此候选，不能发布。请创建新的候选。");
    if (view.status === "completed" || view.status === "conflicted")
      return view;
    if (view.changeSet === undefined || view.candidatePath === undefined) {
      throw new Error("Session has no candidate to approve.");
    }
    const approvalRequest = eventOfType(view.events, "approval.requested");
    if (approvalRequest === undefined)
      throw new Error("Approval was not requested.");
    const approvalId = requireString(
      payloadOf(approvalRequest).approvalId,
      "approval id",
    );
    if (eventOfType(view.events, "approval.resolved") === undefined) {
      this.#append(sessionId, "approval.resolved", {
        approvalId,
        outcome: "allow",
        decidedBy: "user",
        expandedPermissions: ["revision.publish"],
      });
    }
    this.#permissions.grantExact("revision.publish");
    this.#permissions.requireExact("revision.publish");
    const operation = view.changeSet.operations[0]!;
    const current = readResource(this.#workspace, operation.resourcePath);
    if (hashContent(current) !== operation.baseHash) {
      this.#append(sessionId, "publication.conflicted", {
        changeSetId: view.changeSet.changeSetId,
        resourcePath: operation.resourcePath,
        expectedBaseHash: operation.baseHash,
        actualHash: hashContent(current),
      });
      return this.getSession(sessionId);
    }
    const candidate = readResource(this.#workspace, view.candidatePath);
    if (hashContent(candidate) !== operation.resultHash) {
      throw new Error("Candidate hash does not match the approved ChangeSet.");
    }
    const revision: Revision = {
      schemaVersion: 1,
      revisionId: randomUUID(),
      workspaceId: this.#workspace.workspaceId,
      source: "changeset",
      changeSetId: view.changeSet.changeSetId,
      approvalId,
      previousRevisionIds: view.events
        .filter((event) => event.type === "revision.materialized")
        .map((event) =>
          requireString(payloadOf(event).revisionId, "revision id"),
        ),
      resources: [
        {
          resourcePath: operation.resourcePath,
          previousHash: operation.baseHash,
          contentHash: operation.resultHash,
        },
      ],
      idempotencyKey: `publish:${view.changeSet.changeSetId}`,
      publishedAt: new Date().toISOString(),
    };
    assertRevisionPolicy(revision);
    const tempPath = writePublicationTemp(
      this.#workspace,
      operation.resourcePath,
      revision.revisionId,
      candidate,
    );
    this.#append(sessionId, "revision.prepared", {
      revision,
      tempPath,
      resourcePath: operation.resourcePath,
      baseHash: operation.baseHash,
      resultHash: operation.resultHash,
    });
    if (options.faultAfterPrepare === true) {
      throw new Error("Injected crash after revision.prepared");
    }
    this.#reconcilePrepared(sessionId);
    view = this.getSession(sessionId);
    return view;
  }

  public reject(sessionId: string): SessionView {
    const view = this.getSession(sessionId);
    if (eventOfType(view.events, "approval.resolved") === undefined) {
      this.#append(sessionId, "approval.resolved", {
        outcome: "deny",
        decidedBy: "user",
        expandedPermissions: [],
      });
      this.#append(sessionId, "session.cancelled", {
        reason: "author-rejected",
      });
    }
    return this.getSession(sessionId);
  }

  public close(): void {
    this.#events.close();
  }

  #reconcilePrepared(sessionId: string): void {
    const events = this.#events.loadStream(sessionId);
    const prepared = eventOfType(events, "revision.prepared");
    if (
      prepared === undefined ||
      eventOfType(events, "revision.materialized") !== undefined ||
      eventOfType(events, "publication.conflicted") !== undefined
    ) {
      return;
    }
    const payload = payloadOf(prepared);
    const revision = payload.revision as Revision;
    const resourcePath = requireString(
      payload.resourcePath,
      "prepared resource path",
    );
    const tempPath = requireString(payload.tempPath, "prepared temp path");
    const baseHash = requireString(payload.baseHash, "prepared base hash");
    const resultHash = requireString(
      payload.resultHash,
      "prepared result hash",
    );
    const currentHash = hashContent(
      readResource(this.#workspace, resourcePath),
    );
    if (currentHash === resultHash) {
      this.#append(sessionId, "revision.materialized", {
        revisionId: revision.revisionId,
        revision,
        recovered: true,
      });
      return;
    }
    if (currentHash === baseHash && resourceExists(this.#workspace, tempPath)) {
      const tempHash = hashContent(readResource(this.#workspace, tempPath));
      if (tempHash === resultHash) {
        materializePublication(this.#workspace, tempPath, resourcePath);
        this.#append(sessionId, "revision.materialized", {
          revisionId: revision.revisionId,
          revision,
          recovered: true,
        });
        return;
      }
    }
    this.#append(sessionId, "publication.conflicted", {
      revisionId: revision.revisionId,
      resourcePath,
      expectedBaseHash: baseHash,
      expectedResultHash: resultHash,
      actualHash: currentHash,
    });
  }

  #append(
    streamId: string,
    type: string,
    payload: JsonRecord,
    usage?: EventEnvelope["usage"],
  ): EventEnvelope {
    const event: EventEnvelope = {
      eventId: randomUUID(),
      streamId,
      sequence: this.#events.nextSequence(streamId),
      type,
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      actor: { kind: "system", id: "novel-agent.kernel" },
      correlationId: streamId,
      visibility: "author",
      payload,
      ...(usage === undefined ? {} : { usage }),
    };
    this.#events.append(event);
    return event;
  }
}
