import { describe, expect, it } from "vitest";

import type { EventEnvelope } from "@novel-agent/protocol";

import {
  InMemoryEventLedger,
  ReplayError,
  replayEvents,
  replayStream,
} from "../src/index.js";

function event(
  sequence: number,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    eventId: `event-${sequence}`,
    streamId: "session-1",
    sequence,
    type: sequence === 1 ? "session.created" : "turn.completed",
    schemaVersion: 1,
    timestamp: `2026-08-31T00:00:0${sequence}.000Z`,
    actor: { kind: "system" },
    correlationId: "correlation-1",
    visibility: "developer",
    payload: { sequence },
    ...overrides,
  };
}

describe("deterministic event replay", () => {
  it("replays contiguous streams from sequence one and preserves unknown events", () => {
    const events = [
      event(1),
      event(2, { type: "community.future_event", payload: { future: true } }),
    ];
    const first = replayEvents(events);
    const second = replayEvents(events);

    expect(first).toEqual(second);
    expect(first.totalEvents).toBe(2);
    expect(first.streams["session-1"]).toEqual({
      eventIds: ["event-1", "event-2"],
      eventTypes: ["session.created", "community.future_event"],
      lastSequence: 2,
    });
    expect(first.events[1]?.payload).toEqual({ future: true });
  });

  it("supports interleaved independent streams", () => {
    const projection = replayEvents([
      event(1),
      event(1, { eventId: "other-1", streamId: "session-2" }),
      event(2),
      event(2, { eventId: "other-2", streamId: "session-2" }),
    ]);
    expect(projection.streams["session-1"]?.lastSequence).toBe(2);
    expect(projection.streams["session-2"]?.lastSequence).toBe(2);
  });

  it.each([
    ["a stream that starts after one", [event(2)], "sequence-gap"],
    ["a gap", [event(1), event(3)], "sequence-gap"],
    [
      "a duplicate sequence",
      [event(1), event(1, { eventId: "event-copy" })],
      "duplicate-sequence",
    ],
    [
      "reordering",
      [event(1), event(2), event(1, { eventId: "event-late" })],
      "sequence-reordered",
    ],
  ])("rejects %s", (_name, events, code) => {
    expect(() => replayEvents(events)).toThrowError(
      expect.objectContaining<Partial<ReplayError>>({
        code: code as ReplayError["code"],
      }),
    );
  });

  it("rejects duplicate event ids even across streams", () => {
    expect(() =>
      replayEvents([event(1), event(1, { streamId: "session-2" })]),
    ).toThrowError(expect.objectContaining({ code: "duplicate-event-id" }));
  });

  it("rejects stream mismatch in single-stream replay", () => {
    expect(() =>
      replayStream("session-1", [
        event(1),
        event(1, { eventId: "other-1", streamId: "session-2" }),
      ]),
    ).toThrowError(expect.objectContaining({ code: "stream-mismatch" }));
  });

  it("rejects invalid envelopes and forbidden secret payloads", () => {
    expect(() => replayEvents([{ ...event(1), sequence: 0 }])).toThrowError(
      expect.objectContaining({ code: "invalid-event" }),
    );
    expect(() =>
      replayEvents([event(1, { payload: { accessToken: "not-allowed" } })]),
    ).toThrowError(expect.objectContaining({ code: "invalid-event" }));
  });

  it("appends idempotently without mutating accepted input", () => {
    const ledger = new InMemoryEventLedger();
    const input = event(1, { payload: { nested: { value: 1 } } });
    ledger.append(input);
    (input.payload as { nested: { value: number } }).nested.value = 2;
    expect(ledger.replay().events[0]?.payload).toEqual({
      nested: { value: 1 },
    });
    expect(() =>
      ledger.append(event(1, { eventId: "another-id" })),
    ).toThrowError(expect.objectContaining({ code: "duplicate-sequence" }));
  });
});
