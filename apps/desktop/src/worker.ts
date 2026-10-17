import {
  AuthoringKernel,
  HttpModelProvider,
  ProviderNetworkBroker,
  validateProvider,
  type ProviderConfig,
  type SelectionScope,
} from "@novel-agent/kernel";
import { validateContract } from "@novel-agent/protocol";
import { getBuiltinSkill } from "@novel-agent/kernel/builtin-skills";
import { resolveAuthoringMode } from "@novel-agent/kernel/authoring-mode";
import { randomUUID } from "node:crypto";

interface ParentPort {
  on(
    event: "message",
    listener: (event: { data: Record<string, unknown> }) => void,
  ): void;
  postMessage(message: unknown): void;
}
const port = (process as unknown as { parentPort: ParentPort }).parentPort;
let kernel: AuthoringKernel | undefined;
let provider: ProviderConfig | undefined;
let running: Promise<void> | undefined;
const secrets = new Map<
  string,
  {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const secret = (baseUrl: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      secrets.delete(id);
      reject(new Error("密钥读取超时，请重新打开设置。"));
    }, 10_000);
    secrets.set(id, { resolve, reject, timer });
    port.postMessage({ kind: "secret-request", id, baseUrl });
  });
function requireKernel(): AuthoringKernel {
  if (!kernel) throw new Error("请先新建或打开作品。");
  return kernel;
}
function requireProvider(): HttpModelProvider {
  if (!provider) throw new Error("请先在设置中连接真实模型。");
  const config = provider;
  return new HttpModelProvider(
    config,
    new ProviderNetworkBroker(() => secret(config.baseUrl)),
  );
}
function text(p: Record<string, unknown>, key: string, max = 4000): string {
  const value = p[key];
  if (typeof value !== "string" || value.length > max)
    throw new Error(`参数 ${key} 无效。`);
  return value;
}
async function dispatch(
  method: string,
  p: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "provider.configure":
      if (running || secrets.size)
        throw new Error("请先暂停任务并等待当前调用结束，再修改模型设置。");
      provider = validateProvider(p.config);
      return { configured: true };
    case "provider.test": {
      const model = requireProvider();
      const result = await model.generate(
        [
          {
            role: "user",
            content:
              "连接检测：请调用 connection_check 工具，参数 ok 为 true。",
          },
        ],
        [
          {
            name: "connection_check",
            description: "验证函数工具调用能力",
            parameters: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false,
            },
          },
        ],
        new AbortController().signal,
        () => {},
      );
      if (
        !result.calls.some(
          (c) =>
            c.name === "connection_check" &&
            JSON.parse(c.arguments).ok === true,
        )
      )
        throw new Error("连接已建立，但未验证工具调用能力，请核对模型与协议。");
      return {
        connected: true,
        model: model.config.model,
        usage: result.usage,
      };
    }
    case "workspace.create":
    case "workspace.open": {
      if (running) throw new Error("请先暂停当前任务后再切换作品。");
      const next = new AuthoringKernel(
        text(p, "root"),
        method === "workspace.create",
      );
      let files;
      let imports;
      let importPreview;
      try {
        if (p.importFiles !== undefined) {
          if (method !== "workspace.create")
            throw new Error("导入只可由新建 / 导入作品入口执行。");
          imports = next.importRootFiles(p.importFiles);
        }
        files = next.files.list();
        if (method === "workspace.create" && p.importFiles === undefined)
          importPreview = next.files.rootImportPreview();
      } catch (error) {
        next.close();
        throw error;
      }
      kernel?.close();
      kernel = next;
      kernel.subscribe((event) =>
        port.postMessage({ jsonrpc: "2.0", method: "event", params: event }),
      );
      return {
        root: kernel.files.root,
        workspaceId: kernel.files.workspaceId,
        files,
        ...(imports ? { imports } : {}),
        ...(importPreview ? { importPreview } : {}),
      };
    }
    case "workspace.list":
      return requireKernel().files.list();
    case "workspace.read":
      return requireKernel().files.read(text(p, "path"));
    case "workspace.save":
      return requireKernel().save(
        text(p, "path"),
        text(p, "content", 1_000_000),
        p.baseHash === null ? null : text(p, "baseHash"),
      );
    case "workspace.export":
      return Array.from(requireKernel().files.exportZip());
    case "session.list":
      return requireKernel()
        .listSessions()
        .map(({ id, title, status, updatedAt }) => ({
          id,
          title,
          status,
          updatedAt,
        }));
    case "session.create":
      return requireKernel().createSession(
        typeof p.title === "string" ? p.title : undefined,
      );
    case "session.get":
    case "session.resume":
      return requireKernel().session(text(p, "sessionId"));
    case "event.subscribe":
      return requireKernel()
        .session(text(p, "sessionId"))
        .events.filter((e) => e.sequence > Number(p.afterSequence ?? 0));
    case "turn.start":
    case "turn.steer":
    case "task.retry": {
      if (running) throw new Error("请先暂停当前任务，再提交补充要求。");
      const current = requireKernel();
      const sessionId = text(p, "sessionId");
      const task = text(p, "task");
      const model = requireProvider();
      const selection = p.selection as SelectionScope | undefined;
      if (
        selection &&
        (typeof selection.path !== "string" ||
          typeof selection.baseHash !== "string" ||
          typeof selection.from !== "number" ||
          typeof selection.to !== "number")
      )
        throw new Error("选区参数无效。");
      current.validateTurn(sessionId, task, selection);
      if (p.readOnly !== undefined && typeof p.readOnly !== "boolean")
        throw new Error("只读模式参数无效。");
      const skill = getBuiltinSkill(p.skillId);
      const mode = resolveAuthoringMode(p.mode);
      const candidateScope = current.validateCandidateScope(p.candidateScope);
      current.validateBatch(
        mode,
        candidateScope,
        p.readOnly === true || skill?.readOnly === true,
        selection,
      );
      running = current
        .run(
          sessionId,
          task,
          model,
          typeof p.focusPath === "string" ? p.focusPath : undefined,
          selection,
          p.readOnly === true,
          skill?.id,
          mode,
          candidateScope,
        )
        .finally(() => {
          running = undefined;
        });
      void running.catch(() => {});
      return { started: true };
    }
    case "turn.interrupt":
    case "session.cancel":
      requireKernel().interrupt(text(p, "sessionId"));
      return { interrupted: true };
    case "proposal.get":
      return requireKernel().proposal(
        text(p, "sessionId"),
        text(p, "proposalId"),
      );
    case "proposal.accept":
      return requireKernel().accept(
        text(p, "sessionId"),
        text(p, "proposalId"),
      );
    case "proposal.reject":
      requireKernel().reject(text(p, "sessionId"), text(p, "proposalId"));
      return { rejected: true };
    case "proposal.revise": {
      const current = requireKernel();
      const original = current.proposal(
        text(p, "sessionId"),
        text(p, "proposalId"),
      );
      if (original.status !== "pending") throw new Error("此候选已经处理。");
      const replacement = current.propose(
        original.sessionId,
        original.path,
        text(p, "content", 150_000),
        original.changeSet.operations[0]!.baseHash,
        "作者调整后的候选",
      );
      current.reject(original.sessionId, original.id);
      return replacement;
    }
    case "revision.list":
      return requireKernel().revisions();
    case "revision.undo":
      return requireKernel().undo(text(p, "revisionId"));
    default:
      throw new Error("这个功能尚未开放。");
  }
}
port.on("message", ({ data }) => {
  if (data.kind === "secret-result") {
    const item = secrets.get(String(data.id));
    if (!item) return;
    clearTimeout(item.timer);
    secrets.delete(String(data.id));
    if (typeof data.value === "string") item.resolve(data.value);
    else item.reject(new Error("无法读取密钥，请重新配置。"));
    return;
  }
  void (async () => {
    const id = data.id ?? null;
    try {
      if (
        !validateContract("json-rpc-message", data).valid ||
        typeof data.method !== "string"
      )
        throw new Error("请求格式无效。");
      const result = await dispatch(
        data.method,
        (data.params ?? {}) as Record<string, unknown>,
      );
      port.postMessage({ jsonrpc: "2.0", id, result });
    } catch (error) {
      port.postMessage({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "操作未完成。",
        },
      });
    }
  })();
});
