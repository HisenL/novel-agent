import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  AuthoringKernel,
  DEFAULT_PROVIDER,
  type AgentProvider,
} from "../src/index.js";

describe("scoped batch candidates", () => {
  it("resumes after restart without recreating pending candidates", async () => {
    const root = mkdtempSync(join(tmpdir(), "novel-batch-resume-"));
    let kernel = new AuthoringKernel(root, true);
    const first = "manuscript/main/chapter-1.md";
    const second = "manuscript/main/chapter-2.md";
    kernel.save(second, "第二章", null);
    const scope = [first, second].map((path) => ({
      path,
      baseHash: kernel.files.read(path).hash!,
    }));
    const session = kernel.createSession();
    let calls = 0;
    const provider: AgentProvider = {
      config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
      async generate() {
        calls++;
        return {
          text: "",
          usage: null,
          calls: [
            {
              id: `p-${calls}`,
              name: "propose_document",
              arguments: JSON.stringify({
                path: calls === 1 ? first : second,
                content: "候选",
                summary: "批量",
              }),
            },
          ],
        };
      },
    };
    await kernel.run(
      session.id,
      "生成两章候选",
      provider,
      first,
      undefined,
      false,
      undefined,
      "batch",
      scope,
    );
    const original = kernel.session(session.id).proposals[0]!.id;
    kernel.close();
    kernel = new AuthoringKernel(root);
    await kernel.run(
      session.id,
      "继续未完成文件",
      provider,
      second,
      undefined,
      false,
      undefined,
      "batch",
      scope,
    );
    expect(
      kernel.session(session.id).proposals.map((proposal) => proposal.path),
    ).toEqual([first, second]);
    expect(kernel.session(session.id).proposals[0]!.id).toBe(original);
    expect(kernel.session(session.id).events.at(-1)?.type).toBe(
      "turn.completed",
    );
    await kernel.run(
      session.id,
      "检查是否完成",
      provider,
      second,
      undefined,
      false,
      undefined,
      "batch",
      scope,
    );
    expect(calls).toBe(2);
    expect(kernel.files.read(first).hash).toBe(scope[0]!.baseHash);
    kernel.close();
  });
  it.each([
    "complete",
    "pause",
    "conflict",
    "duplicate",
    "budget",
    "provider-change",
  ])("stops safely: %s", async (scenario) => {
    const kernel = new AuthoringKernel(
      mkdtempSync(join(tmpdir(), "novel-batch-")),
      true,
    );
    const paths = [
      "manuscript/main/chapter-1.md",
      "manuscript/main/chapter-2.md",
    ];
    kernel.save(paths[1]!, "第二章原稿", null);
    const scope = paths.map((path) => ({
      path,
      baseHash: kernel.files.read(path).hash!,
    }));
    const session = kernel.createSession("批量验收");
    const revisions = kernel.revisions().length;
    let calls = 0;
    const provider: AgentProvider = {
      config: {
        ...DEFAULT_PROVIDER,
        model: "batch-fixture",
        maxSteps: scenario === "budget" ? 2 : 5,
      },
      async generate(_messages, tools) {
        calls++;
        expect(tools.some((tool) => tool.name === "pause_for_author")).toBe(
          true,
        );
        if (calls === 1)
          return {
            text: "",
            usage: null,
            calls: [
              {
                id: "read",
                name: "read_document",
                arguments: JSON.stringify({ path: paths[1] }),
              },
            ],
          };
        if (scenario === "conflict" && calls === 3)
          writeFileSync(join(kernel.files.root, paths[1]!), "外部修改");
        if (scenario === "provider-change") provider.config.model = "changed";
        const path =
          calls === 2 || scenario === "duplicate" ? paths[0] : paths[1];
        const intents = [
          {
            id: `proposal-${calls}`,
            name: "propose_document",
            arguments: JSON.stringify({
              path,
              content: `候选 ${calls}`,
              summary: "批量草稿",
            }),
          },
        ];
        if (scenario === "pause")
          intents.push({
            id: "pause",
            name: "pause_for_author",
            arguments: JSON.stringify({
              reason: "两章人物动机矛盾，请作者选择。",
            }),
          });
        return { text: "", usage: null, calls: intents };
      },
    };
    await expect(
      kernel.run(
        session.id,
        "批量写作",
        provider,
        paths[0],
        undefined,
        false,
        undefined,
        "batch",
      ),
    ).rejects.toThrow("必须明确");
    expect(calls).toBe(0);
    await kernel.run(
      session.id,
      "批量写作",
      provider,
      paths[0],
      undefined,
      false,
      undefined,
      "batch",
      scope,
    );
    const result = kernel.session(session.id);
    const expected =
      scenario === "complete"
        ? 2
        : ["pause", "provider-change"].includes(scenario)
          ? 0
          : 1;
    expect(result.proposals).toHaveLength(expected);
    expect(
      result.proposals.every((proposal) => proposal.status === "pending"),
    ).toBe(true);
    expect(kernel.revisions()).toHaveLength(revisions);
    expect(kernel.files.read(paths[0]!).content).toBe("# 第一章\n\n");
    expect(kernel.files.read(paths[1]!).content).toBe(
      scenario === "conflict" ? "外部修改" : "第二章原稿",
    );
    expect(result.events.at(-1)?.type).toBe(
      scenario === "complete"
        ? "turn.completed"
        : scenario === "budget"
          ? "budget.paused"
          : "turn.interrupted",
    );
    expect(calls).toBeLessThanOrEqual(3);
    kernel.close();
  });
});
