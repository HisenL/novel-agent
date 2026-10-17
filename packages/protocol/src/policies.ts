import {
  assertExpandedGrantSet,
  assertProvidedCapabilityIds,
  expandPermissionIds,
} from "./capabilities.js";
import type {
  CapabilityRegistry,
  ChangeSet,
  EventEnvelope,
  PluginManifest,
  Revision,
} from "./schemas.js";
import { validateContract } from "./validation.js";

export class ContractPolicyError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContractPolicyError";
  }
}

const FORBIDDEN_EVENT_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "chainofthought",
  "clientsecret",
  "hiddenreasoning",
  "password",
  "rawproviderpayload",
  "reasoningcontent",
  "refreshtoken",
  "secretvalue",
]);
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/iu,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
];
const EXECUTABLE_ENTRYPOINTS = new Set([
  "contexts",
  "evaluators",
  "exporters",
  "hooks",
  "providers",
  "runtimes",
  "tools",
]);

function assertContract(
  name: Parameters<typeof validateContract>[0],
  value: unknown,
): void {
  const result = validateContract(name, value);
  if (!result.valid) {
    throw new ContractPolicyError(
      "schema-invalid",
      `Invalid ${name} contract: ${result.errors.join("; ")}`,
    );
  }
}

export function isSafeRelativeResourcePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function assertSafeRelativeResourcePath(value: string): void {
  if (!isSafeRelativeResourcePath(value)) {
    throw new ContractPolicyError(
      "unsafe-resource-path",
      `Resource path '${value}' is not a safe portable relative path.`,
    );
  }
}

interface JsonInspectionState {
  readonly seen: WeakSet<object>;
  nodes: number;
}

function inspectEventValue(
  value: unknown,
  path: string,
  depth: number,
  state: JsonInspectionState,
): void {
  if (depth > 64 || state.nodes++ > 10_000) {
    throw new ContractPolicyError(
      "event-payload-limit",
      `Event payload exceeds the Phase 0 depth or node limit at ${path}.`,
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (
      typeof value === "string" &&
      SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))
    ) {
      throw new ContractPolicyError(
        "secret-in-event",
        `Event payload contains credential-like material at ${path}.`,
      );
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ContractPolicyError(
        "non-json-event",
        `Non-finite number at ${path}.`,
      );
    }
    return;
  }
  if (typeof value !== "object") {
    throw new ContractPolicyError(
      "non-json-event",
      `Non-JSON value at ${path}.`,
    );
  }
  if (state.seen.has(value)) {
    throw new ContractPolicyError(
      "non-json-event",
      `Cyclic event payload at ${path}.`,
    );
  }
  state.seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      inspectEventValue(child, `${path}/${index}`, depth + 1, state),
    );
    state.seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ContractPolicyError(
      "non-json-event",
      `Non-plain object at ${path}.`,
    );
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (FORBIDDEN_EVENT_KEYS.has(normalizedKey)) {
      throw new ContractPolicyError(
        "forbidden-event-field",
        `Forbidden event field '${key}' at ${path}.`,
      );
    }
    inspectEventValue(child, `${path}/${key}`, depth + 1, state);
  }
  state.seen.delete(value);
}

export function assertEventPolicy(event: EventEnvelope): void {
  assertContract("event-envelope", event);
  inspectEventValue(event.payload, "/payload", 0, {
    seen: new WeakSet(),
    nodes: 0,
  });
}

export interface ManifestPolicyResult {
  readonly expandedPermissions: readonly string[];
  readonly hasExecutableEntrypoints: boolean;
  readonly executionEnabledInPhase0: false;
}

export function validatePluginManifestPolicy(
  manifest: PluginManifest,
  registry: CapabilityRegistry,
): ManifestPolicyResult {
  assertContract("plugin-manifest", manifest);
  assertProvidedCapabilityIds(registry, manifest.provides);
  const expandedPermissions = expandPermissionIds(
    registry,
    manifest.permissions,
  );
  assertExpandedGrantSet(registry, expandedPermissions);

  let hasExecutableEntrypoints = false;
  for (const [kind, paths] of Object.entries(manifest.entrypoints)) {
    for (const path of paths ?? []) {
      assertSafeRelativeResourcePath(path);
    }
    if (EXECUTABLE_ENTRYPOINTS.has(kind) && (paths?.length ?? 0) > 0) {
      hasExecutableEntrypoints = true;
    }
  }
  if (manifest.configSchema !== undefined) {
    assertSafeRelativeResourcePath(manifest.configSchema);
  }
  if (manifest.executionTier === "declarative" && hasExecutableEntrypoints) {
    throw new ContractPolicyError(
      "declarative-code-entrypoint",
      "A declarative plugin cannot declare executable entrypoints.",
    );
  }
  if (
    manifest.network.allow.length > 0 &&
    !expandedPermissions.includes("network.external")
  ) {
    throw new ContractPolicyError(
      "network-permission-missing",
      "A network allowlist requires the exact network.external permission.",
    );
  }

  return {
    expandedPermissions,
    hasExecutableEntrypoints,
    executionEnabledInPhase0: false,
  };
}

export function assertChangeSetPolicy(changeSet: ChangeSet): void {
  assertContract("change-set", changeSet);
  const operationIds = new Set<string>();
  const operationPaths = new Set<string>();
  const scopePaths = new Set(changeSet.scope.resourcePaths);

  for (const path of changeSet.scope.resourcePaths) {
    assertSafeRelativeResourcePath(path);
  }
  for (const evidence of changeSet.evidence) {
    assertSafeRelativeResourcePath(evidence.resourcePath);
  }
  for (const operation of changeSet.operations) {
    assertSafeRelativeResourcePath(operation.resourcePath);
    if (
      operationIds.has(operation.operationId) ||
      operationPaths.has(operation.resourcePath)
    ) {
      throw new ContractPolicyError(
        "duplicate-change-operation",
        "A ChangeSet cannot contain duplicate operation ids or resource paths.",
      );
    }
    operationIds.add(operation.operationId);
    operationPaths.add(operation.resourcePath);
    if (!scopePaths.has(operation.resourcePath)) {
      throw new ContractPolicyError(
        "operation-outside-scope",
        `Operation '${operation.operationId}' is outside the declared scope.`,
      );
    }

    const hasCandidate = operation.candidateRef !== undefined;
    if (
      (operation.kind === "create" &&
        (operation.baseHash !== null ||
          operation.resultHash === null ||
          !hasCandidate)) ||
      (operation.kind === "replace" &&
        (operation.baseHash === null ||
          operation.resultHash === null ||
          operation.baseHash === operation.resultHash ||
          !hasCandidate)) ||
      (operation.kind === "delete" &&
        (operation.baseHash === null ||
          operation.resultHash !== null ||
          hasCandidate))
    ) {
      throw new ContractPolicyError(
        "invalid-change-transition",
        `Operation '${operation.operationId}' has hashes or candidate data inconsistent with '${operation.kind}'.`,
      );
    }
  }
}

export function assertRevisionPolicy(revision: Revision): void {
  assertContract("revision", revision);
  const resourcePaths = new Set<string>();
  for (const resource of revision.resources) {
    assertSafeRelativeResourcePath(resource.resourcePath);
    if (resourcePaths.has(resource.resourcePath)) {
      throw new ContractPolicyError(
        "duplicate-revision-resource",
        `Revision contains '${resource.resourcePath}' more than once.`,
      );
    }
    resourcePaths.add(resource.resourcePath);
    if (resource.previousHash === resource.contentHash) {
      throw new ContractPolicyError(
        "revision-noop",
        `Revision resource '${resource.resourcePath}' does not change its content hash.`,
      );
    }
  }

  if (
    (revision.source === "changeset" &&
      (revision.changeSetId === undefined ||
        revision.approvalId === undefined ||
        revision.externalChangeEventId !== undefined)) ||
    (revision.source === "external-import" &&
      (revision.changeSetId !== undefined ||
        revision.approvalId !== undefined ||
        revision.externalChangeEventId === undefined ||
        revision.undoOfRevisionId !== undefined)) ||
    (revision.source === "baseline-rebuild" &&
      (revision.changeSetId !== undefined ||
        revision.approvalId !== undefined ||
        revision.externalChangeEventId !== undefined ||
        revision.undoOfRevisionId !== undefined))
  ) {
    throw new ContractPolicyError(
      "invalid-revision-origin",
      `Revision origin fields are inconsistent with '${revision.source}'.`,
    );
  }
}
