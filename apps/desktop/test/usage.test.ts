import { describe, it, expect } from "vitest";
import type { EventEnvelope } from "@novel-agent/protocol";
import {
  costSummary,
  latestTurnEvents,
  turnUsage,
} from "../src/renderer/usage.js";

const event = (type: string, payload: unknown = {}): EventEnvelope =>
  ({ type, payload }) as EventEnvelope;
describe("author-facing turn usage", () => {
  it("keeps previous plans and tools out of the current turn without changing history", () => {
    const events = [
      event("turn.started"),
      event("plan.updated", { steps: ["旧写作计划"] }),
      event("tool.completed", { tool: "propose_document" }),
      event("turn.completed"),
      event("turn.started", { readOnly: true }),
      event("tool.completed", { tool: "read_document" }),
    ];
    expect(latestTurnEvents(events)).toEqual(events.slice(4));
    expect(events).toHaveLength(6);
    expect(latestTurnEvents([])).toEqual([]);
    expect(latestTurnEvents(events.slice(1, 3))).toEqual(events.slice(1, 3));
  });
  it("totals all calls in the latest turn", () => {
    const result = turnUsage([
      event("turn.started"),
      event("model.completed", {
        usage: { inputTokens: 999, outputTokens: 999 },
      }),
      event("turn.started"),
      event("model.started", { model: "writer" }),
      event("model.completed", {
        usage: { inputTokens: 20, outputTokens: 10 },
      }),
      event("model.started", { model: "writer" }),
      event("model.completed", {
        usage: { inputTokens: 30, outputTokens: 15 },
      }),
    ]);
    expect(result).toEqual({
      inputTokens: 50,
      outputTokens: 25,
      knownCalls: 2,
      costUsd: 0,
      pricedCalls: 0,
      started: 2,
      unknownCalls: 0,
      unknownCostCalls: 2,
      models: ["writer"],
    });
  });
  it("marks missing usage and interrupted requests as unknown", () => {
    const result = turnUsage([
      event("turn.started"),
      event("model.started"),
      event("model.completed", { usage: null }),
      event("model.started"),
      event("turn.interrupted"),
    ]);
    expect(result.knownCalls).toBe(0);
    expect(result.unknownCalls).toBe(2);
    expect(costSummary(result)).toContain("费用待确认");
  });
  it("keeps priced completed calls separate from unknown-cost calls", () => {
    const result = turnUsage([
      event("turn.started"),
      event("model.started", { model: "priced" }),
      event("model.completed", {
        usage: { inputTokens: 2000, outputTokens: 500 },
        cost: {
          amount: 0.002,
          currency: "USD",
          basis: "user-configured-pricing",
        },
      }),
      event("model.started", { model: "priced" }),
      event("model.completed", { usage: null, cost: "unknown" }),
    ]);
    expect(result.costUsd).toBe(0.002);
    expect(result.pricedCalls).toBe(1);
    expect(result.unknownCostCalls).toBe(1);
    expect(costSummary(result)).toContain("USD $0.00200000");
    expect(costSummary(result)).toContain("另 1 次费用待确认");
  });
});
