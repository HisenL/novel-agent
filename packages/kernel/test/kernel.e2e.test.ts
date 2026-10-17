import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NovelAgentKernel } from "../src/index.js";

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "novel-agent-kernel-"));
  NovelAgentKernel.initialize(root);
  return root;
}

describe("NovelAgentKernel vertical slice", () => {
  it("recovers a prepared publication after a process restart", async () => {
    const root = workspace();
    const first = new NovelAgentKernel(root);
    const started = await first.startTask({
      task: "让开场出现一场突如其来的暴雨。",
    });
    expect(started.status).toBe("awaiting_approval");
    expect(() =>
      first.approve(started.sessionId, { faultAfterPrepare: true }),
    ).toThrow("Injected crash");
    first.close();

    const second = new NovelAgentKernel(root);
    const resumed = second.resume(started.sessionId);
    expect(resumed.status).toBe("completed");
    expect(resumed.revision).toBeDefined();
    expect(
      readFileSync(join(root, "manuscript", "main", "chapter-1.md"), "utf8"),
    ).toContain("暴雨");
    expect(resumed.events.map((event) => event.sequence)).toEqual(
      resumed.events.map((_, index) => index + 1),
    );

    const retried = second.approve(started.sessionId);
    expect(retried.revision?.revisionId).toBe(resumed.revision?.revisionId);
    expect(retried.events).toHaveLength(resumed.events.length);
    second.close();
  });

  it("never overwrites an external edit", async () => {
    const root = workspace();
    const kernel = new NovelAgentKernel(root);
    const started = await kernel.startTask({ task: "增加一个悬念。" });
    const chapter = join(root, "manuscript", "main", "chapter-1.md");
    writeFileSync(chapter, "# 外部编辑\n", "utf8");

    const result = kernel.approve(started.sessionId);
    expect(result.status).toBe("conflicted");
    expect(readFileSync(chapter, "utf8")).toBe("# 外部编辑\n");
    kernel.close();
  });
});
