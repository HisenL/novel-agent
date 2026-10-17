import { type Static, Type, type TSchema } from "@sinclair/typebox";

const SCHEMA_BASE = "https://novel-agent.dev/schemas/v1";
const ContractId = Type.String({ minLength: 1, maxLength: 128 });
const Timestamp = Type.String({ format: "date-time" });
const ContentHash = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
const ResourcePath = Type.String({ minLength: 1, maxLength: 1024 });
const CapabilityId = Type.String({
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
  maxLength: 160,
});

const ActorSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("user"),
      Type.Literal("agent"),
      Type.Literal("tool"),
      Type.Literal("system"),
    ]),
    id: Type.Optional(ContractId),
  },
  { additionalProperties: false },
);

const MoneySchema = Type.Object(
  {
    amount: Type.Number({ minimum: 0 }),
    currency: Type.String({ pattern: "^[A-Z]{3}$" }),
  },
  { additionalProperties: false },
);

export const EventEnvelopeSchema = Type.Object(
  {
    eventId: ContractId,
    streamId: ContractId,
    sequence: Type.Integer({ minimum: 1 }),
    type: Type.String({ minLength: 1, maxLength: 160 }),
    schemaVersion: Type.Integer({ minimum: 1 }),
    timestamp: Timestamp,
    actor: ActorSchema,
    correlationId: ContractId,
    causationId: Type.Optional(ContractId),
    visibility: Type.Union([
      Type.Literal("author"),
      Type.Literal("advanced"),
      Type.Literal("developer"),
      Type.Literal("secret"),
    ]),
    payload: Type.Unknown(),
    usage: Type.Optional(
      Type.Object(
        {
          inputTokens: Type.Integer({ minimum: 0 }),
          outputTokens: Type.Integer({ minimum: 0 }),
          cachedTokens: Type.Integer({ minimum: 0 }),
          cost: Type.Optional(MoneySchema),
        },
        { additionalProperties: false },
      ),
    ),
  },
  {
    $id: `${SCHEMA_BASE}/event-envelope.schema.json`,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

export const CapabilityRegistrySchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    registryVersion: Type.String({ pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }),
    capabilities: Type.Array(
      Type.Object(
        {
          id: CapabilityId,
          kind: Type.Union([
            Type.Literal("permission"),
            Type.Literal("provide"),
          ]),
          description: Type.String({ minLength: 1, maxLength: 500 }),
          grantable: Type.Boolean(),
          expandsTo: Type.Optional(
            Type.Array(CapabilityId, { minItems: 1, uniqueItems: true }),
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  {
    $id: `${SCHEMA_BASE}/capability-registry.schema.json`,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

const PermissionScopeSchema = Type.Object(
  {
    resourcePaths: Type.Optional(
      Type.Array(ResourcePath, { minItems: 1, uniqueItems: true }),
    ),
    externalDestinations: Type.Optional(
      Type.Array(Type.String({ format: "uri" }), {
        minItems: 1,
        uniqueItems: true,
      }),
    ),
    contentDescription: Type.Optional(
      Type.String({ minLength: 1, maxLength: 1000 }),
    ),
    costCeiling: Type.Optional(MoneySchema),
  },
  { additionalProperties: false },
);

export const PermissionRequestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    requestId: ContractId,
    requestedCapabilities: Type.Array(CapabilityId, {
      minItems: 1,
      uniqueItems: true,
    }),
    requestedBy: ActorSchema,
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
    scope: PermissionScopeSchema,
    createdAt: Timestamp,
  },
  {
    $id: `${SCHEMA_BASE}/permission-request.schema.json`,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

export const PermissionDecisionSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    decisionId: ContractId,
    requestId: ContractId,
    outcome: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
    expandedPermissions: Type.Array(CapabilityId, { uniqueItems: true }),
    decidedBy: Type.Object(
      {
        kind: Type.Union([Type.Literal("user"), Type.Literal("system")]),
        id: Type.Optional(ContractId),
      },
      { additionalProperties: false },
    ),
    policyVersion: Type.String({ minLength: 1, maxLength: 64 }),
    decidedAt: Timestamp,
  },
  {
    $id: `${SCHEMA_BASE}/permission-decision.schema.json`,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

const ChangeOperationSchema = Type.Object(
  {
    operationId: ContractId,
    kind: Type.Union([
      Type.Literal("create"),
      Type.Literal("replace"),
      Type.Literal("delete"),
    ]),
    resourcePath: ResourcePath,
    baseHash: Type.Union([ContentHash, Type.Null()]),
    resultHash: Type.Union([ContentHash, Type.Null()]),
    candidateRef: Type.Optional(ContractId),
  },
  { additionalProperties: false },
);

export const ChangeSetSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    changeSetId: ContractId,
    workspaceId: ContractId,
    summary: Type.String({ minLength: 1, maxLength: 500 }),
    rationale: Type.String({ minLength: 1, maxLength: 4000 }),
    expectedEffect: Type.String({ minLength: 1, maxLength: 2000 }),
    scope: Type.Object(
      {
        resourcePaths: Type.Array(ResourcePath, {
          minItems: 1,
          uniqueItems: true,
        }),
        crossScope: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    evidence: Type.Array(
      Type.Object(
        {
          resourcePath: ResourcePath,
          contentHash: ContentHash,
        },
        { additionalProperties: false },
      ),
    ),
    risks: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), {
      uniqueItems: true,
    }),
    alternatives: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), {
      uniqueItems: true,
    }),
    estimatedBudget: Type.Object(
      {
        maxInputTokens: Type.Integer({ minimum: 0 }),
        maxOutputTokens: Type.Integer({ minimum: 0 }),
        maxCost: Type.Optional(MoneySchema),
      },
      { additionalProperties: false },
    ),
    operations: Type.Array(ChangeOperationSchema, { minItems: 1 }),
    createdAt: Timestamp,
    createdBy: ActorSchema,
  },
  {
    $id: `${SCHEMA_BASE}/change-set.schema.json`,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

export const RevisionSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    revisionId: ContractId,
    workspaceId: ContractId,
    source: Type.Union([
      Type.Literal("changeset"),
      Type.Literal("external-import"),
      Type.Literal("baseline-rebuild"),
    ]),
    changeSetId: Type.Optional(ContractId),
    approvalId: Type.Optional(ContractId),
    externalChangeEventId: Type.Optional(ContractId),
    previousRevisionIds: Type.Array(ContractId, { uniqueItems: true }),
    resources: Type.Array(
      Type.Object(
        {
          resourcePath: ResourcePath,
          previousHash: Type.Union([ContentHash, Type.Null()]),
          contentHash: Type.Union([ContentHash, Type.Null()]),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    undoOfRevisionId: Type.Optional(ContractId),
    idempotencyKey: ContractId,
    publishedAt: Timestamp,
  },
  {
    $id: `${SCHEMA_BASE}/revision.schema.json`,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

const PluginEntrypointsSchema = Type.Object(
  {
    skills: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
    schemas: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
    renderers: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
    tools: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
    hooks: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
    providers: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
    evaluators: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
    exporters: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
    contexts: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
    runtimes: Type.Optional(Type.Array(ResourcePath, { uniqueItems: true })),
  },
  { additionalProperties: false },
);

export const PluginManifestSchema = Type.Object(
  {
    manifestVersion: Type.Literal("1"),
    id: Type.String({
      pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)+$",
      maxLength: 200,
    }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    version: Type.String({
      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$",
    }),
    license: Type.String({ minLength: 1, maxLength: 100 }),
    novelAgent: Type.String({ minLength: 1, maxLength: 100 }),
    executionTier: Type.Union([
      Type.Literal("declarative"),
      Type.Literal("trusted"),
      Type.Literal("isolated"),
    ]),
    entrypoints: PluginEntrypointsSchema,
    provides: Type.Array(CapabilityId, { uniqueItems: true }),
    permissions: Type.Array(CapabilityId, { uniqueItems: true }),
    network: Type.Object(
      {
        default: Type.Literal("deny"),
        allow: Type.Array(Type.String({ format: "hostname" }), {
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
    configSchema: Type.Optional(ResourcePath),
    compatibility: Type.Object(
      {
        protocol: Type.String({ minLength: 1, maxLength: 50 }),
        proposal: Type.String({ minLength: 1, maxLength: 50 }),
        workspace: Type.String({ minLength: 1, maxLength: 50 }),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: `${SCHEMA_BASE}/plugin-manifest.schema.json`,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
  },
);

export const SESSION_PROTOCOL_VERSION = "1.1";

export const SESSION_METHODS = [
  "session.create",
  "session.resume",
  "session.fork",
  "session.cancel",
  "turn.start",
  "turn.steer",
  "turn.interrupt",
  "approval.resolve",
  "proposal.accept",
  "proposal.reject",
  "proposal.revise",
  "task.retry",
  "event.subscribe",
  "workspace.create",
  "workspace.open",
  "workspace.list",
  "workspace.read",
  "workspace.save",
  "workspace.export",
  "provider.configure",
  "provider.status",
  "provider.test",
  "session.list",
  "session.get",
  "proposal.get",
  "revision.list",
  "revision.undo",
] as const;

const JsonRpcIdSchema = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Number(),
]);
const SessionMethodSchema = Type.Union(
  SESSION_METHODS.map((method) => Type.Literal(method)),
);
const JsonRpcRequestSchema = Type.Object(
  {
    jsonrpc: Type.Literal("2.0"),
    id: JsonRpcIdSchema,
    method: SessionMethodSchema,
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);
const JsonRpcSuccessSchema = Type.Object(
  {
    jsonrpc: Type.Literal("2.0"),
    id: JsonRpcIdSchema,
    result: Type.Unknown(),
  },
  { additionalProperties: false },
);
const JsonRpcErrorSchema = Type.Object(
  {
    jsonrpc: Type.Literal("2.0"),
    id: Type.Union([JsonRpcIdSchema, Type.Null()]),
    error: Type.Object(
      {
        code: Type.Integer(),
        message: Type.String({ minLength: 1 }),
        data: Type.Optional(Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const EventNotificationSchema = Type.Object(
  {
    jsonrpc: Type.Literal("2.0"),
    method: Type.Literal("event"),
    params: EventEnvelopeSchema,
  },
  { additionalProperties: false },
);

export const JsonRpcMessageSchema = Type.Union(
  [
    JsonRpcRequestSchema,
    JsonRpcSuccessSchema,
    JsonRpcErrorSchema,
    EventNotificationSchema,
  ],
  {
    $id: `${SCHEMA_BASE}/json-rpc-message.schema.json`,
    $schema: "https://json-schema.org/draft/2020-12/schema",
  },
);

export const schemaCatalog = {
  "capability-registry": CapabilityRegistrySchema,
  "change-set": ChangeSetSchema,
  "event-envelope": EventEnvelopeSchema,
  "json-rpc-message": JsonRpcMessageSchema,
  "permission-decision": PermissionDecisionSchema,
  "permission-request": PermissionRequestSchema,
  "plugin-manifest": PluginManifestSchema,
  revision: RevisionSchema,
} satisfies Record<string, TSchema>;

export type SchemaName = keyof typeof schemaCatalog;
export type EventEnvelope = Static<typeof EventEnvelopeSchema>;
export type CapabilityRegistry = Static<typeof CapabilityRegistrySchema>;
export type PermissionRequest = Static<typeof PermissionRequestSchema>;
export type PermissionDecision = Static<typeof PermissionDecisionSchema>;
export type ChangeSet = Static<typeof ChangeSetSchema>;
export type Revision = Static<typeof RevisionSchema>;
export type PluginManifest = Static<typeof PluginManifestSchema>;
export type JsonRpcMessage = Static<typeof JsonRpcMessageSchema>;
