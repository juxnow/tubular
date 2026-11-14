import {
  deepFreezeJsonObject,
  sha256,
  stableStringify,
  type JsonObject,
} from "../core/json.js";
import type { Clock } from "../core/time.js";

export interface AuditEvent {
  readonly protocol: "totally-tubular.audit-event/v1";
  readonly id: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: string;
  readonly actorId: string;
  readonly payload: JsonObject;
  readonly previousHash: string | null;
  readonly hash: string;
}

export interface AuditVerification {
  readonly valid: boolean;
  readonly eventCount: number;
  readonly invalidEventId: string | null;
  readonly headHash: string | null;
}

export interface AuditReader {
  entries(): readonly AuditEvent[];
  verify(): AuditVerification;
}

function auditBody(event: Omit<AuditEvent, "id" | "hash">): JsonObject {
  return {
    protocol: event.protocol,
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    actorId: event.actorId,
    payload: event.payload,
    previousHash: event.previousHash,
  };
}

export function auditEventToJson(event: AuditEvent): JsonObject {
  return {
    ...auditBody(event),
    id: event.id,
    hash: event.hash,
  };
}

export function verifyAuditEvents(events: readonly AuditEvent[]): AuditVerification {
  let previousHash: string | null = null;
  for (const event of events) {
    const expected = sha256(
      stableStringify(
        auditBody({
          protocol: event.protocol,
          sequence: event.sequence,
          timestamp: event.timestamp,
          type: event.type,
          actorId: event.actorId,
          payload: event.payload,
          previousHash,
        }),
      ),
    );
    const expectedId = `audit_${String(event.sequence).padStart(6, "0")}_${expected.slice(0, 16)}`;
    if (
      event.previousHash !== previousHash ||
      event.hash !== expected ||
      event.id !== expectedId
    ) {
      return {
        valid: false,
        eventCount: events.length,
        invalidEventId: event.id,
        headHash: events.at(-1)?.hash ?? null,
      };
    }
    previousHash = event.hash;
  }
  return {
    valid: true,
    eventCount: events.length,
    invalidEventId: null,
    headHash: events.at(-1)?.hash ?? null,
  };
}

export class AuditLog {
  readonly #clock: Clock;
  readonly #events: AuditEvent[] = [];

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  append(type: string, actorId: string, payload: JsonObject): AuditEvent {
    const previous = this.#events.at(-1);
    const frozenPayload = deepFreezeJsonObject(payload);
    const base: Omit<AuditEvent, "id" | "hash"> = {
      protocol: "totally-tubular.audit-event/v1",
      sequence: this.#events.length + 1,
      timestamp: this.#clock.now().toISOString(),
      type,
      actorId,
      payload: frozenPayload,
      previousHash: previous?.hash ?? null,
    };
    const hash = sha256(stableStringify(auditBody(base)));
    const event: AuditEvent = Object.freeze({
      ...base,
      id: `audit_${String(base.sequence).padStart(6, "0")}_${hash.slice(0, 16)}`,
      hash,
    });
    this.#events.push(event);
    return event;
  }

  entries(): readonly AuditEvent[] {
    return [...this.#events];
  }

  verify(): AuditVerification {
    return verifyAuditEvents(this.#events);
  }
}
