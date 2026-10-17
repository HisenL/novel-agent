import { expect, test } from "vitest";
import { proposalTitle } from "../src/renderer/proposal-title.js";

test("identifies new files by the approved operation contract", () => {
  expect(proposalTitle([{ kind: "create" }])).toBe("审阅新建文件");
  expect(proposalTitle([{ kind: "replace" }])).toBe("审阅文件修改");
  expect(proposalTitle([{ kind: "create" }, { kind: "replace" }])).toBe(
    "审阅文件修改",
  );
  expect(proposalTitle([])).toBe("审阅文件修改");
});
