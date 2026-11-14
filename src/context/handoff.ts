import { sha256, stableStringify, type JsonObject } from "../core/json.js";
import type { Clock } from "../core/time.js";
import {
  contextManifestToJson,
  sealContextManifest,
  verifyContextManifestIntegrity,
  type ContextManifest,
} from "./manifest.js";

export interface HandoffEnvelope {
  readonly protocol: "totally-tubular.handoff/v1";
  readonly id: string;
  readonly fromPrincipalId: string;
  readonly intendedPrincipalIds: readonly string[];
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly openQuestions: readonly string[];
  readonly contextManifestId: string;
  readonly contextManifestDigest: string;
  readonly contextManifest: ContextManifest;
  readonly createdAt: string;
  readonly digest: string;
}

export interface CreateHandoffRequest {
  readonly fromPrincipalId: string;
  readonly intendedPrincipalIds: readonly string[];
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly openQuestions: readonly string[];
  readonly contextManifest: ContextManifest;
}

export const HANDOFF_LIMITS = Object.freeze({
  maxIntendedPrincipals: 32,
  maxListItems: 64,
  maxPrincipalIdLength: 128,
  maxObjectiveLength: 2_048,
  maxListItemLength: 1_024,
});

function handoffFieldsAreBounded(fields: {
  readonly fromPrincipalId: string;
  readonly intendedPrincipalIds: readonly string[];
  readonly objective: string;
  readonly constraints: readonly string[];
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
        principalId.trim().length > 0 &&
        principalId.length <= HANDOFF_LIMITS.maxPrincipalIdLength,
    ) &&
    fields.objective.trim().length > 0 &&
    fields.objective.length <= HANDOFF_LIMITS.maxObjectiveLength &&
    fields.constraints.length <= HANDOFF_LIMITS.maxListItems &&
    fields.openQuestions.length <= HANDOFF_LIMITS.maxListItems &&
    [...fields.constraints, ...fields.openQuestions].every(
      (item) =>
        item.trim().length > 0 && item.length <= HANDOFF_LIMITS.maxListItemLength,
    )
  );
}

interface HandoffDigestFields {
  readonly fromPrincipalId: string;
  readonly intendedPrincipalIds: readonly string[];
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly openQuestions: readonly string[];
  readonly contextManifest: ContextManifest;
  readonly createdAt: string;
}

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
    request.intendedPrincipalIds.some(
      (principalId) => principalId !== contextManifest.principalId,
    )
  ) {
    throw new TypeError(
      "Explicit-grant context can only be handed to the manifest principal",
    );
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
      (envelope.contextManifest.items.some(
        (item) => item.disclosure === "explicit-grant",
      ) &&
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
      envelope.digest === expectedDigest &&
      envelope.id === `handoff_${expectedDigest.slice(0, 24)}`
    );
  } catch {
    return false;
  }
}

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
