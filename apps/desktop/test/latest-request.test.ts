import { describe, expect, it } from "vitest";
import {
  LatestRequest,
  SelectedRequest,
} from "../src/renderer/latest-request.js";

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("editor read ordering", () => {
  it("keeps the latest chapter when reads finish in reverse order", async () => {
    const gate = new LatestRequest();
    const first = deferred();
    const second = deferred();
    const oldRead = gate.read(() => first.promise);
    const newRead = gate.read(() => second.promise);
    second.resolve("第二章");
    expect(await newRead).toEqual({ value: "第二章" });
    first.resolve("第一章");
    expect(await oldRead).toBeNull();
  });

  it("discards pending reads when the author types or changes workspace", async () => {
    const gate = new LatestRequest();
    const pending = deferred();
    const read = gate.read(() => pending.promise);
    gate.invalidate();
    pending.resolve("磁盘旧稿");
    expect(await read).toBeNull();
  });

  it("ignores obsolete errors but reports the current read failure", async () => {
    const gate = new LatestRequest();
    const pending = deferred();
    const read = gate.read(() => pending.promise);
    gate.invalidate();
    pending.reject(new Error("旧作品错误"));
    expect(await read).toBeNull();
    await expect(
      gate.read(() => Promise.reject(new Error("读取失败"))),
    ).rejects.toThrow("读取失败");
  });
});

describe("task selection and background refresh", () => {
  it("does not let an old task refresh supersede a newly selected task", async () => {
    const gate = new SelectedRequest();
    gate.reset("old");
    const pending = deferred();
    const selected = gate.read("new", () => pending.promise);
    let called = false;
    expect(
      await gate.read(
        "old",
        async () => {
          called = true;
          return "旧任务";
        },
        true,
      ),
    ).toBeNull();
    expect(called).toBe(false);
    pending.resolve("新任务");
    expect(await selected).toEqual({ value: "新任务" });
  });

  it("new task and workspace reset discard outstanding results", async () => {
    const gate = new SelectedRequest();
    const pending = deferred();
    const selected = gate.read("old", () => pending.promise);
    gate.reset();
    pending.resolve("旧任务");
    expect(await selected).toBeNull();
    expect(await gate.read("old", async () => "旧任务", true)).toBeNull();
    expect(await gate.read("new", async () => "新任务")).toEqual({
      value: "新任务",
    });
    expect(await gate.read("new", async () => "最新进度", true)).toEqual({
      value: "最新进度",
    });
  });
});
