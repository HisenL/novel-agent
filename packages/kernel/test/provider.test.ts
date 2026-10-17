import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROVIDER,
  HttpModelProvider,
  ProviderNetworkBroker,
  validateProvider,
} from "../src/provider.js";

const response = (events: unknown[]): Response =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
describe("real provider protocol adapters", () => {
  it.each([
    ["response.incomplete", "max_output_tokens", "提高输出上限"],
    ["response.incomplete", "content_filter", "内容限制"],
    ["response.incomplete", "private-provider-reason", "模型输出未完成"],
    ["response.failed", "private-provider-reason", "检查服务状态"],
    ["error", "private-provider-reason", "检查服务状态"],
  ])(
    "explains %s / %s without exposing provider diagnostics",
    async (type, reason, message) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        response([
          {
            type,
            response: {
              incomplete_details: { reason },
              error: { message: "private-provider-diagnostic" },
            },
          },
        ]),
      );
      const provider = new HttpModelProvider(
        { ...DEFAULT_PROVIDER, model: "configured-model" },
        new ProviderNetworkBroker(async () => "test-credential", request),
      );
      const error = await provider
        .generate([], [], new AbortController().signal, () => {})
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(message);
      expect((error as Error).message).not.toContain("private-provider");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("sends Responses with store:false and preserves tool calls without hidden reasoning", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response([
        { type: "response.output_text.delta", delta: "已了解。" },
        { type: "response.reasoning_text.delta", delta: "private" },
        {
          type: "response.output_item.done",
          output_index: 1,
          item: {
            type: "function_call",
            call_id: "call1",
            name: "read_document",
            arguments: '{"path":"story.yaml"}',
          },
        },
        {
          type: "response.completed",
          response: { usage: { input_tokens: 10, output_tokens: 20 } },
        },
      ]),
    );
    const provider = new HttpModelProvider(
      { ...DEFAULT_PROVIDER, model: "configured-model" },
      new ProviderNetworkBroker(async () => "test-credential", request),
    );
    const texts: string[] = [];
    const result = await provider.generate(
      [{ role: "user", content: "读取设定" }],
      [],
      new AbortController().signal,
      (t) => texts.push(t),
    );
    const body = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(request.mock.calls[0]![1]!.redirect).toBe("error");
    expect(result.text).toBe("已了解。");
    expect(result.calls[0]!.name).toBe("read_document");
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("assembles Chat Completions fragmented function arguments", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call1",
                    function: {
                      name: "read_document",
                      arguments: '{"path":',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '"story.yaml"}' } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    );
    const provider = new HttpModelProvider(
      {
        ...DEFAULT_PROVIDER,
        protocol: "chat-completions",
        baseUrl: "https://example.test/v1",
        model: "configured-model",
      },
      new ProviderNetworkBroker(async () => "test-credential", request),
    );
    const result = await provider.generate(
      [],
      [],
      new AbortController().signal,
      () => {},
    );
    expect(JSON.parse(result.calls[0]!.arguments)).toEqual({
      path: "story.yaml",
    });
    expect(result.usage).toBeNull();
  });
  it("does not return provider error bodies or pretend truncated output is complete", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("sensitive-provider-body", { status: 401 }),
      );
    const provider = new HttpModelProvider(
      { ...DEFAULT_PROVIDER, model: "configured-model" },
      new ProviderNetworkBroker(async () => "test-credential", request),
    );
    await expect(
      provider.generate([], [], new AbortController().signal, () => {}),
    ).rejects.toThrow("拒绝认证");
    request.mockResolvedValue(
      response([{ type: "response.output_text.delta", delta: "不完整" }]),
    );
    await expect(
      provider.generate([], [], new AbortController().signal, () => {}),
    ).rejects.toThrow("中断");
  });
  it("requires explicit protocol, safe endpoint and model capability", () => {
    for (const baseUrl of [
      "http://example.com/v1",
      "https://user:password@example.com/v1",
      "https://example.com/v1?key=value",
    ])
      expect(() =>
        validateProvider({ ...DEFAULT_PROVIDER, baseUrl, model: "model" }),
      ).toThrow();
    expect(() =>
      validateProvider({ ...DEFAULT_PROVIDER, model: "model", tools: false }),
    ).toThrow("工具调用");
  });
  it("accepts only paired finite user-entered token prices", () => {
    const base = { ...DEFAULT_PROVIDER, model: "model" };
    expect(
      validateProvider({
        ...base,
        inputUsdPerMillion: 0.25,
        outputUsdPerMillion: 1.5,
      }),
    ).toMatchObject({ inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5 });
    for (const pricing of [
      { inputUsdPerMillion: 0.25 },
      { inputUsdPerMillion: -1, outputUsdPerMillion: 1 },
      { inputUsdPerMillion: Number.POSITIVE_INFINITY, outputUsdPerMillion: 1 },
      { inputUsdPerMillion: 1, outputUsdPerMillion: "1" },
    ])
      expect(() => validateProvider({ ...base, ...pricing })).toThrow();
    expect(validateProvider(base).inputUsdPerMillion).toBeUndefined();
  });
});
