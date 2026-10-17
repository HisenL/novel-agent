import { describe, expect, it } from "vitest";
import { filterTaskHistory } from "../src/renderer/task-history.js";

describe("task history navigation", () => {
  it("keeps older tasks reachable beyond twenty entries", () => {
    const tasks = Array.from({ length: 32 }, (_, i) => ({
      title: `章节${i}`,
      status: i === 31 ? "paused" : "completed",
    }));
    expect(filterTaskHistory(tasks, "")).toHaveLength(32);
    expect(filterTaskHistory(tasks, "章节31", "paused")).toEqual([tasks[31]]);
    expect(filterTaskHistory(tasks, "章节31", "completed")).toEqual([]);
  });
  it("normalizes query without mutating records and excludes manual saves", () => {
    const tasks = [
      { title: "手动保存 chapter.md", status: "completed" },
      { title: "Rain 雨夜", status: "completed" },
    ];
    expect(filterTaskHistory(tasks, " RAIN ")).toEqual([tasks[1]]);
    expect(tasks).toHaveLength(2);
  });
});
