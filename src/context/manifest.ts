import { contentAddress, type JsonObject, sha256, stableStringify } from "../core/json.js";
import type { Clock } from "../core/time.js";

/** Sensitivity order is public, internal, private, then secret; selection excludes values above its ceiling. */
export type DataClassification = "public" | "internal" | "private" | "secret";

/** Shareable permits ordinary selection, explicit-grant needs manifest binding, and local-only blocks governed agent actions. */
export type DisclosurePolicy = "shareable" | "explicit-grant" | "local-only";

/** Supported origin categories. A locator is retained as evidence without automatically fetching its source. */
export type ProvenanceKind = "file" | "url" | "message" | "manual" | "generated";

/** Host-recorded origin and observation metadata; hashes preserve it but do not authenticate its claims. */
export interface Provenance {
  /** Origin category used to interpret the locator; no source retrieval is implied. */
  readonly kind: ProvenanceKind;
  /** Host-supplied source location retained for provenance; no network retrieval occurs. */
  readonly locator: string;
  /** Host-supplied observation timestamp retained as provenance; it is not proof of authenticity. */
  readonly observedAt: string;
}

/** Candidate context supplied by the host. It enters a manifest only through explicit selection and limits. */
export interface ContextSource {
  /** Host-chosen stable selection key; duplicate source identifiers are rejected during manifest construction. */
  readonly id: string;
  /** Human-readable attribution or source label. It must not be used as an authenticated identity. */
  readonly label: string;
  /** Host-supplied media type describing the text payload; no implicit decoding or fetching occurs. */
  readonly mediaType: string;
  /** Explicitly supplied context payload; provenance and classification do not make its instructions trusted. */
  readonly content: string;
  /** Host-assigned sensitivity classification used during explicit context selection. */
  readonly classification: DataClassification;
  /** Host-assigned disclosure restriction; local-only context cannot accompany a governed agent action. */
  readonly disclosure: DisclosurePolicy;
  /** Host-supplied origin metadata, included verbatim in captured context and its digest. */
  readonly provenance: Provenance;
}

/** Captured source content plus immutable metadata, byte count, and content digest. */
export interface ContextSnapshot {
  /** Content-derived snapshot identifier binding captured content and metadata. */
  readonly id: string;
  /** Identifier of the original context source, retained across snapshots. */
  readonly sourceId: string;
  /** Human-readable attribution or source label. It must not be used as an authenticated identity. */
  readonly label: string;
  /** Host-supplied media type describing the text payload; no implicit decoding or fetching occurs. */
  readonly mediaType: string;
  /** Explicitly supplied context payload; provenance and classification do not make its instructions trusted. */
  readonly content: string;
  /** UTF-8 byte count of the captured content, used for context size limits. */
  readonly byteLength: number;
  /** Lowercase SHA-256 hex digest of the captured UTF-8 content, not a signature. */
  readonly sha256: string;
  /** Snapshot capture instant serialized as UTC ISO 8601. */
  readonly capturedAt: string;
  /** Host-assigned sensitivity classification used during explicit context selection. */
  readonly classification: DataClassification;
  /** Host-assigned disclosure restriction; local-only context cannot accompany a governed agent action. */
  readonly disclosure: DisclosurePolicy;
  /** Origin metadata frozen with captured content; integrity does not authenticate the original source. */
  readonly provenance: Provenance;
}

/** Reason a source was excluded, including selection, classification, source lookup, and bounded-size failures. */
export type ContextOmissionReason =
  | "source-not-found"
  | "classification-exceeds-ceiling"
  | "source-exceeds-byte-limit"
  | "manifest-byte-budget-exceeded";

/** Hard selection and payload limits for context construction and integrity checks; byte bounds use UTF-8. */
export const CONTEXT_LIMITS = Object.freeze({
  maxSelectedSources: 64,
  maxSourceBytes: 256 * 1_024,
  maxManifestBytes: 1_024 * 1_024,
});

/** Auditable selection outcome that records an excluded source without copying its content. */
export interface ContextOmission {
  /** Identifier of the original context source, retained across snapshots. */
  readonly sourceId: string;
  /** Recorded exclusion category explaining why the source was not included. */
  readonly reason: ContextOmissionReason;
}

/** Immutable, content-addressed selection for one principal and purpose; authority must bind its exact digest. */
export interface ContextManifest {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.context/v1";
  /** Content-derived identifier computed from this record's canonical digest; it is not a bearer credential. */
  readonly id: string;
  /** Host-defined reason for selecting this context; it does not expand disclosure permissions. */
  readonly purpose: string;
  /** Host-established principal identifier. Tool arguments must not supply or override this identity. */
  readonly principalId: string;
  /** Creation instant serialized as UTC ISO 8601 by the injected clock. */
  readonly createdAt: string;
  /** Highest data classification eligible for inclusion; stricter sources are recorded as omissions. */
  readonly classificationCeiling: DataClassification;
  /** Selected immutable snapshots in deterministic order, bounded by CONTEXT_LIMITS. */
  readonly items: readonly ContextSnapshot[];
  /** Sources excluded during selection, with reasons; omitted content is not copied into the manifest. */
  readonly omitted: readonly ContextOmission[];
  /** Lowercase SHA-256 hex over the canonical record body, excluding the derived id and digest; this proves integrity, not authenticity. */
  readonly digest: string;
}

/** Host-controlled context selection and sensitivity ceiling; no model-driven implicit expansion occurs. */
export interface BuildContextManifestRequest {
  /** Host-defined reason for selecting this context; it does not expand disclosure permissions. */
  readonly purpose: string;
  /** Host-established principal identifier. Tool arguments must not supply or override this identity. */
  readonly principalId: string;
  /** Explicit source selection. Unselected sources never enter the manifest implicitly. */
  readonly selectedSourceIds: readonly string[];
  /** Highest data classification eligible for inclusion; stricter sources are recorded as omissions. */
  readonly classificationCeiling: DataClassification;
}

const classificationRanks: Readonly<Record<DataClassification, number>> = {
  public: 0,
  internal: 1,
  private: 2,
  secret: 3,
};

const disclosurePolicies = new Set<DisclosurePolicy>(["shareable", "explicit-grant", "local-only"]);

const provenanceKinds = new Set<ProvenanceKind>(["file", "url", "message", "manual", "generated"]);

const omissionReasons = new Set<ContextOmissionReason>([
  "source-not-found",
  "classification-exceeds-ceiling",
  "source-exceeds-byte-limit",
  "manifest-byte-budget-exceeded",
]);

/** Selected and omitted context records plus purpose, principal, and creation time covered by the digest. */
interface ManifestDigestFields {
  /** Host-defined reason for selecting this context; it does not expand disclosure permissions. */
  readonly purpose: string;
  /** Host-established principal identifier. Tool arguments must not supply or override this identity. */
  readonly principalId: string;
  /** Creation instant serialized as UTC ISO 8601 by the injected clock. */
  readonly createdAt: string;
  /** Highest data classification eligible for inclusion; stricter sources are recorded as omissions. */
  readonly classificationCeiling: DataClassification;
  /** Included snapshots whose content and metadata participate in the manifest digest. */
  readonly items: readonly ContextSnapshot[];
  /** Sources excluded during selection, with reasons; omitted content is not copied into the manifest. */
  readonly omitted: readonly ContextOmission[];
}

/** Render the host-recorded origin metadata without retrieving the source as plain JSON for serialization and hashing. */
function provenanceToJson(provenance: Provenance): JsonObject {
  return {
    kind: provenance.kind,
    locator: provenance.locator,
    observedAt: provenance.observedAt,
  };
}

/** Render the captured context and its provenance, size, and digest as plain JSON for serialization and hashing. */
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

/** Render the source exclusion reference and reason without excluded content as plain JSON for serialization and hashing. */
function omissionToJson(omission: ContextOmission): JsonObject {
  return { sourceId: omission.sourceId, reason: omission.reason };
}

/** Render principal, purpose, timestamp, selected snapshots, and omissions for canonical hashing. */
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

/** Render the selected context manifest including omission evidence and digest as plain JSON for serialization and hashing. */
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

/** Capture one source with UTF-8 length and content hash at the supplied clock instant. */
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

/** Select only requested sources under classification and size limits; record omissions and seal the result. */
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
      omitted.push(Object.freeze({ sourceId, reason: "classification-exceeds-ceiling" }));
      continue;
    }
    const sourceBytes = new TextEncoder().encode(source.content).byteLength;
    if (sourceBytes > CONTEXT_LIMITS.maxSourceBytes) {
      omitted.push(Object.freeze({ sourceId, reason: "source-exceeds-byte-limit" }));
      continue;
    }
    if (includedBytes + sourceBytes > CONTEXT_LIMITS.maxManifestBytes) {
      omitted.push(Object.freeze({ sourceId, reason: "manifest-byte-budget-exceeded" }));
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

/** Check manifest bounds, per-snapshot hashes, and the canonical envelope digest; no source fetching occurs. */
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
      manifest.digest === expectedDigest && manifest.id === `context_${expectedDigest.slice(0, 24)}`
    );
  } catch {
    return false;
  }
}

/** Verify integrity, detach nested data, and freeze the manifest before host registration. */
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
  const omitted = Object.freeze(manifest.omitted.map((item) => Object.freeze({ ...item })));
  return Object.freeze({ ...manifest, items, omitted });
}

/** Return the included sources' identifiers in manifest order, excluding recorded omissions. */
export function manifestSourceIds(manifest: ContextManifest): readonly string[] {
  return manifest.items.map((item) => item.sourceId);
}

/** Return distinct disclosure labels from the selected snapshots for host review. */
export function manifestDisclosurePolicies(manifest: ContextManifest): readonly DisclosurePolicy[] {
  return Object.freeze(manifest.items.map((item) => item.disclosure));
}
