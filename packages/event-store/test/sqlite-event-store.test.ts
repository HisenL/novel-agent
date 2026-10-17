import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EventEnvelope } from "@novel-agent/protocol";
import { describe, expect, it } from "vitest";

import { EventStoreConflictError, SQLiteEventStore } from "../src/index.js";

function event(streamId: string, sequence: number): EventEnvelope {
  return {
    eventId: randomUUID(),
    streamId,
    sequence,
    type: "test.event",
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    actor: { kind: "system" },
    correlationId: streamId,
    visibility: "developer",
    payload: { sequence },
  };
}

describe("SQLiteEventStore", () => {
  it("persists a contiguous stream across reopen", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "novel-agent-ledger-")),
      "events.db",
    );
    const first = new SQLiteEventStore(path);
    first.append(event("session-1", 1));
    first.close();

    const second = new SQLiteEventStore(path);
    expect(second.nextSequence("session-1")).toBe(2);
    second.append(event("session-1", 2));
    expect(second.loadStream("session-1").map((item) => item.sequence)).toEqual(
      [1, 2],
    );
    second.close();
  });

  it("rejects sequence gaps", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "novel-agent-ledger-")),
      "events.db",
    );
    const store = new SQLiteEventStore(path);
    expect(() => store.append(event("session-1", 2))).toThrow(
      EventStoreConflictError,
    );
    store.close();
  });
});
