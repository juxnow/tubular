import { deepFreezeJsonObject, type JsonValue } from "../core/json.js";
import type { PerspectiveReference } from "./definition.js";
import {
  type ContextRecord,
  createPerspectiveInvocation,
  createPerspectiveSuccessOutcome,
  type ExternalIdentityReference,
  type OpaqueTrace,
  PERSPECTIVE_INVOCATION_PROTOCOL,
  PERSPECTIVE_OUTCOME_PROTOCOL,
  type PerspectiveInvocation,
  type PerspectiveOutcome,
  type PerspectiveSuccessOutcome,
  type PrincipalReference,
  type ProvenanceReference,
  type ScopeReference,
} from "./messages.js";

/** Reserved trace namespace used to preserve legacy AAPI provider request identifiers. */
export const AAPI_V0_PROVIDER_TRACE_NAMESPACE = "aapi-v0" as const;
/** Trace kind distinguishing legacy provider request references from other diagnostics. */
export const AAPI_V0_PROVIDER_TRACE_KIND = "provider-request" as const;

/** Scope categories understood by the legacy AAPI compatibility adapter, not a finalized MCCP specification. */
export type AapiV0ScopeKind = "private" | "project" | "external-resource";

/** Legacy provider subject reference preserved during translation without authentication. */
export interface AapiV0ExternalIdentity {
  /** Legacy provider namespace, translated without assuming provider authentication. */
  readonly provider: string;
  /** External system's subject identifier within its namespace; host verification is required. */
  readonly subject: string;
}

/** Legacy principal plus one external identity; the host must establish both independently of model arguments. */
export interface AapiV0Principal {
  /** Host-selected principal identity preserved across legacy translation without authentication. */
  readonly id: string;
  /** Legacy external identity assertion; translation preserves it without authenticating it. */
  readonly externalIdentity: AapiV0ExternalIdentity;
}

/** Legacy scope selection mapped to one portable scope reference. */
export interface AapiV0Scope {
  /** Scope identity meaningful within its legacy scope kind. */
  readonly id: string;
  /** One of the three supported legacy scope kinds; other portable kinds cannot be translated losslessly. */
  readonly kind: AapiV0ScopeKind;
}

/** Legacy source location metadata translated without retrieval or authority inference. */
export interface AapiV0SourceReference {
  /** Legacy provider namespace, translated without assuming provider authentication. */
  readonly provider: string;
  /** Legacy source resource kind retained during portable-message translation. */
  readonly resourceType: string;
  /** Provider-scoped source resource identifier, retained without dereferencing it. */
  readonly resourceId: string;
  /** Parent resource identifier when known; absence or null means no parent was supplied. */
  readonly parentResourceId?: string;
}

/** Legacy textual context record with author attribution and source provenance. */
export interface AapiV0ContextItem {
  /** Source context record identity preserved during translation. */
  readonly id: string;
  /** Legacy human-readable attribution, not an authenticated author identity. */
  readonly authorLabel: string;
  /** Source-supplied event time retained during translation; message validation only checks nonempty text. */
  readonly occurredAt: string;
  /** Explicitly supplied context payload; provenance and classification do not make its instructions trusted. */
  readonly content: string;
  /** Explicit source provenance retained without retrieval or authority inference. */
  readonly source: AapiV0SourceReference;
}

/** Legacy invocation envelope translated to portable contract references without executing the capability. */
export interface AapiV0Invocation<TInput> {
  /** Caller-selected correlation value preserved in outcomes; it is not an idempotency or authority token. */
  readonly correlationId: string;
  /** Explicit host-selected principal reference; message construction does not authenticate it. */
  readonly principal: AapiV0Principal;
  /** Single selected legacy scope; this shape cannot represent multiple portable scopes. */
  readonly scope: AapiV0Scope;
  /** Exact capability reference selected from the portable definition. */
  readonly capability: string;
  /** Untrusted capability input. Validate it before dispatch; its fields never establish host authority. */
  readonly input: TInput;
  /** Explicit source provenance retained without retrieval or authority inference. */
  readonly source: AapiV0SourceReference;
}

/** Legacy successful result plus optional provider trace; failures have no equivalent in this legacy shape. */
export interface AapiV0Result<TOutput> {
  /** Caller-selected correlation value preserved in outcomes; it is not an idempotency or authority token. */
  readonly correlationId: string;
  /** Exact capability reference selected from the portable definition. */
  readonly capability: string;
  /** Successful capability output, which must satisfy the declared output schema before disclosure. */
  readonly output: TOutput;
  /** Optional provider trace identifier, preserved as diagnostic data rather than execution proof. */
  readonly providerRequestId?: string;
}

/** Translate a legacy provider subject to a frozen namespaced reference without authenticating it. */
export function aapiV0ExternalIdentityToPerspective(
  identity: AapiV0ExternalIdentity,
): ExternalIdentityReference {
  return deepFreezeJsonObject({
    namespace: identity.provider,
    subject: identity.subject,
  });
}

/** Translate a namespaced subject into the legacy provider shape without adding authority. */
export function perspectiveExternalIdentityToAapiV0(
  identity: ExternalIdentityReference,
): AapiV0ExternalIdentity {
  return Object.freeze({
    provider: identity.namespace,
    subject: identity.subject,
  });
}

/** Translate a legacy principal into a frozen portable principal with one external identity. */
export function aapiV0PrincipalToPerspective(principal: AapiV0Principal): PrincipalReference {
  return deepFreezeJsonObject({
    id: principal.id,
    externalIdentities: [aapiV0ExternalIdentityToPerspective(principal.externalIdentity)],
  });
}

/** Translate only principals with exactly one external identity; reject unrepresentable multi-identity values. */
export function perspectivePrincipalToAapiV0(principal: PrincipalReference): AapiV0Principal {
  const identity = principal.externalIdentities[0];
  if (principal.externalIdentities.length !== 1 || identity === undefined) {
    throw new TypeError("An AAPI v0 principal must have exactly one external identity");
  }
  return Object.freeze({
    id: principal.id,
    externalIdentity: perspectiveExternalIdentityToAapiV0(identity),
  });
}

/** Preserve a legacy scope's identifier and kind in a frozen portable reference. */
export function aapiV0ScopeToPerspective(scope: AapiV0Scope): ScopeReference {
  return deepFreezeJsonObject({ id: scope.id, kind: scope.kind });
}

/** Translate only the three legacy scope kinds; reject newer kinds instead of silently coercing them. */
export function perspectiveScopeToAapiV0(scope: ScopeReference): AapiV0Scope {
  if (!isAapiV0ScopeKind(scope.kind)) {
    throw new TypeError(`Unsupported AAPI v0 scope kind: ${scope.kind}`);
  }
  return Object.freeze({ id: scope.id, kind: scope.kind });
}

/** Translate source metadata, using explicit null for an absent parent reference. */
export function aapiV0SourceToPerspective(source: AapiV0SourceReference): ProvenanceReference {
  return deepFreezeJsonObject({
    namespace: source.provider,
    resourceKind: source.resourceType,
    resourceId: source.resourceId,
    parentResourceId: source.parentResourceId ?? null,
  });
}

/** Translate source metadata, omitting the legacy parent property when the portable parent is null. */
export function perspectiveSourceToAapiV0(source: ProvenanceReference): AapiV0SourceReference {
  if (source.parentResourceId === null) {
    return Object.freeze({
      provider: source.namespace,
      resourceType: source.resourceKind,
      resourceId: source.resourceId,
    });
  }
  return Object.freeze({
    provider: source.namespace,
    resourceType: source.resourceKind,
    resourceId: source.resourceId,
    parentResourceId: source.parentResourceId,
  });
}

/** Preserve text, attribution, time, and provenance in a frozen portable context record. */
export function aapiV0ContextItemToPerspective(item: AapiV0ContextItem): ContextRecord {
  return deepFreezeJsonObject({
    id: item.id,
    attribution: { label: item.authorLabel },
    occurredAt: item.occurredAt,
    content: item.content,
    provenance: aapiV0SourceToPerspective(item.source),
  });
}

/** Translate text context only; reject nonstring payloads that the legacy shape cannot preserve. */
export function perspectiveContextItemToAapiV0(item: ContextRecord): AapiV0ContextItem {
  if (typeof item.content !== "string") {
    throw new TypeError("An AAPI v0 context item must contain text content");
  }
  return Object.freeze({
    id: item.id,
    authorLabel: item.attribution.label,
    occurredAt: item.occurredAt,
    content: item.content,
    source: perspectiveSourceToAapiV0(item.provenance),
  });
}

/** Bind a legacy request to an explicit portable contract and capability version without adding authority evidence. */
export function aapiV0InvocationToPerspective<TInput>(
  invocation: AapiV0Invocation<TInput>,
  perspective: PerspectiveReference,
  capabilityVersion: string,
): PerspectiveInvocation {
  return createPerspectiveInvocation({
    perspective,
    correlationId: invocation.correlationId,
    principal: aapiV0PrincipalToPerspective(invocation.principal),
    scopes: [aapiV0ScopeToPerspective(invocation.scope)],
    capability: { id: invocation.capability, version: capabilityVersion },
    input: invocation.input,
    contexts: [],
    authorityEvidence: [],
    source: aapiV0SourceToPerspective(invocation.source),
  });
}

/** Translate one-scope invocations only; reject context or authority references the legacy envelope would lose. */
export function perspectiveInvocationToAapiV0(
  invocation: PerspectiveInvocation,
): AapiV0Invocation<JsonValue> {
  if (invocation.protocol !== PERSPECTIVE_INVOCATION_PROTOCOL) {
    throw new TypeError("Unsupported Perspective invocation protocol");
  }
  const scope = invocation.scopes[0];
  if (invocation.scopes.length !== 1 || scope === undefined) {
    throw new TypeError("AAPI v0 requires exactly one scope");
  }
  if (invocation.contexts.length > 0 || invocation.authorityEvidence.length > 0) {
    throw new TypeError(
      "AAPI v0 cannot losslessly represent Perspective context or authority references",
    );
  }
  return Object.freeze({
    correlationId: invocation.correlationId,
    principal: perspectivePrincipalToAapiV0(invocation.principal),
    scope: perspectiveScopeToAapiV0(scope),
    capability: invocation.capability.id,
    input: invocation.input,
    source: perspectiveSourceToAapiV0(invocation.source),
  });
}

/** Translate a legacy success and optional provider trace into a checked portable success envelope. */
export function aapiV0ResultToPerspective<TOutput>(
  result: AapiV0Result<TOutput>,
  perspective: PerspectiveReference,
  capabilityVersion: string,
): PerspectiveSuccessOutcome {
  const traces: readonly OpaqueTrace[] =
    result.providerRequestId === undefined
      ? []
      : [
          {
            namespace: AAPI_V0_PROVIDER_TRACE_NAMESPACE,
            kind: AAPI_V0_PROVIDER_TRACE_KIND,
            id: result.providerRequestId,
          },
        ];
  return createPerspectiveSuccessOutcome({
    perspective,
    correlationId: result.correlationId,
    capability: { id: result.capability, version: capabilityVersion },
    output: result.output,
    traces,
  });
}

/** Translate successful outcomes with at most one compatible trace; reject failures and lossy trace conversions. */
export function perspectiveOutcomeToAapiV0(outcome: PerspectiveOutcome): AapiV0Result<JsonValue> {
  if (outcome.protocol !== PERSPECTIVE_OUTCOME_PROTOCOL) {
    throw new TypeError("Unsupported Perspective outcome protocol");
  }
  if (outcome.status !== "success") {
    throw new TypeError("AAPI v0 has no lossless failure-result representation");
  }

  const providerTraces = outcome.traces.filter(
    (trace) =>
      trace.namespace === AAPI_V0_PROVIDER_TRACE_NAMESPACE &&
      trace.kind === AAPI_V0_PROVIDER_TRACE_KIND,
  );
  if (providerTraces.length > 1) {
    throw new TypeError("AAPI v0 allows at most one provider request trace");
  }
  if (providerTraces.length !== outcome.traces.length) {
    throw new TypeError("AAPI v0 cannot represent non-provider outcome traces");
  }

  const providerTrace = providerTraces[0];
  if (providerTrace === undefined) {
    return Object.freeze({
      correlationId: outcome.correlationId,
      capability: outcome.capability.id,
      output: outcome.output,
    });
  }
  return Object.freeze({
    correlationId: outcome.correlationId,
    capability: outcome.capability.id,
    output: outcome.output,
    providerRequestId: providerTrace.id,
  });
}

/** Narrow a portable scope kind to the legacy adapter's supported vocabulary. */
function isAapiV0ScopeKind(value: string): value is AapiV0ScopeKind {
  return value === "private" || value === "project" || value === "external-resource";
}
