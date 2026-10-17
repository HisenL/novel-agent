import type { EventEnvelope } from "@novel-agent/protocol";

export function latestTurnEvents(events: EventEnvelope[]): EventEnvelope[] {
  const start = events.map((event) => event.type).lastIndexOf("turn.started");
  return events.slice(Math.max(0, start));
}

export function turnUsage(events: EventEnvelope[]) {
  const current = latestTurnEvents(events);
  let inputTokens = 0,
    outputTokens = 0,
    knownCalls = 0,
    costUsd = 0,
    pricedCalls = 0;
  const started = current.filter(
    (event) => event.type === "model.started",
  ).length;
  const models = new Set<string>();
  for (const event of current) {
    const payload = event.payload as {
      model?: string;
      usage?: { inputTokens: number; outputTokens: number } | null;
      cost?: { amount: number; currency: string; basis?: string } | "unknown";
    };
    if (event.type === "model.started" && payload.model)
      models.add(payload.model);
    if (event.type !== "model.completed") continue;
    if (
      payload.usage &&
      Number.isSafeInteger(payload.usage.inputTokens) &&
      payload.usage.inputTokens >= 0 &&
      Number.isSafeInteger(payload.usage.outputTokens) &&
      payload.usage.outputTokens >= 0
    ) {
      inputTokens += payload.usage.inputTokens;
      outputTokens += payload.usage.outputTokens;
      knownCalls++;
    }
    if (
      payload.cost &&
      typeof payload.cost === "object" &&
      payload.cost.currency === "USD" &&
      payload.cost.basis === "user-configured-pricing" &&
      typeof payload.cost.amount === "number" &&
      Number.isFinite(payload.cost.amount) &&
      payload.cost.amount >= 0
    ) {
      costUsd += payload.cost.amount;
      pricedCalls++;
    }
  }
  return {
    inputTokens,
    outputTokens,
    knownCalls,
    costUsd,
    pricedCalls,
    started,
    unknownCalls: Math.max(0, started - knownCalls),
    unknownCostCalls: Math.max(0, started - pricedCalls),
    models: [...models],
  };
}

export function costSummary(usage: ReturnType<typeof turnUsage>): string {
  if (!usage.pricedCalls) return "费用待确认（未配置单价或调用用量未知）";
  const amount =
    usage.costUsd > 0 && usage.costUsd < 0.00000001
      ? "USD < $0.00000001"
      : `USD $${usage.costUsd.toFixed(8)}`;
  return `按手填单价估算 ${amount}${usage.unknownCostCalls ? `；另 ${usage.unknownCostCalls} 次费用待确认` : ""}`;
}
