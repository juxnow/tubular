import { deepFreezeJsonObject, type JsonValue } from "../core/json.js";
import type { PortAuthorityReference } from "./definition.js";
import {
  createPortAuthorityInvocation,
  createPortAuthoritySuccessOutcome,
  PORT_AUTHORITY_INVOCATION_PROTOCOL,
  PORT_AUTHORITY_OUTCOME_PROTOCOL,
  type ContextRecord,
  type ExternalIdentityReference,
  type OpaqueTrace,
  type PrincipalReference,
  type ProvenanceReference,
  type ScopeReference,
  type PortAuthorityInvocation,
  type PortAuthorityOutcome,
  type PortAuthoritySuccessOutcome,
} from "./messages.js";

export const AAPI_V0_PROVIDER_TRACE_NAMESPACE = "aapi-v0" as const;
export const AAPI_V0_PROVIDER_TRACE_KIND = "provider-request" as const;

export type AapiV0ScopeKind = "private" | "project" | "external-resource";

export interface AapiV0ExternalIdentity {
  readonly provider: string;
  readonly subject: string;
}

export interface AapiV0Principal {
  readonly id: string;
  readonly externalIdentity: AapiV0ExternalIdentity;
}

export interface AapiV0Scope {
  readonly id: string;
  readonly kind: AapiV0ScopeKind;
}

export interface AapiV0SourceReference {
  readonly provider: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly parentResourceId?: string;
}

export interface AapiV0ContextItem {
  readonly id: string;
  readonly authorLabel: string;
  readonly occurredAt: string;
  readonly content: string;
  readonly source: AapiV0SourceReference;
}

export interface AapiV0Invocation<TInput> {
  readonly correlationId: string;
  readonly principal: AapiV0Principal;
  readonly scope: AapiV0Scope;
  readonly capability: string;
  readonly input: TInput;
  readonly source: AapiV0SourceReference;
}

export interface AapiV0Result<TOutput> {
  readonly correlationId: string;
  readonly capability: string;
  readonly output: TOutput;
  readonly providerRequestId?: string;
}

export function aapiV0ExternalIdentityToPortAuthority(
  identity: AapiV0ExternalIdentity,
): ExternalIdentityReference {
  return deepFreezeJsonObject({
    namespace: identity.provider,
    subject: identity.subject,
  });
}

export function portAuthorityExternalIdentityToAapiV0(
  identity: ExternalIdentityReference,
): AapiV0ExternalIdentity {
  return Object.freeze({
    provider: identity.namespace,
    subject: identity.subject,
  });
}

export function aapiV0PrincipalToPortAuthority(
  principal: AapiV0Principal,
): PrincipalReference {
  return deepFreezeJsonObject({
    id: principal.id,
    externalIdentities: [
      aapiV0ExternalIdentityToPortAuthority(principal.externalIdentity),
    ],
  });
}

export function portAuthorityPrincipalToAapiV0(
  principal: PrincipalReference,
): AapiV0Principal {
  const identity = principal.externalIdentities[0];
  if (principal.externalIdentities.length !== 1 || identity === undefined) {
    throw new TypeError(
      "An AAPI v0 principal must have exactly one external identity",
    );
  }
  return Object.freeze({
    id: principal.id,
    externalIdentity: portAuthorityExternalIdentityToAapiV0(identity),
  });
}

export function aapiV0ScopeToPortAuthority(scope: AapiV0Scope): ScopeReference {
  return deepFreezeJsonObject({ id: scope.id, kind: scope.kind });
}

export function portAuthorityScopeToAapiV0(scope: ScopeReference): AapiV0Scope {
  if (!isAapiV0ScopeKind(scope.kind)) {
    throw new TypeError(`Unsupported AAPI v0 scope kind: ${scope.kind}`);
  }
  return Object.freeze({ id: scope.id, kind: scope.kind });
}

export function aapiV0SourceToPortAuthority(
  source: AapiV0SourceReference,
): ProvenanceReference {
  return deepFreezeJsonObject({
    namespace: source.provider,
    resourceKind: source.resourceType,
    resourceId: source.resourceId,
    parentResourceId: source.parentResourceId ?? null,
  });
}

export function portAuthoritySourceToAapiV0(
  source: ProvenanceReference,
): AapiV0SourceReference {
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

export function aapiV0ContextItemToPortAuthority(
  item: AapiV0ContextItem,
): ContextRecord {
  return deepFreezeJsonObject({
    id: item.id,
    attribution: { label: item.authorLabel },
    occurredAt: item.occurredAt,
    content: item.content,
    provenance: aapiV0SourceToPortAuthority(item.source),
  });
}

export function portAuthorityContextItemToAapiV0(
  item: ContextRecord,
): AapiV0ContextItem {
  if (typeof item.content !== "string") {
    throw new TypeError("An AAPI v0 context item must contain text content");
  }
  return Object.freeze({
    id: item.id,
    authorLabel: item.attribution.label,
    occurredAt: item.occurredAt,
    content: item.content,
    source: portAuthoritySourceToAapiV0(item.provenance),
  });
}

export function aapiV0InvocationToPortAuthority<TInput>(
  invocation: AapiV0Invocation<TInput>,
  portAuthority: PortAuthorityReference,
  capabilityVersion: string,
): PortAuthorityInvocation {
  return createPortAuthorityInvocation({
    portAuthority,
    correlationId: invocation.correlationId,
    principal: aapiV0PrincipalToPortAuthority(invocation.principal),
    scopes: [aapiV0ScopeToPortAuthority(invocation.scope)],
    capability: { id: invocation.capability, version: capabilityVersion },
    input: invocation.input,
    contexts: [],
    authorityEvidence: [],
    source: aapiV0SourceToPortAuthority(invocation.source),
  });
}

export function portAuthorityInvocationToAapiV0(
  invocation: PortAuthorityInvocation,
): AapiV0Invocation<JsonValue> {
  if (invocation.protocol !== PORT_AUTHORITY_INVOCATION_PROTOCOL) {
    throw new TypeError("Unsupported Port Authority invocation protocol");
  }
  const scope = invocation.scopes[0];
  if (invocation.scopes.length !== 1 || scope === undefined) {
    throw new TypeError("AAPI v0 requires exactly one scope");
  }
  if (invocation.contexts.length > 0 || invocation.authorityEvidence.length > 0) {
    throw new TypeError(
      "AAPI v0 cannot losslessly represent Port Authority context or authority references",
    );
  }
  return Object.freeze({
    correlationId: invocation.correlationId,
    principal: portAuthorityPrincipalToAapiV0(invocation.principal),
    scope: portAuthorityScopeToAapiV0(scope),
    capability: invocation.capability.id,
    input: invocation.input,
    source: portAuthoritySourceToAapiV0(invocation.source),
  });
}

export function aapiV0ResultToPortAuthority<TOutput>(
  result: AapiV0Result<TOutput>,
  portAuthority: PortAuthorityReference,
  capabilityVersion: string,
): PortAuthoritySuccessOutcome {
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
  return createPortAuthoritySuccessOutcome({
    portAuthority,
    correlationId: result.correlationId,
    capability: { id: result.capability, version: capabilityVersion },
    output: result.output,
    traces,
  });
}

export function portAuthorityOutcomeToAapiV0(
  outcome: PortAuthorityOutcome,
): AapiV0Result<JsonValue> {
  if (outcome.protocol !== PORT_AUTHORITY_OUTCOME_PROTOCOL) {
    throw new TypeError("Unsupported Port Authority outcome protocol");
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

function isAapiV0ScopeKind(value: string): value is AapiV0ScopeKind {
  return (
    value === "private" ||
    value === "project" ||
    value === "external-resource"
  );
}
