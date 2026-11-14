import { type JsonObject, sha256, stableStringify } from "../core/json.js";
import type { Clock } from "../core/time.js";
import {
  type ContextManifest,
  contextManifestToJson,
  sealContextManifest,
  verifyContextManifestIntegrity,
} from "./manifest.js";

/** Content-addressed context handoff for explicit recipients. It transfers no lease or approval authority. */
export interface HandoffEnvelope {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.handoff/v1";
  /** Content-derived identifier computed from this record's canonical digest; it is not a bearer credential. */
  readonly id: string;
  /** Principal sending the handoff; the envelope conveys context, not delegated authority. */
  readonly fromPrincipalId: string;
  /** Explicit recipient allowlist recorded in the handoff; transport authentication remains a host concern. */
  readonly intendedPrincipalIds: readonly string[];
  /** Nonempty task objective retained verbatim as context, never interpreted as an authority grant. */
  readonly objective: string;
  /** Bounded task constraints carried as untrusted planning text. */
  readonly constraints: readonly string[];
  /** Unresolved questions for the recipient; an empty list means none were recorded. */
  readonly openQuestions: readonly string[];
  /** Identifier of the explicit context manifest registered by the trusted host. */
  readonly contextManifestId: string;
  /** SHA-256 digest binding the selected context content and metadata. */
  readonly contextManifestDigest: string;
  /** Exact selected context snapshot carried with the handoff and covered by its digest. */
  readonly contextManifest: ContextManifest;
  /** Creation instant serialized as UTC ISO 8601 by the injected clock. */
  readonly createdAt: string;
  /** Lowercase SHA-256 hex over the canonical record body, excluding the derived id and digest; this proves integrity, not authenticity. */
  readonly digest: string;
}

/** Trusted selection and planning text used to construct a bounded, immutable handoff. */
export interface CreateHandoffRequest {
  /** Principal sending the handoff; the envelope conveys context, not delegated authority. */
  readonly fromPrincipalId: string;
  /** Explicit recipient allowlist recorded in the handoff; transport authentication remains a host concern. */
  readonly intendedPrincipalIds: readonly string[];
  /** Nonempty task objective retained verbatim as context, never interpreted as an authority grant. */
  readonly objective: string;
  /** Bounded task constraints carried as untrusted planning text. */
  readonly constraints: readonly string[];
  /** Unresolved questions for the recipient; an empty list means none were recorded. */
  readonly openQuestions: readonly string[];
  /** Exact selected context snapshot carried with the handoff and covered by its digest. */
  readonly contextManifest: ContextManifest;
}

/** Hard bounds on recipient counts and planning text. Text lengths are JavaScript UTF-16 code units. */
export const HANDOFF_LIMITS = Object.freeze({
  /** Maximum explicit recipients in one envelope. */
  maxIntendedPrincipals: 32,
  /** Maximum constraints and maximum open questions, counted separately. */
  maxListItems: 64,
  /** Maximum UTF-16 code units in each sender or recipient identifier. */
  maxPrincipalIdLength: 128,
  /** Maximum UTF-16 code units in the objective text. */
  maxObjectiveLength: 2_048,
  /** Maximum UTF-16 code units in each constraint or question. */
  maxListItemLength: 1_024,
});

/** Check handoff recipient and text limits before hashing or accepting a sealed envelope. */
function handoffFieldsAreBounded(fields: {
  /** Principal sending the handoff; the envelope conveys context, not delegated authority. */
  readonly fromPrincipalId: string;
  /** Explicit recipient allowlist recorded in the handoff; transport authentication remains a host concern. */
  readonly intendedPrincipalIds: readonly string[];
  /** Nonempty task objective retained verbatim as context, never interpreted as an authority grant. */
  readonly objective: string;
  /** Bounded task constraints carried as untrusted planning text. */
  readonly constraints: readonly string[];
  /** Unresolved questions for the recipient; an empty list means none were recorded. */
  readonly openQuestions: readonly string[];
}): boolean {
  return (
    fields.fromPrincipalId.trim().length > 0 &&
    fields.fromPrincipalId.length <= HANDOFF_LIMITS.maxPrincipalIdLength &&
    fields.intendedPrincipalIds.length > 0 &&
    fields.intendedPrincipalIds.length <= HANDOFF_LIMITS.maxIntendedPrincipals &&
    new Set(fields.intendedPrincipalIds).size === fields.intendedPrincipalIds.length &&
    fields.intendedPrincipalIds.every(
      (principalId) =>
        principalId.trim().length > 0 && principalId.length <= HANDOFF_LIMITS.maxPrincipalIdLength,
    ) &&
    fields.objective.trim().length > 0 &&
    fields.objective.length <= HANDOFF_LIMITS.maxObjectiveLength &&
    fields.constraints.length <= HANDOFF_LIMITS.maxListItems &&
    fields.openQuestions.length <= HANDOFF_LIMITS.maxListItems &&
    [...fields.constraints, ...fields.openQuestions].every(
      (item) => item.trim().length > 0 && item.length <= HANDOFF_LIMITS.maxListItemLength,
    )
  );
}

/** Handoff content covered by the digest, excluding the derived envelope identifier. */
interface HandoffDigestFields {
  /** Principal sending the handoff; the envelope conveys context, not delegated authority. */
  readonly fromPrincipalId: string;
  /** Explicit recipient allowlist recorded in the handoff; transport authentication remains a host concern. */
  readonly intendedPrincipalIds: readonly string[];
  /** Nonempty task objective retained verbatim as context, never interpreted as an authority grant. */
  readonly objective: string;
  /** Bounded task constraints carried as untrusted planning text. */
  readonly constraints: readonly string[];
  /** Unresolved questions for the recipient; an empty list means none were recorded. */
  readonly openQuestions: readonly string[];
  /** Exact selected context snapshot carried with the handoff and covered by its digest. */
  readonly contextManifest: ContextManifest;
  /** Creation instant serialized as UTC ISO 8601 by the injected clock. */
  readonly createdAt: string;
}

/** Select handoff content and exact context binding for canonical digest computation. */
function handoffBodyToJson(fields: HandoffDigestFields): JsonObject {
  return {
    protocol: "totally-tubular.handoff/v1",
    fromPrincipalId: fields.fromPrincipalId,
    intendedPrincipalIds: fields.intendedPrincipalIds,
    objective: fields.objective,
    constraints: fields.constraints,
    openQuestions: fields.openQuestions,
    contextManifestId: fields.contextManifest.id,
    contextManifestDigest: fields.contextManifest.digest,
    contextManifest: contextManifestToJson(fields.contextManifest),
    createdAt: fields.createdAt,
  };
}

/** Validate bounds and context integrity, then seal a content-addressed handoff without transferring authority. */
export function createHandoffEnvelope(
  request: CreateHandoffRequest,
  clock: Clock,
): HandoffEnvelope {
  if (!handoffFieldsAreBounded(request)) {
    throw new TypeError("Handoff metadata is empty, duplicated, or exceeds its limit");
  }
  const contextManifest = sealContextManifest(request.contextManifest);
  if (contextManifest.items.some((item) => item.disclosure === "local-only")) {
    throw new TypeError("A handoff cannot transmit local-only context");
  }
  if (
    contextManifest.items.some((item) => item.disclosure === "explicit-grant") &&
    request.intendedPrincipalIds.some((principalId) => principalId !== contextManifest.principalId)
  ) {
    throw new TypeError("Explicit-grant context can only be handed to the manifest principal");
  }
  const createdAt = clock.now().toISOString();
  const fields: HandoffDigestFields = {
    fromPrincipalId: request.fromPrincipalId,
    intendedPrincipalIds: request.intendedPrincipalIds,
    objective: request.objective,
    constraints: request.constraints,
    openQuestions: request.openQuestions,
    contextManifest,
    createdAt,
  };
  const body = handoffBodyToJson(fields);
  const digest = sha256(stableStringify(body));
  return Object.freeze({
    protocol: "totally-tubular.handoff/v1",
    id: `handoff_${digest.slice(0, 24)}`,
    fromPrincipalId: request.fromPrincipalId,
    intendedPrincipalIds: Object.freeze([...request.intendedPrincipalIds]),
    objective: request.objective,
    constraints: Object.freeze([...request.constraints]),
    openQuestions: Object.freeze([...request.openQuestions]),
    contextManifestId: contextManifest.id,
    contextManifestDigest: contextManifest.digest,
    contextManifest,
    createdAt,
    digest,
  });
}

/** Render the context handoff including its explicit recipient list as plain JSON for serialization and hashing. */
export function handoffEnvelopeToJson(envelope: HandoffEnvelope): JsonObject {
  return {
    protocol: envelope.protocol,
    id: envelope.id,
    fromPrincipalId: envelope.fromPrincipalId,
    intendedPrincipalIds: envelope.intendedPrincipalIds,
    objective: envelope.objective,
    constraints: envelope.constraints,
    openQuestions: envelope.openQuestions,
    contextManifestId: envelope.contextManifestId,
    contextManifestDigest: envelope.contextManifestDigest,
    contextManifest: contextManifestToJson(envelope.contextManifest),
    createdAt: envelope.createdAt,
    digest: envelope.digest,
  };
}

/** Recompute handoff and nested context integrity, including bounds and recipient metadata. */
export function verifyHandoffEnvelopeIntegrity(envelope: HandoffEnvelope): boolean {
  try {
    if (
      envelope.protocol !== "totally-tubular.handoff/v1" ||
      !handoffFieldsAreBounded(envelope) ||
      !Number.isFinite(Date.parse(envelope.createdAt)) ||
      !verifyContextManifestIntegrity(envelope.contextManifest) ||
      envelope.contextManifestId !== envelope.contextManifest.id ||
      envelope.contextManifestDigest !== envelope.contextManifest.digest ||
      envelope.contextManifest.items.some((item) => item.disclosure === "local-only") ||
      (envelope.contextManifest.items.some((item) => item.disclosure === "explicit-grant") &&
        envelope.intendedPrincipalIds.some(
          (principalId) => principalId !== envelope.contextManifest.principalId,
        ))
    ) {
      return false;
    }
    const expectedDigest = sha256(
      stableStringify(
        handoffBodyToJson({
          fromPrincipalId: envelope.fromPrincipalId,
          intendedPrincipalIds: envelope.intendedPrincipalIds,
          objective: envelope.objective,
          constraints: envelope.constraints,
          openQuestions: envelope.openQuestions,
          contextManifest: envelope.contextManifest,
          createdAt: envelope.createdAt,
        }),
      ),
    );
    return (
      envelope.digest === expectedDigest && envelope.id === `handoff_${expectedDigest.slice(0, 24)}`
    );
  } catch {
    return false;
  }
}

/** Verify, detach, and freeze a handoff and its selected context; reject malformed or altered content. */
export function sealHandoffEnvelope(envelope: HandoffEnvelope): HandoffEnvelope {
  if (!verifyHandoffEnvelopeIntegrity(envelope)) {
    throw new TypeError("Handoff envelope failed its integrity check");
  }
  return Object.freeze({
    ...envelope,
    intendedPrincipalIds: Object.freeze([...envelope.intendedPrincipalIds]),
    constraints: Object.freeze([...envelope.constraints]),
    openQuestions: Object.freeze([...envelope.openQuestions]),
    contextManifest: sealContextManifest(envelope.contextManifest),
  });
}
