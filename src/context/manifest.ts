import {
  contentAddress,
  sha256,
  stableStringify,
  type JsonObject,
} from "../core/json.js";
import type { Clock } from "../core/time.js";

export type DataClassification = "public" | "internal" | "private" | "secret";

export type DisclosurePolicy = "shareable" | "explicit-grant" | "local-only";

export type ProvenanceKind = "file" | "url" | "message" | "manual" | "generated";

export interface Provenance {
  readonly kind: ProvenanceKind;
  readonly locator: string;
  readonly observedAt: string;
}

export interface ContextSource {
  readonly id: string;
  readonly label: string;
  readonly mediaType: string;
  readonly content: string;
  readonly classification: DataClassification;
  readonly disclosure: DisclosurePolicy;
  readonly provenance: Provenance;
}

export interface ContextSnapshot {
  readonly id: string;
  readonly sourceId: string;
  readonly label: string;
  readonly mediaType: string;
  readonly content: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly capturedAt: string;
  readonly classification: DataClassification;
  readonly disclosure: DisclosurePolicy;
  readonly provenance: Provenance;
}

export type ContextOmissionReason =
  | "source-not-found"
  | "classification-exceeds-ceiling"
  | "source-exceeds-byte-limit"
  | "manifest-byte-budget-exceeded";

export const CONTEXT_LIMITS = Object.freeze({
  maxSelectedSources: 64,
  maxSourceBytes: 256 * 1_024,
  maxManifestBytes: 1_024 * 1_024,
});

export interface ContextOmission {
  readonly sourceId: string;
  readonly reason: ContextOmissionReason;
}

export interface ContextManifest {
  readonly protocol: "totally-tubular.context/v1";
  readonly id: string;
  readonly purpose: string;
  readonly principalId: string;
  readonly createdAt: string;
  readonly classificationCeiling: DataClassification;
  readonly items: readonly ContextSnapshot[];
  readonly omitted: readonly ContextOmission[];
  readonly digest: string;
}

export interface BuildContextManifestRequest {
  readonly purpose: string;
  readonly principalId: string;
  readonly selectedSourceIds: readonly string[];
  readonly classificationCeiling: DataClassification;
}

const classificationRanks: Readonly<Record<DataClassification, number>> = {
  public: 0,
  internal: 1,
  private: 2,
  secret: 3,
};

const disclosurePolicies = new Set<DisclosurePolicy>([
  "shareable",
  "explicit-grant",
  "local-only",
]);

const provenanceKinds = new Set<ProvenanceKind>([
  "file",
  "url",
  "message",
  "manual",
  "generated",
]);

const omissionReasons = new Set<ContextOmissionReason>([
  "source-not-found",
  "classification-exceeds-ceiling",
  "source-exceeds-byte-limit",
  "manifest-byte-budget-exceeded",
]);

interface ManifestDigestFields {
  readonly purpose: string;
  readonly principalId: string;
  readonly createdAt: string;
  readonly classificationCeiling: DataClassification;
  readonly items: readonly ContextSnapshot[];
  readonly omitted: readonly ContextOmission[];
}

function provenanceToJson(provenance: Provenance): JsonObject {
  return {
    kind: provenance.kind,
    locator: provenance.locator,
    observedAt: provenance.observedAt,
  };
}

export function contextSnapshotToJson(snapshot: ContextSnapshot): JsonObject {
  return {
    id: snapshot.id,
    sourceId: snapshot.sourceId,
    label: snapshot.label,
    mediaType: snapshot.mediaType,
    content: snapshot.content,
    byteLength: snapshot.byteLength,
    sha256: snapshot.sha256,
    capturedAt: snapshot.capturedAt,
    classification: snapshot.classification,
    disclosure: snapshot.disclosure,
    provenance: provenanceToJson(snapshot.provenance),
  };
}

function omissionToJson(omission: ContextOmission): JsonObject {
  return { sourceId: omission.sourceId, reason: omission.reason };
}

function manifestDigestBody(fields: ManifestDigestFields): JsonObject {
  return {
    protocol: "totally-tubular.context/v1",
    purpose: fields.purpose,
    principalId: fields.principalId,
    createdAt: fields.createdAt,
    classificationCeiling: fields.classificationCeiling,
    items: fields.items.map((item) => contextSnapshotToJson(item)),
    omitted: fields.omitted.map((item) => omissionToJson(item)),
  };
}

export function contextManifestToJson(manifest: ContextManifest): JsonObject {
  return {
    protocol: manifest.protocol,
    id: manifest.id,
    purpose: manifest.purpose,
    principalId: manifest.principalId,
    createdAt: manifest.createdAt,
    classificationCeiling: manifest.classificationCeiling,
    items: manifest.items.map((item) => contextSnapshotToJson(item)),
    omitted: manifest.omitted.map((omission) => omissionToJson(omission)),
    digest: manifest.digest,
  };
}

function snapshotSource(source: ContextSource, capturedAt: string): ContextSnapshot {
  const bytes = new TextEncoder().encode(source.content);
  const digest = sha256(bytes);
  const identity: JsonObject = {
    sourceId: source.id,
    contentDigest: digest,
    capturedAt,
    classification: source.classification,
    disclosure: source.disclosure,
  };

  return Object.freeze({
    id: contentAddress("snapshot", identity),
    sourceId: source.id,
    label: source.label,
    mediaType: source.mediaType,
    content: source.content,
    byteLength: bytes.byteLength,
    sha256: digest,
    capturedAt,
    classification: source.classification,
    disclosure: source.disclosure,
    provenance: Object.freeze({ ...source.provenance }),
  });
}

export function buildContextManifest(
  sources: readonly ContextSource[],
  request: BuildContextManifestRequest,
  clock: Clock,
): ContextManifest {
  if (request.selectedSourceIds.length === 0) {
    throw new TypeError("At least one context source must be selected explicitly");
  }
  if (request.selectedSourceIds.length > CONTEXT_LIMITS.maxSelectedSources) {
    throw new TypeError(
      `At most ${CONTEXT_LIMITS.maxSelectedSources} context sources may be selected`,
    );
  }
  if (
    request.purpose.trim().length === 0 ||
    request.purpose.length > 512 ||
    request.principalId.trim().length === 0 ||
    request.principalId.length > 128
  ) {
    throw new TypeError("Context purpose or principal id is empty or exceeds its limit");
  }

  const sourceById = new Map<string, ContextSource>();
  for (const source of sources) {
    if (
      source.id.trim().length === 0 ||
      source.id.length > 128 ||
      source.label.length > 256 ||
      source.mediaType.length > 128 ||
      classificationRanks[source.classification] === undefined ||
      !disclosurePolicies.has(source.disclosure) ||
      !provenanceKinds.has(source.provenance.kind) ||
      source.provenance.locator.length > 2_048 ||
      !Number.isFinite(Date.parse(source.provenance.observedAt))
    ) {
      throw new TypeError(`Context source metadata exceeds its limit: ${source.id.slice(0, 32)}`);
    }
    if (sourceById.has(source.id)) {
      throw new TypeError(`Duplicate context source id: ${source.id}`);
    }
    sourceById.set(source.id, source);
  }

  const selected = [...new Set(request.selectedSourceIds)];
  const capturedAt = clock.now().toISOString();
  const items: ContextSnapshot[] = [];
  const omitted: ContextOmission[] = [];
  let includedBytes = 0;

  for (const sourceId of selected) {
    const source = sourceById.get(sourceId);
    if (source === undefined) {
      omitted.push(Object.freeze({ sourceId, reason: "source-not-found" }));
      continue;
    }
    if (
      classificationRanks[source.classification] >
      classificationRanks[request.classificationCeiling]
    ) {
      omitted.push(
        Object.freeze({ sourceId, reason: "classification-exceeds-ceiling" }),
      );
      continue;
    }
    const sourceBytes = new TextEncoder().encode(source.content).byteLength;
    if (sourceBytes > CONTEXT_LIMITS.maxSourceBytes) {
      omitted.push(Object.freeze({ sourceId, reason: "source-exceeds-byte-limit" }));
      continue;
    }
    if (includedBytes + sourceBytes > CONTEXT_LIMITS.maxManifestBytes) {
      omitted.push(
        Object.freeze({ sourceId, reason: "manifest-byte-budget-exceeded" }),
      );
      continue;
    }
    items.push(snapshotSource(source, capturedAt));
    includedBytes += sourceBytes;
  }

  const digestBody = manifestDigestBody({
    purpose: request.purpose,
    principalId: request.principalId,
    createdAt: capturedAt,
    classificationCeiling: request.classificationCeiling,
    items,
    omitted,
  });
  const digest = sha256(stableStringify(digestBody));

  return Object.freeze({
    protocol: "totally-tubular.context/v1",
    id: `context_${digest.slice(0, 24)}`,
    purpose: request.purpose,
    principalId: request.principalId,
    createdAt: capturedAt,
    classificationCeiling: request.classificationCeiling,
    items: Object.freeze([...items]),
    omitted: Object.freeze([...omitted]),
    digest,
  });
}

export function verifyContextManifestIntegrity(manifest: ContextManifest): boolean {
  try {
    if (manifest.protocol !== "totally-tubular.context/v1") {
      return false;
    }
    if (
      !Number.isFinite(Date.parse(manifest.createdAt)) ||
      manifest.purpose.trim().length === 0 ||
      manifest.purpose.length > 512 ||
      manifest.principalId.trim().length === 0 ||
      manifest.principalId.length > 128 ||
      manifest.items.length + manifest.omitted.length > CONTEXT_LIMITS.maxSelectedSources
    ) {
      return false;
    }
    const ceilingRank = classificationRanks[manifest.classificationCeiling];
    if (ceilingRank === undefined) {
      return false;
    }

    const sourceIds = new Set<string>();
    let includedBytes = 0;
    for (const item of manifest.items) {
      if (sourceIds.has(item.sourceId)) {
        return false;
      }
      sourceIds.add(item.sourceId);
      if (
        classificationRanks[item.classification] === undefined ||
        classificationRanks[item.classification] > ceilingRank ||
        !disclosurePolicies.has(item.disclosure)
      ) {
        return false;
      }
      const bytes = new TextEncoder().encode(item.content);
      const contentDigest = sha256(bytes);
      includedBytes += bytes.byteLength;
      if (
        item.sourceId.trim().length === 0 ||
        item.sourceId.length > 128 ||
        item.label.length > 256 ||
        item.mediaType.length > 128 ||
        !provenanceKinds.has(item.provenance.kind) ||
        item.provenance.locator.length > 2_048 ||
        !Number.isFinite(Date.parse(item.capturedAt)) ||
        !Number.isFinite(Date.parse(item.provenance.observedAt)) ||
        bytes.byteLength > CONTEXT_LIMITS.maxSourceBytes ||
        includedBytes > CONTEXT_LIMITS.maxManifestBytes ||
        item.byteLength !== bytes.byteLength ||
        item.sha256 !== contentDigest
      ) {
        return false;
      }
      const identity: JsonObject = {
        sourceId: item.sourceId,
        contentDigest,
        capturedAt: item.capturedAt,
        classification: item.classification,
        disclosure: item.disclosure,
      };
      if (item.id !== contentAddress("snapshot", identity)) {
        return false;
      }
    }

    for (const omission of manifest.omitted) {
      if (
        omission.sourceId.trim().length === 0 ||
        omission.sourceId.length > 128 ||
        sourceIds.has(omission.sourceId) ||
        !omissionReasons.has(omission.reason)
      ) {
        return false;
      }
      sourceIds.add(omission.sourceId);
    }

    const expectedDigest = sha256(
      stableStringify(
        manifestDigestBody({
          purpose: manifest.purpose,
          principalId: manifest.principalId,
          createdAt: manifest.createdAt,
          classificationCeiling: manifest.classificationCeiling,
          items: manifest.items,
          omitted: manifest.omitted,
        }),
      ),
    );
    return (
      manifest.digest === expectedDigest &&
      manifest.id === `context_${expectedDigest.slice(0, 24)}`
    );
  } catch {
    return false;
  }
}

export function sealContextManifest(manifest: ContextManifest): ContextManifest {
  if (!verifyContextManifestIntegrity(manifest)) {
    throw new TypeError("Context manifest failed its integrity check");
  }
  const items = Object.freeze(
    manifest.items.map((item) =>
      Object.freeze({
        ...item,
        provenance: Object.freeze({ ...item.provenance }),
      }),
    ),
  );
  const omitted = Object.freeze(
    manifest.omitted.map((item) => Object.freeze({ ...item })),
  );
  return Object.freeze({ ...manifest, items, omitted });
}

export function manifestSourceIds(manifest: ContextManifest): readonly string[] {
  return manifest.items.map((item) => item.sourceId);
}

export function manifestDisclosurePolicies(
  manifest: ContextManifest,
): readonly DisclosurePolicy[] {
  return Object.freeze(manifest.items.map((item) => item.disclosure));
}
