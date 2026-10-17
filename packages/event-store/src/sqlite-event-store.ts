import { createRequire } from "node:module";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

import {
  type EventEnvelope,
  assertEventEnvelope,
  assertEventPolicy,
} from "@novel-agent/protocol";
import type BetterSqlite3 from "better-sqlite3";

import { replayStream } from "./replay.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof BetterSqlite3;

export class EventStoreConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EventStoreConflictError";
  }
}

interface EventRow {
  readonly document: string;
}

export class SQLiteEventStore {
  readonly #database: BetterSqlite3.Database;

  public constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    const nativeBinding = process.env.NOVEL_AGENT_SQLITE_BINDING;
    this.#database = new Database(
      databasePath,
      nativeBinding ? { nativeBinding } : {},
    );
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("foreign_keys = ON");
    this.#database.pragma("synchronous = FULL");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 1),
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        document TEXT NOT NULL,
        UNIQUE (stream_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS events_stream_order
        ON events (stream_id, sequence);
    `);
  }

  public nextSequence(streamId: string): number {
    const row = this.#database
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) AS last_sequence FROM events WHERE stream_id = ?",
      )
      .get(streamId) as { readonly last_sequence: number };
    return row.last_sequence + 1;
  }

  public append(event: EventEnvelope): void {
    assertEventEnvelope(event);
    assertEventPolicy(event);
    const appendTransaction = this.#database.transaction(() => {
      const expected = this.nextSequence(event.streamId);
      if (event.sequence !== expected) {
        throw new EventStoreConflictError(
          `Stream '${event.streamId}' expected sequence ${expected}, received ${event.sequence}.`,
        );
      }
      try {
        this.#database
          .prepare(
            `INSERT INTO events
              (event_id, stream_id, sequence, event_type, timestamp, document)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.eventId,
            event.streamId,
            event.sequence,
            event.type,
            event.timestamp,
            JSON.stringify(event),
          );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new EventStoreConflictError(`Could not append event: ${message}`);
      }
    });
    appendTransaction.immediate();
  }

  public loadStream(streamId: string): readonly EventEnvelope[] {
    const rows = this.#database
      .prepare(
        "SELECT document FROM events WHERE stream_id = ? ORDER BY sequence ASC",
      )
      .all(streamId) as readonly EventRow[];
    const events = rows.map((row) => JSON.parse(row.document) as unknown);
    return replayStream(streamId, events).events;
  }

  public listStreamIds(): readonly string[] {
    const rows = this.#database
      .prepare("SELECT DISTINCT stream_id FROM events ORDER BY stream_id ASC")
      .all() as readonly { readonly stream_id: string }[];
    return rows.map((row) => row.stream_id);
  }

  public close(): void {
    this.#database.close();
  }
}
