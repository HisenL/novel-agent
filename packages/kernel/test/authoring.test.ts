import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { BUILTIN_SKILLS, getBuiltinSkill } from "../src/builtin-skills.js";
import { describe, expect, it } from "vitest";
import {
  AuthoringKernel,
  PermissionBroker,
  type AgentProvider,
  DEFAULT_PROVIDER,
} from "../src/index.js";

const create = (): AuthoringKernel =>
  new AuthoringKernel(mkdtempSync(join(tmpdir(), "novel-authoring-")), true);
const chapter = "manuscript/main/chapter-1.md";

describe("author-controlled desktop authoring", () => {
  it("records a per-call cost estimate from configured rates and known usage", async () => {
    const kernel = create();
    const session = kernel.createSession();
    await kernel.run(session.id, "讨论故事", {
      config: {
        ...DEFAULT_PROVIDER,
        model: "priced-fixture",
        maxSteps: 1,
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 2,
      },
      async generate() {
        return {
          text: "讨论完成",
          usage: { inputTokens: 2000, outputTokens: 500 },
          calls: [],
        };
      },
    });
    const cost = kernel
      .session(session.id)
      .events.find((event) => event.type === "model.completed")?.payload as {
      cost: unknown;
    };
    expect(cost.cost).toEqual({
      amount: 0.002,
      currency: "USD",
      basis: "user-configured-pricing",
    });
    kernel.close();
  });
  it("proposes one exact local replacement while preserving all surrounding manuscript", async () => {
    const kernel = create();
    const originalText =
      "# 第一章\n\n“副本今天不出库。”\n\n" + "后文不变。".repeat(100);
    kernel.save(chapter, originalText, kernel.files.read(chapter).hash);
    const original = kernel.files.read(chapter);
    const session = kernel.createSession();
    await kernel.run(session.id, "只改这一句对白", {
      config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
      async generate(_messages, tools) {
        expect(tools.map((item) => item.name)).toContain("propose_replacement");
        return {
          text: "",
          usage: null,
          calls: [
            {
              id: "read",
              name: "read_document",
              arguments: JSON.stringify({ path: chapter }),
            },
            {
              id: "replace",
              name: "propose_replacement",
              arguments: JSON.stringify({
                path: chapter,
                oldText: "“副本今天不出库。”",
                newText: "“副本今日不出库。”",
                summary: "润色对白",
              }),
            },
          ],
        };
      },
    });
    const result = kernel.session(session.id);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.after).toBe(
      originalText.replace("“副本今天不出库。”", "“副本今日不出库。”"),
    );
    expect(kernel.files.read(chapter)).toEqual(original);
    kernel.accept(session.id, result.proposals[0]!.id);
    expect(kernel.files.read(chapter).content).toBe(result.proposals[0]?.after);
    kernel.close();
  });
  it("rejects ambiguous exact replacements and omits the tool in read-only turns", async () => {
    const kernel = create();
    kernel.save(chapter, "重复句。\n重复句。", kernel.files.read(chapter).hash);
    const original = kernel.files.read(chapter);
    const session = kernel.createSession();
    await kernel.run(session.id, "只改一句", {
      config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
      async generate() {
        return {
          text: "",
          usage: null,
          calls: [
            {
              id: "read",
              name: "read_document",
              arguments: JSON.stringify({ path: chapter }),
            },
            {
              id: "replace",
              name: "propose_replacement",
              arguments: JSON.stringify({
                path: chapter,
                oldText: "重复句。",
                newText: "新句。",
                summary: "修改",
              }),
            },
          ],
        };
      },
    });
    expect(kernel.session(session.id).status).toBe("failed");
    expect(kernel.session(session.id).proposals).toHaveLength(0);
    expect(kernel.files.read(chapter)).toEqual(original);
    const review = kernel.createSession();
    await kernel.run(
      review.id,
      "只读",
      {
        config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
        async generate(_messages, tools) {
          expect(tools.map((item) => item.name)).not.toContain(
            "propose_replacement",
          );
          return { text: "无修改", usage: null, calls: [] };
        },
      },
      chapter,
      undefined,
      true,
    );
    expect(kernel.session(review.id).status).toBe("completed");
    kernel.close();
  });
  it("rejects a dialogue snippet submitted as an entire existing chapter", async () => {
    const kernel = create();
    const originalText = "# 第一章\n\n" + "原有段落。".repeat(100);
    kernel.save(chapter, originalText, kernel.files.read(chapter).hash);
    const original = kernel.files.read(chapter);
    const session = kernel.createSession();
    await kernel.run(session.id, "只润色开头对白，其他段落不变", {
      config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
      async generate() {
        return {
          text: "",
          usage: null,
          calls: [
            {
              id: "read",
              name: "read_document",
              arguments: JSON.stringify({ path: chapter }),
            },
            {
              id: "propose",
              name: "propose_document",
              arguments: JSON.stringify({
                path: chapter,
                content: "“改过的对白。”",
                summary: "只改开头",
              }),
            },
          ],
        };
      },
    });
    const result = kernel.session(session.id);
    expect(result.status).toBe("failed");
    expect(result.proposals).toHaveLength(0);
    expect(JSON.stringify(result.events)).toContain("可能只提交了片段");
    expect(kernel.files.read(chapter)).toEqual(original);
    kernel.close();
  });
  it("does not grant a candidate baseline from truncated recovered context", async () => {
    const kernel = create();
    const root = kernel.files.root;
    const path = "outline/long-recovery.md";
    kernel.save(path, "长资料".repeat(12_000) + "全文末尾标记", null);
    const original = kernel.files.read(path);
    const session = kernel.createSession();
    await kernel.run(session.id, "读取长资料", {
      config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
      async generate() {
        return {
          text: "",
          usage: null,
          calls: [
            {
              id: "read",
              name: "read_document",
              arguments: JSON.stringify({ path }),
            },
          ],
        };
      },
    });
    kernel.close();
    const reopened = new AuthoringKernel(root);
    try {
      let context = "";
      await reopened.run(session.id, "继续", {
        config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
        async generate(messages) {
          context = JSON.stringify(messages);
          return {
            text: "",
            usage: null,
            calls: [
              {
                id: "unsafe-proposal",
                name: "propose_document",
                arguments: JSON.stringify({
                  path,
                  content: "不完整替换",
                  summary: "测试",
                }),
              },
            ],
          };
        },
      });
      expect(context).toContain("仅节选，未完整加载");
      expect(context).not.toContain("全文末尾标记");
      expect(reopened.session(session.id).proposals).toHaveLength(0);
      expect(JSON.stringify(reopened.session(session.id).events)).toContain(
        "修改前必须通过工具完整读取文件",
      );
      expect(reopened.files.read(path)).toEqual(original);
    } finally {
      reopened.close();
    }
  });
  it("restores only eight distinct recent reads after restart", async () => {
    const kernel = create();
    const root = kernel.files.root;
    const paths = Array.from(
      { length: 10 },
      (_, i) => `outline/bounded-${i}.md`,
    );
    for (const [i, path] of paths.entries())
      kernel.save(path, `unique-marker-${i}-end`, null);
    const session = kernel.createSession();
    await kernel.run(session.id, "读取资料", {
      config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
      async generate() {
        return {
          text: "",
          usage: null,
          calls: [...paths, paths[9]!].map((path, i) => ({
            id: `read-${i}`,
            name: "read_document",
            arguments: JSON.stringify({ path }),
          })),
        };
      },
    });
    expect(kernel.session(session.id).status).toBe("paused");
    kernel.close();
    const reopened = new AuthoringKernel(root);
    try {
      let context = "";
      await reopened.run(session.id, "继续分析", {
        config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
        async generate(messages) {
          context = JSON.stringify(messages);
          return { text: "分析完成", calls: [], usage: null };
        },
      });
      expect(reopened.session(session.id).status).toBe("completed");
      for (let i = 0; i < 10; i++) {
        if (i < 2) expect(context).not.toContain(`unique-marker-${i}-end`);
        else expect(context).toContain(`unique-marker-${i}-end`);
      }
      expect(reopened.session(session.id).proposals).toHaveLength(0);
    } finally {
      reopened.close();
    }
  });
  it.each([false, true])(
    "rehydrates a prior read after restart with current hashes: changed=%s",
    async (changed) => {
      const kernel = create();
      const root = kernel.files.root;
      const path = "outline/recovery.md";
      kernel.save(path, "旧计划线索", null);
      const session = kernel.createSession();
      await kernel.run(session.id, "读取计划", {
        config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
        async generate() {
          return {
            text: "",
            usage: null,
            calls: [
              {
                id: "read",
                name: "read_document",
                arguments: JSON.stringify({ path }),
              },
            ],
          };
        },
      });
      kernel.close();
      if (changed) writeFileSync(join(root, path), "新的计划线索");
      const reopened = new AuthoringKernel(root);
      try {
        await reopened.run(session.id, "继续分析", {
          config: { ...DEFAULT_PROVIDER, model: "fixture", maxSteps: 1 },
          async generate(messages) {
            const content = JSON.stringify(messages);
            expect(content).toContain(changed ? "新的计划线索" : "旧计划线索");
            expect(content).toContain(changed ? "哈希已改变" : "哈希未变");
            if (changed) expect(content).not.toContain("旧计划线索");
            return { text: "分析已完成。", calls: [], usage: null };
          },
        });
        const result = reopened.session(session.id);
        expect(result.status).toBe("completed");
        const receipt = result.events
          .filter((e) => e.type === "context.compiled")
          .at(-1)!;
        expect(JSON.stringify(receipt.payload)).toContain(
          reopened.files.read(path).hash,
        );
        expect(result.proposals).toHaveLength(0);
      } finally {
        reopened.close();
      }
    },
  );
  it("preserves candidates across a provider failure and restart without automatic retry", async () => {
    const kernel = create();
    const root = kernel.files.root;
    const session = kernel.createSession();
    const original = kernel.files.read(chapter);
    const candidate = kernel.propose(
      session.id,
      chapter,
      "待审正文",
      original.hash,
      "已有候选",
    );
    let calls = 0;
    const failing: AgentProvider = {
      config: { ...DEFAULT_PROVIDER, model: "interruption-fixture" },
      async generate() {
        calls++;
        throw new Error("网络连接中断");
      },
    };
    await kernel.run(session.id, "检查已有候选", failing, chapter);
    expect(calls).toBe(1);
    expect(kernel.session(session.id).status).toBe("failed");
    kernel.close();
    const reopened = new AuthoringKernel(root);
    try {
      expect(calls).toBe(1);
      expect(reopened.session(session.id).status).toBe("failed");
      expect(reopened.session(session.id).proposals[0]?.id).toBe(candidate.id);
      expect(reopened.files.read(chapter)).toEqual(original);
      await reopened.run(
        session.id,
        "继续检查，不提交修改",
        {
          config: failing.config,
          async generate(messages) {
            calls++;
            expect(JSON.stringify(messages)).toContain("待审正文");
            return { text: "已有候选仍待作者审阅。", calls: [], usage: null };
          },
        },
        chapter,
      );
      expect(calls).toBe(2);
      const restored = reopened.session(session.id);
      expect(restored.status).toBe("awaiting_approval");
      expect(restored.proposals).toHaveLength(1);
      expect(
        restored.events.filter((event) => event.type === "model.started"),
      ).toHaveLength(2);
      expect(
        restored.events.filter((event) => event.type === "model.completed"),
      ).toHaveLength(1);
      expect(reopened.files.read(chapter)).toEqual(original);
    } finally {
      reopened.close();
    }
  });
  it.each([false, true])(
    "requires explicit absent-path baseline for new plans: %s",
    async (readTarget) => {
      const kernel = create();
      try {
        const session = kernel.createSession();
        const path = "outline/new-plan.md";
        let calls = 0;
        const provider: AgentProvider = {
          config: { ...DEFAULT_PROVIDER, model: "new-plan-fixture" },
          async generate(_messages, tools) {
            expect(
              tools.find((tool) => tool.name === "read_document")?.description,
            ).toContain("新建文件也必须");
            expect(
              tools.find((tool) => tool.name === "propose_document")
                ?.description,
            ).toContain("list_documents 不能替代");
            calls++;
            return {
              text: "",
              usage: null,
              calls: [
                {
                  id: `call-${calls}`,
                  name:
                    calls === 1
                      ? readTarget
                        ? "read_document"
                        : "list_documents"
                      : "propose_document",
                  arguments: JSON.stringify(
                    calls === 1
                      ? readTarget
                        ? { path }
                        : {}
                      : {
                          path,
                          content: "# 三章计划\n\n以下为待确认建议。",
                          summary: "新规划",
                        },
                  ),
                },
              ],
            };
          },
        };
        await kernel.run(session.id, "创建计划候选", provider);
        const result = kernel.session(session.id);
        expect(result.proposals).toHaveLength(readTarget ? 1 : 0);
        expect(result.status).toBe(readTarget ? "awaiting_approval" : "failed");
        expect(kernel.files.read(path).hash).toBeNull();
        expect(kernel.revisions()).toHaveLength(0);
      } finally {
        kernel.close();
      }
    },
  );
  it.each(["outside", "changed", "allowed"])(
    "enforces candidate file scope: %s",
    async (scenario) => {
      const kernel = create();
      const session = kernel.createSession();
      const before = kernel.files.read(chapter);
      const scope = [{ path: chapter, baseHash: before.hash! }];
      let calls = 0;
      const provider: AgentProvider = {
        config: { ...DEFAULT_PROVIDER, model: "test-fixture" },
        async generate() {
          calls++;
          if (scenario === "changed")
            writeFileSync(join(kernel.files.root, chapter), "外部新稿");
          return {
            text: "",
            usage: null,
            calls: [
              {
                id: "candidate",
                name: "propose_document",
                arguments: JSON.stringify({
                  path: scenario === "outside" ? "story.yaml" : chapter,
                  content: "新候选",
                  summary: "范围检查",
                }),
              },
            ],
          };
        },
      };
      await kernel.run(
        session.id,
        "按指定范围写作",
        provider,
        chapter,
        undefined,
        false,
        undefined,
        "coauthor",
        scope,
      );
      expect(calls).toBe(1);
      expect(kernel.session(session.id).proposals).toHaveLength(
        scenario === "allowed" ? 1 : 0,
      );
      expect(kernel.files.read(chapter).content).toBe(
        scenario === "changed" ? "外部新稿" : before.content,
      );
      expect(
        kernel
          .session(session.id)
          .events.find((event) => event.type === "turn.started")?.payload,
      ).toMatchObject({ candidateScope: scope });
      if (scenario === "changed") {
        await expect(
          kernel.run(
            session.id,
            "继续",
            provider,
            chapter,
            undefined,
            false,
            undefined,
            "coauthor",
            scope,
          ),
        ).rejects.toThrow("正文已改变");
        expect(calls).toBe(1);
      }
      for (const invalid of [
        [],
        [...scope, ...scope],
        [{ ...scope[0], unexpected: true }],
        [{ path: "../secret", baseHash: before.hash }],
        null,
      ])
        expect(() => kernel.validateCandidateScope(invalid)).toThrow();
      kernel.close();
    },
  );
  it.each([undefined, "continuity-review.v1", "explore"])(
    "enforces read-only review including skill %s against unsolicited writing",
    async (skillId) => {
      const kernel = create();
      const session = kernel.createSession();
      const before = kernel.files.read(chapter);
      const provider: AgentProvider = {
        config: { ...DEFAULT_PROVIDER, model: "test-fixture" },
        async generate(_messages, tools) {
          const system =
            _messages.find((message) => message.role === "system")?.content ??
            "";
          if (skillId === "explore") {
            expect(system).toContain("已有资料事实（给出来源）");
            expect(system).toContain("本轮作者确认方向（尚未保存）");
            expect(system).toContain("新增创作建议（全部待确认）");
            expect(system).toContain("不能只标记部分新增点");
            expect(system).toContain("问题数量、篇幅和等待确认的边界");
          } else {
            expect(system).not.toContain("探索模式：");
          }
          expect(tools.some((tool) => tool.name === "propose_document")).toBe(
            false,
          );
          return {
            text: "",
            usage: null,
            calls: [
              {
                id: "forbidden",
                name: "propose_document",
                arguments: JSON.stringify({
                  path: chapter,
                  content: "不能创建",
                  summary: "禁止",
                }),
              },
            ],
          };
        },
      };
      await kernel.run(
        session.id,
        "只读检查",
        provider,
        chapter,
        undefined,
        skillId === undefined,
        skillId === "explore" ? undefined : skillId,
        skillId === "explore" ? "explore" : "coauthor",
      );
      expect(kernel.session(session.id).status).toBe("failed");
      expect(kernel.session(session.id).proposals).toHaveLength(0);
      expect(
        kernel
          .session(session.id)
          .events.find((event) => event.type === "turn.started")?.payload,
      ).toMatchObject({
        mode: skillId === "explore" ? "explore" : "coauthor",
        readOnly: true,
      });
      expect(kernel.files.read(chapter)).toEqual(before);
      kernel.close();
    },
  );
  it.each(BUILTIN_SKILLS)(
    "loads only $id and persists its exact receipt",
    async (skill) => {
      const kernel = create();
      const session = kernel.createSession();
      expect(getBuiltinSkill(skill.id)).toEqual(skill);
      const provider: AgentProvider = {
        config: { ...DEFAULT_PROVIDER, model: "test-fixture" },
        async generate(messages) {
          const system = messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n");
          expect(system).toContain(skill.instructions);
          expect(system).toContain("creativeBrief 映射");
          expect(system).toContain(
            "genre、viewpoint、protagonistGoal、worldRules、style、boundaries 均为字符串",
          );
          expect(system).toContain("已有自定义结构不得擅自迁移或删除");
          for (const other of BUILTIN_SKILLS.filter(
            (item) => item.id !== skill.id,
          ))
            expect(system).not.toContain(other.instructions);
          return { text: "规划建议", calls: [], usage: null };
        },
      };
      await kernel.run(
        session.id,
        "规划当前场景",
        provider,
        chapter,
        undefined,
        false,
        skill.id,
      );
      const receipt = kernel
        .session(session.id)
        .events.find((event) => event.type === "context.compiled")!;
      expect((receipt.payload as { skill: unknown }).skill).toEqual(skill);
      const before = kernel.session(session.id).events.length;
      await expect(
        kernel.run(
          session.id,
          "未知技能",
          provider,
          chapter,
          undefined,
          false,
          "missing.v99",
        ),
      ).rejects.toThrow("创作技能不可用");
      expect(kernel.session(session.id).events).toHaveLength(before);
      kernel.close();
    },
  );
  it("exports accepted portable files only and reimports them without replacing content", () => {
    const kernel = create();
    kernel.save(chapter, "已接受的正式正文", kernel.files.read(chapter).hash);
    kernel.save("canon/characters/主角.md", "人物档案", null);
    const session = kernel.createSession();
    kernel.propose(
      session.id,
      chapter,
      "尚未接受的候选",
      kernel.files.read(chapter).hash,
      "待审",
    );
    const entries = unzipSync(kernel.files.exportZip());
    expect(strFromU8(entries[chapter]!)).toBe("已接受的正式正文");
    expect(strFromU8(entries["canon/characters/主角.md"]!)).toBe("人物档案");
    expect(entries["story.yaml"]).toBeDefined();
    expect(
      Object.keys(entries).some((path) => path.startsWith(".novel-agent/")),
    ).toBe(false);
    const folder = mkdtempSync(join(tmpdir(), "novel-reimport-"));
    for (const [path, bytes] of Object.entries(entries)) {
      const target = join(folder, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    const imported = new AuthoringKernel(folder, true);
    expect(imported.files.read(chapter).content).toBe("已接受的正式正文");
    expect(imported.files.read("canon/characters/主角.md").content).toBe(
      "人物档案",
    );
    expect(imported.listSessions()).toHaveLength(0);
    expect(imported.files.workspaceId).not.toBe(kernel.files.workspaceId);
    imported.close();
    kernel.close();
  });
  it("explains how to open empty and relocated project folders", () => {
    const folder = mkdtempSync(join(tmpdir(), "novel-empty-"));
    expect(() => new AuthoringKernel(folder)).toThrow("新建 / 导入作品");
    expect(() => new AuthoringKernel(join(folder, "missing"))).toThrow(
      "作品文件夹不存在",
    );
  });
  it("lets the model repair malformed tool arguments without persisting raw parser errors", async () => {
    const kernel = create();
    const session = kernel.createSession();
    let attempts = 0;
    const provider: AgentProvider = {
      config: { ...DEFAULT_PROVIDER, model: "test-fixture" },
      async generate(messages) {
        attempts++;
        if (attempts === 1)
          return {
            text: "",
            calls: [
              {
                id: "bad-json",
                name: "read_document",
                arguments: "PRIVATE_RAW_FRAGMENT not-json",
              },
            ],
            usage: null,
          };
        expect(messages.at(-1)?.content).toContain("invalid_arguments");
        return {
          text: "已检查格式问题，请确认写作方向。",
          calls: [],
          usage: null,
        };
      },
    };
    await kernel.run(session.id, "检查作品", provider);
    expect(attempts).toBe(2);
    expect(kernel.session(session.id).status).toBe("completed");
    expect(JSON.stringify(kernel.session(session.id).events)).not.toContain(
      "PRIVATE_RAW_FRAGMENT",
    );
    kernel.close();
  });
  it("rejects stale selection and blank tasks before acknowledging a turn", () => {
    const kernel = create();
    const session = kernel.createSession();
    expect(() => kernel.validateTurn(session.id, " ")).toThrow("创作要求");
    expect(() =>
      kernel.validateTurn(session.id, "改写", {
        path: chapter,
        baseHash: "stale",
        from: 0,
        to: 1,
      }),
    ).toThrow("选区已失效");
    expect(kernel.session(session.id).status).toBe("idle");
    kernel.close();
  });
  it("retries a prepared publication in the same process without duplicate revisions", () => {
    const kernel = create();
    const session = kernel.createSession();
    const p = kernel.propose(
      session.id,
      chapter,
      "恢复正文",
      kernel.files.read(chapter).hash,
      "测试恢复",
    );
    expect(() => kernel.accept(session.id, p.id, true)).toThrow("Injected");
    const revision = kernel.accept(session.id, p.id);
    expect(kernel.accept(session.id, p.id).revisionId).toBe(
      revision.revisionId,
    );
    expect(kernel.revisions()).toHaveLength(1);
    kernel.close();
  });
  it("includes rejected candidate status when continuing a task", async () => {
    const kernel = create();
    const session = kernel.createSession();
    const p = kernel.propose(
      session.id,
      chapter,
      "需要重做的候选",
      kernel.files.read(chapter).hash,
      "旧候选",
    );
    kernel.reject(session.id, p.id);
    let context = "";
    const provider: AgentProvider = {
      config: { ...DEFAULT_PROVIDER, model: "test-fixture" },
      async generate(messages) {
        context = JSON.stringify(messages);
        return { text: "请确认新方向", calls: [], usage: null };
      },
    };
    await kernel.run(session.id, "按刚才意见重做", provider, chapter);
    expect(context).toContain("rejected");
    expect(context).toContain("需要重做的候选");
    expect(kernel.files.read(chapter).content).not.toContain("需要重做");
    kernel.close();
  });
  it("rejects denied candidates permanently and keeps exact grants", () => {
    const kernel = create();
    const session = kernel.createSession();
    const original = kernel.files.read(chapter);
    const proposal = kernel.propose(
      session.id,
      chapter,
      "拒绝的正文",
      original.hash,
      "候选",
    );
    kernel.reject(session.id, proposal.id);
    expect(() => kernel.accept(session.id, proposal.id)).toThrow("拒绝");
    expect(kernel.files.read(chapter)).toEqual(original);
    const broker = new PermissionBroker();
    expect(() => broker.grantExact("story.read")).toThrow();
    expect(() => broker.grantExact("revision.publish.extra")).toThrow();
    kernel.close();
  });
  it("recovers prepared revisions after restart, links history across sessions and undoes through a new proposal", () => {
    const kernel = create();
    const root = kernel.files.root;
    const original = kernel.files.read(chapter);
    const s = kernel.createSession();
    const p = kernel.propose(
      s.id,
      chapter,
      "第一版正文",
      original.hash,
      "测试候选",
    );
    expect(() => kernel.accept(s.id, p.id, true)).toThrow("Injected");
    kernel.close();
    const restored = new AuthoringKernel(root);
    expect(restored.files.read(chapter).content).toBe("第一版正文");
    const r = restored.accept(s.id, p.id);
    expect(restored.revisions()).toHaveLength(1);
    const inverse = restored.undo(r.revisionId);
    expect(inverse.status).toBe("pending");
    expect(restored.session(inverse.sessionId).status).toBe(
      "awaiting_approval",
    );
    expect(restored.files.read(chapter).content).toBe("第一版正文");
    const undone = restored.accept(inverse.sessionId, inverse.id);
    expect(undone.undoOfRevisionId).toBe(r.revisionId);
    expect(undone.previousRevisionIds).toEqual([r.revisionId]);
    expect(restored.files.read(chapter)).toEqual(original);
    expect(restored.session(inverse.sessionId).status).toBe("completed");
    restored.close();
    const reopened = new AuthoringKernel(root);
    expect(reopened.session(inverse.sessionId).status).toBe("completed");
    expect(
      reopened
        .session(inverse.sessionId)
        .events.some((e) => e.type === "model.started"),
    ).toBe(false);
    reopened.close();
  });
  it("can undo newly created files without erasing historical revisions", () => {
    const kernel = create();
    const session = kernel.createSession();
    const p = kernel.propose(
      session.id,
      "canon/人物.md",
      "角色资料",
      null,
      "新人物",
    );
    const r = kernel.accept(session.id, p.id);
    const inverse = kernel.undo(r.revisionId);
    kernel.accept(inverse.sessionId, inverse.id);
    expect(kernel.files.read("canon/人物.md").hash).toBeNull();
    expect(kernel.revisions()).toHaveLength(2);
    kernel.close();
  });
  it("preserves external edits during approval and recovery", () => {
    const kernel = create();
    const session = kernel.createSession();
    const p = kernel.propose(
      session.id,
      chapter,
      "候选",
      kernel.files.read(chapter).hash,
      "候选",
    );
    writeFileSync(join(kernel.files.root, chapter), "外部修改");
    expect(() => kernel.accept(session.id, p.id)).toThrow("正文已改变");
    expect(kernel.files.read(chapter).content).toBe("外部修改");
    kernel.close();
  });
  it("blocks traversal, runtime files, Windows device paths and junction escapes", () => {
    const kernel = create();
    for (const path of [
      "../outside.md",
      ".novel-agent/events.sqlite3",
      "manuscript/con.md",
      "manuscript/test.md:stream",
      "manuscript/test.md.",
    ])
      expect(() => kernel.files.read(path)).toThrow();
    const external = mkdtempSync(join(tmpdir(), "novel-outside-"));
    mkdirSync(join(kernel.files.root, "canon"), { recursive: true });
    symlinkSync(
      external,
      join(kernel.files.root, "canon", "escape"),
      "junction",
    );
    expect(() => kernel.files.read("canon/escape/file.md")).toThrow("链接");
    kernel.close();
  });
  it("runs actual multi-step tool intents while keeping selection changes inside scope", async () => {
    const kernel = create();
    kernel.save(
      chapter,
      "前文。选中段落。后文。",
      kernel.files.read(chapter).hash,
    );
    const original = kernel.files.read(chapter);
    const session = kernel.createSession();
    let calls = 0;
    const provider: AgentProvider = {
      config: { ...DEFAULT_PROVIDER, model: "test-fixture" },
      async generate() {
        calls++;
        return {
          text: "",
          usage: { inputTokens: 10, outputTokens: 10 },
          calls: [
            {
              id: `call-${calls}`,
              name: calls === 1 ? "update_plan" : "propose_document",
              arguments: JSON.stringify(
                calls === 1
                  ? { steps: ["只重写所选段落"] }
                  : { path: chapter, content: "新段落。", summary: "局部修改" },
              ),
            },
          ],
        };
      },
    };
    await kernel.run(session.id, "修改选区", provider, chapter, {
      path: chapter,
      from: 3,
      to: 8,
      baseHash: original.hash!,
    });
    expect(calls).toBe(2);
    const p = kernel.session(session.id).proposals[0]!;
    expect(p.after).toBe("前文。新段落。后文。");
    expect(kernel.files.read(chapter)).toEqual(original);
    kernel.accept(session.id, p.id);
    expect(kernel.files.read(chapter).content).toBe(p.after);
    kernel.close();
  });
  it("pauses at the call limit without silently starting another model call", async () => {
    const kernel = create();
    const session = kernel.createSession();
    let calls = 0;
    const provider: AgentProvider = {
      config: { ...DEFAULT_PROVIDER, model: "test-fixture", maxSteps: 1 },
      async generate() {
        calls++;
        return {
          text: "",
          calls: [{ id: "read", name: "list_documents", arguments: "{}" }],
          usage: null,
        };
      },
    };
    await kernel.run(session.id, "了解当前作品", provider);
    expect(calls).toBe(1);
    expect(kernel.session(session.id).status).toBe("paused");
    kernel.close();
  });
});
