import type { CapabilityRegistry } from "./schemas.js";
import { validateContract } from "./validation.js";

export type CapabilityPolicyCode =
  | "duplicate-capability"
  | "duplicate-request"
  | "expansion-cycle"
  | "invalid-aggregate"
  | "not-permission"
  | "not-provide"
  | "runtime-grant-not-exact"
  | "unknown-capability";

export class CapabilityPolicyError extends Error {
  public constructor(
    public readonly code: CapabilityPolicyCode,
    message: string,
  ) {
    super(message);
    this.name = "CapabilityPolicyError";
  }
}

export const CORE_CAPABILITY_REGISTRY: CapabilityRegistry = {
  schemaVersion: 1,
  registryVersion: "1.0.0",
  capabilities: [
    {
      id: "story.read",
      kind: "permission",
      description: "Aggregate read access for accepted story content.",
      grantable: false,
      expandsTo: [
        "story.manuscript.read",
        "story.outline.read",
        "story.canon.read",
        "story.timeline.read",
      ],
    },
    {
      id: "story.manuscript.read",
      kind: "permission",
      description: "Read accepted manuscript resources.",
      grantable: true,
    },
    {
      id: "story.outline.read",
      kind: "permission",
      description: "Read accepted outline resources.",
      grantable: true,
    },
    {
      id: "story.canon.read",
      kind: "permission",
      description: "Read accepted canon resources.",
      grantable: true,
    },
    {
      id: "story.timeline.read",
      kind: "permission",
      description: "Read accepted timeline resources.",
      grantable: true,
    },
    {
      id: "draft.create",
      kind: "permission",
      description: "Create a candidate draft without publishing it.",
      grantable: true,
    },
    {
      id: "canon.propose",
      kind: "permission",
      description: "Create a candidate canon change.",
      grantable: true,
    },
    {
      id: "revision.publish",
      kind: "permission",
      description: "Publish an approved, conflict-checked ChangeSet.",
      grantable: true,
    },
    {
      id: "content.delete",
      kind: "permission",
      description: "Delete accepted content through an approved ChangeSet.",
      grantable: true,
    },
    {
      id: "batch.cross_scope",
      kind: "permission",
      description: "Produce candidate changes across multiple story scopes.",
      grantable: true,
    },
    {
      id: "network.external",
      kind: "permission",
      description: "Use a Kernel-brokered external network destination.",
      grantable: true,
    },
    {
      id: "model.paid",
      kind: "permission",
      description: "Use a paid model within an approved budget.",
      grantable: true,
    },
    {
      id: "filesystem.export",
      kind: "permission",
      description: "Write an approved export outside portable story paths.",
      grantable: true,
    },
    {
      id: "plugin.execute",
      kind: "permission",
      description: "Execute a plugin in an approved runtime tier.",
      grantable: true,
    },
    {
      id: "secret.use",
      kind: "permission",
      description: "Use a secret reference for one brokered operation.",
      grantable: true,
    },
    {
      id: "review.foreshadowing.analyze",
      kind: "provide",
      description: "Provide a foreshadowing analysis capability.",
      grantable: false,
    },
  ],
};

type CapabilityDefinition = CapabilityRegistry["capabilities"][number];

function buildIndex(
  registry: CapabilityRegistry,
): Map<string, CapabilityDefinition> {
  const contract = validateContract("capability-registry", registry);
  if (!contract.valid) {
    throw new TypeError(
      `Invalid Capability Registry: ${contract.errors.join("; ")}`,
    );
  }

  const index = new Map<string, CapabilityDefinition>();
  for (const capability of registry.capabilities) {
    if (index.has(capability.id)) {
      throw new CapabilityPolicyError(
        "duplicate-capability",
        `Capability '${capability.id}' is registered more than once.`,
      );
    }
    if (
      capability.kind !== "permission" &&
      capability.expandsTo !== undefined
    ) {
      throw new CapabilityPolicyError(
        "invalid-aggregate",
        `Provided capability '${capability.id}' cannot expand permissions.`,
      );
    }
    if (capability.grantable && capability.expandsTo !== undefined) {
      throw new CapabilityPolicyError(
        "invalid-aggregate",
        `Grantable capability '${capability.id}' cannot also be an aggregate.`,
      );
    }
    index.set(capability.id, capability);
  }
  return index;
}

export function assertCapabilityRegistry(registry: CapabilityRegistry): void {
  const index = buildIndex(registry);
  for (const capability of registry.capabilities) {
    if (capability.expandsTo !== undefined) {
      expandOne(capability.id, index, new Set());
    }
  }
}

function expandOne(
  id: string,
  index: ReadonlyMap<string, CapabilityDefinition>,
  visiting: Set<string>,
): readonly string[] {
  const definition = index.get(id);
  if (definition === undefined) {
    throw new CapabilityPolicyError(
      "unknown-capability",
      `Unknown capability '${id}'.`,
    );
  }
  if (definition.kind !== "permission") {
    throw new CapabilityPolicyError(
      "not-permission",
      `'${id}' is not a permission.`,
    );
  }
  if (visiting.has(id)) {
    throw new CapabilityPolicyError(
      "expansion-cycle",
      `Permission aggregate cycle contains '${id}'.`,
    );
  }
  if (definition.expandsTo === undefined) {
    if (!definition.grantable) {
      throw new CapabilityPolicyError(
        "invalid-aggregate",
        `Permission '${id}' is neither grantable nor expandable.`,
      );
    }
    return [id];
  }

  visiting.add(id);
  const result = definition.expandsTo.flatMap((child) =>
    expandOne(child, index, visiting),
  );
  visiting.delete(id);
  return result;
}

export function expandPermissionIds(
  registry: CapabilityRegistry,
  requestedIds: readonly string[],
): readonly string[] {
  const index = buildIndex(registry);
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new CapabilityPolicyError(
      "duplicate-request",
      "A permission may only be requested once.",
    );
  }
  const expanded = requestedIds.flatMap((id) =>
    expandOne(id, index, new Set()),
  );
  return [...new Set(expanded)].sort();
}

export function assertProvidedCapabilityIds(
  registry: CapabilityRegistry,
  providedIds: readonly string[],
): void {
  const index = buildIndex(registry);
  for (const id of providedIds) {
    const definition = index.get(id);
    if (definition === undefined) {
      throw new CapabilityPolicyError(
        "unknown-capability",
        `Unknown capability '${id}'.`,
      );
    }
    if (definition.kind !== "provide") {
      throw new CapabilityPolicyError(
        "not-provide",
        `'${id}' is not a provided capability.`,
      );
    }
  }
}

export function assertExpandedGrantSet(
  registry: CapabilityRegistry,
  runtimeGrantIds: readonly string[],
): void {
  const index = buildIndex(registry);
  if (new Set(runtimeGrantIds).size !== runtimeGrantIds.length) {
    throw new CapabilityPolicyError(
      "runtime-grant-not-exact",
      "Runtime grants must not contain duplicate identifiers.",
    );
  }
  for (const id of runtimeGrantIds) {
    const definition = index.get(id);
    if (
      definition === undefined ||
      definition.kind !== "permission" ||
      !definition.grantable ||
      definition.expandsTo !== undefined
    ) {
      throw new CapabilityPolicyError(
        "runtime-grant-not-exact",
        `Runtime grant '${id}' is not an expanded exact permission.`,
      );
    }
  }
}
