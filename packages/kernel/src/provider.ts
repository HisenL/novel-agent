export interface ProviderConfig {
  protocol: "responses" | "chat-completions";
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
  maxSteps: number;
  timeoutSeconds: number;
  tools: boolean;
  privacy: "external-service" | "loopback";
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
}
export const DEFAULT_PROVIDER: ProviderConfig = {
  protocol: "responses",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  maxOutputTokens: 4096,
  maxSteps: 8,
  timeoutSeconds: 120,
  tools: true,
  privacy: "external-service",
};
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  calls?: ToolCall[];
  callId?: string;
}
export interface GenerationResult {
  text: string;
  calls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number } | null;
}
export interface AgentProvider {
  readonly config: ProviderConfig;
  generate(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<GenerationResult>;
}

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
const integer = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;

export function validateProvider(value: unknown): ProviderConfig {
  const input = object(value);
  if (input.protocol !== "responses" && input.protocol !== "chat-completions")
    throw new Error("请选择明确的模型接口协议。");
  const url = new URL(string(input.baseUrl));
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "模型地址必须为 HTTPS；仅本机服务允许 HTTP。地址不能含密钥或查询参数。",
    );
  if (url.hostname === "api.openai.com" && input.protocol !== "responses")
    throw new Error("OpenAI 官方服务请选择 Responses 协议。");
  const model = string(input.model).trim();
  if (!model || model.length > 200) throw new Error("请填写模型名称。");
  for (const [name, min, max] of [
    ["maxOutputTokens", 256, 16384],
    ["maxSteps", 1, 20],
    ["timeoutSeconds", 10, 600],
  ] as const) {
    if (
      typeof input[name] !== "number" ||
      !Number.isInteger(input[name]) ||
      (input[name] as number) < min ||
      (input[name] as number) > max
    )
      throw new Error(`${name} 超出允许范围。`);
  }
  if (input.tools !== true)
    throw new Error(
      "创作智能体需要模型支持函数工具调用；请确认服务能力后启用。",
    );
  const inputPrice = input.inputUsdPerMillion;
  const outputPrice = input.outputUsdPerMillion;
  if ((inputPrice === undefined) !== (outputPrice === undefined))
    throw new Error("请同时填写输入和输出 Token 单价，或同时留空。");
  for (const price of [inputPrice, outputPrice])
    if (
      price !== undefined &&
      (typeof price !== "number" ||
        !Number.isFinite(price) ||
        price < 0 ||
        price > 1_000_000)
    )
      throw new Error("每百万 Token 单价必须是 0 到 1000000 的美元金额。");
  return {
    protocol: input.protocol,
    baseUrl: url.toString().replace(/\/$/u, ""),
    model,
    maxOutputTokens: input.maxOutputTokens as number,
    maxSteps: input.maxSteps as number,
    timeoutSeconds: input.timeoutSeconds as number,
    tools: true,
    privacy: loopback ? "loopback" : "external-service",
    ...(inputPrice === undefined
      ? {}
      : {
          inputUsdPerMillion: inputPrice as number,
          outputUsdPerMillion: outputPrice as number,
        }),
  };
}

/** One approved destination, no redirects or provider-authored error text. */
export class ProviderNetworkBroker {
  constructor(
    private readonly acquireSecret: () => Promise<string>,
    private readonly request: typeof fetch = fetch,
  ) {}
  async post(
    config: ProviderConfig,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    let credential = await this.acquireSecret();
    if (!credential.trim())
      throw new Error("尚未保存模型密钥，请在设置中配置。");
    try {
      const response = await this.request(
        `${config.baseUrl}/${config.protocol === "responses" ? "responses" : "chat/completions"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credential}`,
          },
          body: JSON.stringify(body),
          redirect: "error",
          signal,
        },
      );
      if (!response.ok) {
        void response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new Error("模型服务拒绝认证，请检查密钥和模型权限。");
        if (response.status === 429)
          throw new Error("模型服务限流或额度不足，请稍后重试或检查账户。");
        throw new Error(
          `模型请求未成功（HTTP ${response.status}）。请核对协议、地址和模型能力。`,
        );
      }
      return response;
    } catch (error) {
      if (signal.aborted)
        throw new Error("模型请求已停止或超时；本次费用可能尚未确定。");
      if (error instanceof Error && error.message.startsWith("模型"))
        throw error;
      throw new Error("无法连接模型服务，请检查网络、地址或代理设置。");
    } finally {
      credential = "";
    }
  }
}

async function* readSse(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<Obj> {
  if (!response.body) throw new Error("模型服务未返回数据。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new Error("模型请求已停止。");
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error("模型响应超过大小限制。");
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf("\n");
      while (boundary >= 0) {
        const line = buffer.slice(0, boundary).replace(/\r$/u, "");
        buffer = buffer.slice(boundary + 1);
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data && data !== "[DONE]") {
            try {
              yield object(JSON.parse(data));
            } catch {
              throw new Error("模型返回了无法解析的流式数据。");
            }
          }
        }
        boundary = buffer.indexOf("\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class HttpModelProvider implements AgentProvider {
  readonly config: ProviderConfig;
  constructor(
    config: ProviderConfig,
    private readonly network: ProviderNetworkBroker,
  ) {
    this.config = validateProvider(config);
  }

  async generate(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<GenerationResult> {
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.timeoutSeconds * 1000),
    ]);
    const responses = this.config.protocol === "responses";
    const body = responses
      ? {
          model: this.config.model,
          store: false,
          stream: true,
          max_output_tokens: this.config.maxOutputTokens,
          input: messages.flatMap((message): unknown[] => {
            if (message.role === "tool")
              return [
                {
                  type: "function_call_output",
                  call_id: message.callId,
                  output: message.content,
                },
              ];
            const items: unknown[] = message.content
              ? [{ role: message.role, content: message.content }]
              : [];
            for (const call of message.calls ?? [])
              items.push({
                type: "function_call",
                call_id: call.id,
                name: call.name,
                arguments: call.arguments,
              });
            return items;
          }),
          tools: tools.map((tool) => ({
            type: "function",
            ...tool,
            strict: true,
          })),
          parallel_tool_calls: false,
        }
      : {
          model: this.config.model,
          stream: true,
          max_tokens: this.config.maxOutputTokens,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content || null,
            ...(message.callId ? { tool_call_id: message.callId } : {}),
            ...(message.calls?.length
              ? {
                  tool_calls: message.calls.map((call) => ({
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: call.arguments },
                  })),
                }
              : {}),
          })),
          tools: tools.map((tool) => ({
            type: "function",
            function: { ...tool, strict: true },
          })),
          stream_options: { include_usage: true },
        };
    const response = await this.network.post(this.config, body, requestSignal);
    let text = "";
    let completed = false;
    let usage: GenerationResult["usage"] = null;
    const calls = new Map<number, ToolCall>();
    try {
      for await (const event of readSse(response, requestSignal)) {
        if (responses) {
          if (event.type === "response.output_text.delta") {
            const delta = string(event.delta);
            text += delta;
            onText(delta);
          }
          if (event.type === "response.incomplete") {
            const reason = object(
              object(event.response).incomplete_details,
            ).reason;
            if (reason === "max_output_tokens")
              throw new Error(
                "模型达到每次输出上限，结果不完整。请在模型设置中提高输出上限，再手动继续任务；本次可能已计费，未生成正式修改。",
              );
            if (reason === "content_filter")
              throw new Error(
                "模型服务因内容限制停止输出。请调整创作要求后重试；本次可能已计费，未生成正式修改。",
              );
            throw new Error(
              "模型输出未完成，请检查输出上限或稍后重试；未生成正式修改。",
            );
          }
          if (event.type === "response.failed" || event.type === "error")
            throw new Error(
              "模型服务未能完成本次请求，请检查服务状态后手动重试；本次费用未知，未生成正式修改。",
            );
          if (event.type === "response.output_item.done") {
            const item = object(event.item);
            if (item.type === "function_call")
              calls.set(integer(event.output_index), {
                id: string(item.call_id),
                name: string(item.name),
                arguments: string(item.arguments),
              });
            if (array(item.content).some((c) => object(c).type === "refusal"))
              throw new Error("模型拒绝了本次请求。可以调整要求后重试。");
          }
          if (event.type === "response.completed") {
            completed = true;
            const value = object(object(event.response).usage);
            if (typeof value.input_tokens === "number")
              usage = {
                inputTokens: integer(value.input_tokens),
                outputTokens: integer(value.output_tokens),
              };
          }
        } else {
          const choice = object(array(event.choices)[0]);
          const delta = object(choice.delta);
          if (delta.refusal)
            throw new Error("模型拒绝了本次请求。可以调整要求后重试。");
          if (typeof delta.content === "string") {
            text += delta.content;
            onText(delta.content);
          }
          for (const raw of array(delta.tool_calls)) {
            const piece = object(raw);
            const fn = object(piece.function);
            const index = integer(piece.index);
            const call = calls.get(index) ?? {
              id: "",
              name: "",
              arguments: "",
            };
            call.id += string(piece.id);
            call.name += string(fn.name);
            call.arguments += string(fn.arguments);
            calls.set(index, call);
          }
          if (
            choice.finish_reason === "stop" ||
            choice.finish_reason === "tool_calls"
          )
            completed = true;
          else if (choice.finish_reason)
            throw new Error("模型输出被截断或未完成，请调整输出上限后重试。");
          const value = object(event.usage);
          if (typeof value.prompt_tokens === "number")
            usage = {
              inputTokens: integer(value.prompt_tokens),
              outputTokens: integer(value.completion_tokens),
            };
        }
      }
    } catch (error) {
      if (requestSignal.aborted)
        throw new Error("模型请求已停止或超时；本次费用可能尚未确定。");
      if (error instanceof Error && error.message.startsWith("模型"))
        throw error;
      throw new Error("模型连接中断，未收到完整结果；已保存的候选仍可审阅。");
    }
    if (!completed)
      throw new Error("模型流在完成前中断，本次调用费用未知；请确认后重试。");
    if (
      calls.size > 8 ||
      [...calls.values()].some(
        (c) => !c.id || !c.name || c.arguments.length > 150_000,
      )
    )
      throw new Error("模型工具调用超过限制或格式不完整。");
    return { text, calls: [...calls.values()], usage };
  }
}
