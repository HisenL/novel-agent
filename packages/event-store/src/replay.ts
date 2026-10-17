import {
  type EventEnvelope,
  assertEventEnvelope,
  assertEventPolicy,
} from "@novel-agent/protocol";

export type ReplayErrorCode =
  | "duplicate-event-id"
  | "duplicate-sequence"
  | "invalid-event"
  | "sequence-gap"
  | "sequence-reordered"
  | "stream-mismatch";

export class ReplayError extends Error {
  public constructor(
    public readonly code: ReplayErrorCode,
    message: string,
    public readonly eventIndex: number,
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

export interface StreamProjection {
  readonly eventIds: readonly string[];
  readonly eventTypes: readonly string[];
  readonly lastSequence: number;
}

export interface ReplayProjection {
  readonly events: readonly EventEnvelope[];
  readonly streams: Readonly<Record<string, StreamProjection>>;
  readonly totalEvents: number;
}

interface MutableStreamProjection {
  eventIds: string[];
  eventTypes: string[];
  lastSequence: number;
}

function copyEvent(event: EventEnvelope): EventEnvelope {
  return structuredClone(event);
}

export function replayEvents(events: readonly unknown[]): ReplayProjection {
  const eventIds = new Set<string>();
  const streams: Record<string, MutableStreamProjection> = Object.create(
    null,
  ) as Record<string, MutableStreamProjection>;
  const acceptedEvents: EventEnvelope[] = [];

  events.forEach((candidate, eventIndex) => {
    try {
      assertEventEnvelope(candidate);
      assertEventPolicy(candidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ReplayError("invalid-event", message, eventIndex);
    }

    if (eventIds.has(candidate.eventId)) {
      throw new ReplayError(
        "duplicate-event-id",
        `Event id '${candidate.eventId}' appears more than once.`,
        eventIndex,
      );
    }

    const current = streams[candidate.streamId];
    const expectedSequence = (current?.lastSequence ?? 0) + 1;
    if (candidate.sequence !== expectedSequence) {
      const code: ReplayErrorCode =
        candidate.sequence === expectedSequence - 1
          ? "duplicate-sequence"
          : candidate.sequence < expectedSequence
            ? "sequence-reordered"
            : "sequence-gap";
      throw new ReplayError(
        code,
        `Stream '${candidate.streamId}' expected sequence ${expectedSequence}, received ${candidate.sequence}.`,
        eventIndex,
      );
    }

    const stream = current ?? { eventIds: [], eventTypes: [], lastSequence: 0 };
    stream.eventIds.push(candidate.eventId);
    stream.eventTypes.push(candidate.type);
    stream.lastSequence = candidate.sequence;
    streams[candidate.streamId] = stream;
    eventIds.add(candidate.eventId);
    acceptedEvents.push(copyEvent(candidate));
  });

  return {
    events: acceptedEvents,
    streams,
    totalEvents: acceptedEvents.length,
  };
}

export function replayStream(
  expectedStreamId: string,
  events: readonly unknown[],
): ReplayProjection {
  events.forEach((candidate, eventIndex) => {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "streamId" in candidate &&
      candidate.streamId !== expectedStreamId
    ) {
      throw new ReplayError(
        "stream-mismatch",
        `Expected stream '${expectedStreamId}', received '${String(candidate.streamId)}'.`,
        eventIndex,
      );
    }
  });
  return replayEvents(events);
}

export class InMemoryEventLedger {
  readonly #events: EventEnvelope[] = [];

  public append(event: unknown): ReplayProjection {
    const projection = replayEvents([...this.#events, event]);
    const appended = projection.events.at(-1);
    if (appended !== undefined) {
      this.#events.push(copyEvent(appended));
    }
    return projection;
  }

  public replay(): ReplayProjection {
    return replayEvents(this.#events);
  }
}
