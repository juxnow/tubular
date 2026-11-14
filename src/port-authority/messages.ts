import {
  deepFreezeJsonObject,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";
import {
  PORT_AUTHORITY_PROTOCOL,
  type PortAuthorityReference,
} from "./definition.js";

export const PORT_AUTHORITY_INVOCATION_PROTOCOL =
  "port-authority.invocation/v0" as const;
export const PORT_AUTHORITY_OUTCOME_PROTOCOL =
  "port-authority.outcome/v0" as const;

export interface ExternalIdentityReference extends JsonObject {
  readonly namespace: string;
  readonly subject: string;
}

export interface PrincipalReference extends JsonObject {
  readonly id: string;
  readonly externalIdentities: readonly ExternalIdentityReference[];
}

export interface ScopeReference extends JsonObject {
  readonly id: string;
  readonly kind: string;
}

export interface CapabilityReference extends JsonObject {
  readonly id: string;
  readonly version: string;
}

export interface ProvenanceReference extends JsonObject {
  readonly namespace: string;
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly parentResourceId: string | null;
}

export interface ContextBindingReference extends JsonObject {
  readonly kindRef: string;
  readonly id: string;
  readonly digest: string | null;
}

export interface AuthorityEvidenceReference extends JsonObject {
  readonly schemeRef: string;
  readonly id: string;
  readonly digest: string | null;
}

export interface AttributionReference extends JsonObject {
  readonly label: string;
}

export interface ContextRecord extends JsonObject {
  readonly id: string;
  readonly attribution: AttributionReference;
  readonly occurredAt: string;
  readonly content: JsonValue;
  readonly provenance: ProvenanceReference;
}

export interface OpaqueTrace extends JsonObject {
  readonly namespace: string;
  readonly kind: string;
  readonly id: string;
}

export interface PortAuthorityInvocation extends JsonObject {
  readonly protocol: typeof PORT_AUTHORITY_INVOCATION_PROTOCOL;
  readonly portAuthority: PortAuthorityReference;
  readonly correlationId: string;
  readonly principal: PrincipalReference;
  readonly scopes: readonly ScopeReference[];
  readonly capability: CapabilityReference;
  readonly input: JsonValue;
  readonly contexts: readonly ContextBindingReference[];
  readonly authorityEvidence: readonly AuthorityEvidenceReference[];
  readonly source: ProvenanceReference;
}

export interface PortAuthoritySuccessOutcome extends JsonObject {
  readonly protocol: typeof PORT_AUTHORITY_OUTCOME_PROTOCOL;
  readonly portAuthority: PortAuthorityReference;
  readonly correlationId: string;
  readonly capability: CapabilityReference;
  readonly status: "success";
  readonly output: JsonValue;
  readonly traces: readonly OpaqueTrace[];
}

export interface PortAuthorityFailure extends JsonObject {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details: JsonObject;
}

export interface PortAuthorityFailureOutcome extends JsonObject {
  readonly protocol: typeof PORT_AUTHORITY_OUTCOME_PROTOCOL;
  readonly portAuthority: PortAuthorityReference;
  readonly correlationId: string;
  readonly capability: CapabilityReference;
  readonly status: "failure";
  readonly error: PortAuthorityFailure;
  readonly traces: readonly OpaqueTrace[];
}

export type PortAuthorityOutcome =
  | PortAuthoritySuccessOutcome
  | PortAuthorityFailureOutcome;

export interface CreatePortAuthorityInvocationRequest {
  readonly portAuthority: PortAuthorityReference;
  readonly correlationId: string;
  readonly principal: PrincipalReference;
  readonly scopes: readonly ScopeReference[];
  readonly capability: CapabilityReference;
  readonly input: unknown;
  readonly contexts?: readonly ContextBindingReference[];
  readonly authorityEvidence?: readonly AuthorityEvidenceReference[];
  readonly source: ProvenanceReference;
}

export interface CreatePortAuthoritySuccessOutcomeRequest {
  readonly portAuthority: PortAuthorityReference;
  readonly correlationId: string;
  readonly capability: CapabilityReference;
  readonly output: unknown;
  readonly traces?: readonly OpaqueTrace[];
}

export interface CreatePortAuthorityFailureOutcomeRequest {
  readonly portAuthority: PortAuthorityReference;
  readonly correlationId: string;
  readonly capability: CapabilityReference;
  readonly error: PortAuthorityFailure;
  readonly traces?: readonly OpaqueTrace[];
}

export function assertJsonSafe(
  value: unknown,
  label: string,
): asserts value is JsonValue {
  assertJsonSafeValue(value, label, new WeakSet<object>());
}

function assertJsonSafeValue(
  value: unknown,
  label: string,
  ancestors: WeakSet<object>,
): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must contain only finite numbers`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError(`${label} must not contain a circular reference`);
    }
    ancestors.add(value);
    for (const item of value) {
      assertJsonSafeValue(item, label, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (!isJsonObject(value)) {
    throw new TypeError(`${label} must be JSON-safe`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must contain only plain JSON objects`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} must not contain symbol properties`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} must not contain a circular reference`);
  }
  ancestors.add(value);
  for (const child of Object.values(value)) {
    if (child === undefined) {
      throw new TypeError(`${label} must not contain undefined`);
    }
    assertJsonSafeValue(child, label, ancestors);
  }
  ancestors.delete(value);
}

function assertText(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

function assertPortAuthorityReference(reference: PortAuthorityReference): void {
  if (reference.specification !== PORT_AUTHORITY_PROTOCOL) {
    throw new TypeError("Port Authority reference uses an unsupported specification");
  }
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(
      reference.version,
    )
  ) {
    throw new TypeError("Port Authority reference version must be a semantic version");
  }
  if (!/^[a-f0-9]{64}$/u.test(reference.digest)) {
    throw new TypeError("Port Authority reference digest must be a SHA-256 digest");
  }
  if (reference.id !== `port_authority_${reference.digest.slice(0, 24)}`) {
    throw new TypeError("Port Authority reference id must match its digest");
  }
}

function assertExternalIdentity(identity: ExternalIdentityReference): void {
  assertText(identity.namespace, "External identity namespace");
  assertText(identity.subject, "External identity subject");
}

function assertPrincipal(principal: PrincipalReference): void {
  assertText(principal.id, "Principal id");
  for (const identity of principal.externalIdentities) {
    assertExternalIdentity(identity);
  }
}

function assertScope(scope: ScopeReference): void {
  assertText(scope.id, "Scope id");
  assertText(scope.kind, "Scope kind");
}

function assertCapability(capability: CapabilityReference): void {
  assertText(capability.id, "Capability id");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(capability.version)) {
    throw new TypeError("Capability version must be a semantic version");
  }
}

function assertProvenance(provenance: ProvenanceReference): void {
  assertText(provenance.namespace, "Provenance namespace");
  assertText(provenance.resourceKind, "Provenance resource kind");
  assertText(provenance.resourceId, "Provenance resource id");
  if (provenance.parentResourceId !== null) {
    assertText(provenance.parentResourceId, "Provenance parent resource id");
  }
}

function assertDigest(value: string | null, label: string): void {
  if (value !== null && !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a SHA-256 digest when present`);
  }
}

function assertContextBinding(binding: ContextBindingReference): void {
  assertText(binding.kindRef, "Context kind reference");
  assertText(binding.id, "Context binding id");
  assertDigest(binding.digest, "Context binding digest");
}

function assertAuthorityEvidence(evidence: AuthorityEvidenceReference): void {
  assertText(evidence.schemeRef, "Authority scheme reference");
  assertText(evidence.id, "Authority evidence id");
  assertDigest(evidence.digest, "Authority evidence digest");
}

function assertTrace(trace: OpaqueTrace): void {
  assertText(trace.namespace, "Trace namespace");
  assertText(trace.kind, "Trace kind");
  assertText(trace.id, "Trace id");
}

function assertEnvelope(
  portAuthority: PortAuthorityReference,
  correlationId: string,
  capability: CapabilityReference,
  traces: readonly OpaqueTrace[],
): void {
  assertPortAuthorityReference(portAuthority);
  assertText(correlationId, "Correlation id");
  assertCapability(capability);
  for (const trace of traces) {
    assertTrace(trace);
  }
}

export function createPortAuthorityInvocation(
  request: CreatePortAuthorityInvocationRequest,
): PortAuthorityInvocation {
  const contexts = request.contexts ?? [];
  const authorityEvidence = request.authorityEvidence ?? [];
  assertPortAuthorityReference(request.portAuthority);
  assertText(request.correlationId, "Correlation id");
  assertPrincipal(request.principal);
  for (const scope of request.scopes) {
    assertScope(scope);
  }
  assertCapability(request.capability);
  assertProvenance(request.source);
  for (const context of contexts) {
    assertContextBinding(context);
  }
  for (const evidence of authorityEvidence) {
    assertAuthorityEvidence(evidence);
  }
  assertJsonSafe(request.input, "Invocation input");

  return deepFreezeJsonObject({
    protocol: PORT_AUTHORITY_INVOCATION_PROTOCOL,
    portAuthority: request.portAuthority,
    correlationId: request.correlationId,
    principal: request.principal,
    scopes: request.scopes,
    capability: request.capability,
    input: request.input,
    contexts,
    authorityEvidence,
    source: request.source,
  });
}

export function createPortAuthoritySuccessOutcome(
  request: CreatePortAuthoritySuccessOutcomeRequest,
): PortAuthoritySuccessOutcome {
  const traces = request.traces ?? [];
  assertEnvelope(
    request.portAuthority,
    request.correlationId,
    request.capability,
    traces,
  );
  assertJsonSafe(request.output, "Outcome output");

  return deepFreezeJsonObject({
    protocol: PORT_AUTHORITY_OUTCOME_PROTOCOL,
    portAuthority: request.portAuthority,
    correlationId: request.correlationId,
    capability: request.capability,
    status: "success",
    output: request.output,
    traces,
  });
}

export function createPortAuthorityFailureOutcome(
  request: CreatePortAuthorityFailureOutcomeRequest,
): PortAuthorityFailureOutcome {
  const traces = request.traces ?? [];
  assertEnvelope(
    request.portAuthority,
    request.correlationId,
    request.capability,
    traces,
  );
  assertText(request.error.code, "Failure code");
  assertText(request.error.message, "Failure message");
  assertJsonSafe(request.error.details, "Failure details");

  return deepFreezeJsonObject({
    protocol: PORT_AUTHORITY_OUTCOME_PROTOCOL,
    portAuthority: request.portAuthority,
    correlationId: request.correlationId,
    capability: request.capability,
    status: "failure",
    error: request.error,
    traces,
  });
}
