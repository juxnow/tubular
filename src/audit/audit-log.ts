import { deepFreezeJsonObject, type JsonObject, sha256, stableStringify } from "../core/json.js";
import type { Clock } from "../core/time.js";

/** One hash-linked audit record. The chain detects alteration but is not signed or durably anchored. */
export interface AuditEvent {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.audit-event/v1";
  /** Identifier derived from this event's content hash. */
  readonly id: string;
  /** One-based position assigned on append. The sequence is hashed, but verification does not independently require contiguous sequence numbers. */
  readonly sequence: number;
  /** UTC ISO 8601 event time taken from the injected clock. */
  readonly timestamp: string;
  /** Event category selected by the trusted kernel, such as policy or effect completion. */
  readonly type: string;
  /** Actor label supplied by the host operation; the audit log does not authenticate it independently. */
  readonly actorId: string;
  /** Frozen JSON event details; callers must omit secrets they do not intend to retain. */
  readonly payload: JsonObject;
  /** Prior event digest, or null for the first event in an empty history. */
  readonly previousHash: string | null;
  /** SHA-256 digest covering the event body and previousHash, excluding derived id and hash fields. */
  readonly hash: string;
}

/** Result of recomputing sequence and hash links over a supplied audit history. */
export interface AuditVerification {
  /** True when identifiers, body hashes, and predecessor links match recomputation; no external anchoring is checked. */
  readonly valid: boolean;
  /** Total number of supplied events, including any events following the first invalid one. */
  readonly eventCount: number;
  /** First failing event's identifier, or null when the full supplied chain verifies. */
  readonly invalidEventId: string | null;
  /** Claimed digest of the last supplied event, even on verification failure; null for an empty input history. */
  readonly headHash: string | null;
}

/** Read-only inspection capability; it deliberately exposes no append or mutation operation. */
export interface AuditReader {
  /** Return a detached array of frozen events; no mutation or append capability is exposed. */
  entries(): readonly AuditEvent[];
  /** Recompute the current chain's body hashes and predecessor links without external anchoring. */
  verify(): AuditVerification;
}

/** Select canonical event fields for hashing, excluding the derived id and hash. */
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

/** Render the audit record including its sequence and hash links as plain JSON for serialization and hashing. */
export function auditEventToJson(event: AuditEvent): JsonObject {
  return {
    ...auditBody(event),
    id: event.id,
    hash: event.hash,
  };
}

/** Recompute content digests, derived identifiers, and predecessor links; stop at the first mismatch. */
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
    if (event.previousHash !== previousHash || event.hash !== expected || event.id !== expectedId) {
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

/** Append-only, process-local audit history using the injected clock and canonical JSON hashes. */
export class AuditLog {
  /** Injected time source shared by this component's timestamp and expiry decisions. */
  readonly #clock: Clock;
  /** Process-local append-only history; entries are frozen when appended. */
  readonly #events: AuditEvent[] = [];

  /** Create an empty ephemeral chain using the supplied host clock. */
  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** Freeze the payload and append a hash-linked event with the next sequence number. */
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

  /** Return a detached read-only event array; event payloads remain frozen. */
  entries(): readonly AuditEvent[] {
    return [...this.#events];
  }

  /** Verify every stored link and digest; a valid chain is not proof of durable or externally authenticated storage. */
  verify(): AuditVerification {
    return verifyAuditEvents(this.#events);
  }
}
