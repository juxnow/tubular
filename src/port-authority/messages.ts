import {
  deepFreezeJsonObject,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";
import { PORT_AUTHORITY_PROTOCOL, type PortAuthorityReference } from "./definition.js";

/** Version discriminator for experimental portable invocation messages. */
export const PORT_AUTHORITY_INVOCATION_PROTOCOL = "port-authority.invocation/v0" as const;
/** Version discriminator for experimental portable result messages. */
export const PORT_AUTHORITY_OUTCOME_PROTOCOL = "port-authority.outcome/v0" as const;

/** Namespace-qualified external identity claim that requires host authentication before use. */
export interface ExternalIdentityReference extends JsonObject {
  /** Namespace that qualifies an external reference; it provides no authentication by itself. */
  readonly namespace: string;
  /** External system's subject identifier within its namespace; host verification is required. */
  readonly subject: string;
}

/** Host-selected principal with external identity references, not credentials or a self-issued grant. */
export interface PrincipalReference extends JsonObject {
  /** Host-selected principal identity; a portable reference is not an authentication credential. */
  readonly id: string;
  /** Host-selected external identity references. Their presence does not authenticate the principal. */
  readonly externalIdentities: readonly ExternalIdentityReference[];
}

/** Explicit scope context identified by a declared scope kind. */
export interface ScopeReference extends JsonObject {
  /** Scope identity interpreted using the accompanying declared kind. */
  readonly id: string;
  /** Declared scope vocabulary entry; interpretation remains profile-specific. */
  readonly kind: string;
}

/** Exact capability identifier and version addressed by a portable message. */
export interface CapabilityReference extends JsonObject {
  /** Exact capability key within the referenced portable definition. */
  readonly id: string;
  /** Explicit contract or component version; callers should not infer compatibility from matching names alone. */
  readonly version: string;
}

/** Source location reference preserved without fetching or authenticating its contents. */
export interface ProvenanceReference extends JsonObject {
  /** Namespace that qualifies an external reference; it provides no authentication by itself. */
  readonly namespace: string;
  /** Namespace-qualified source kind used to interpret resourceId. */
  readonly resourceKind: string;
  /** Provider-scoped source resource identifier, retained without dereferencing it. */
  readonly resourceId: string;
  /** Parent resource identifier when known; absence or null means no parent was supplied. */
  readonly parentResourceId: string | null;
}

/** Reference to explicitly selected context; null digest means the reference is not content-bound. */
export interface ContextBindingReference extends JsonObject {
  /** Identifier of the context or effect kind declared by the portable definition. */
  readonly kindRef: string;
  /** Host-selected context artifact identity, optionally bound to a digest. */
  readonly id: string;
  /** Lowercase SHA-256 content binding, or null when the reference is explicitly unbound. */
  readonly digest: string | null;
}

/** Reference to authority evidence for host verification; null digest means no content binding is claimed. */
export interface AuthorityEvidenceReference extends JsonObject {
  /** Identifier of an authority scheme declared by the portable definition. */
  readonly schemeRef: string;
  /** Evidence artifact identity to resolve and verify through the named authority scheme. */
  readonly id: string;
  /** Lowercase SHA-256 evidence binding, or null when no content binding is supplied. */
  readonly digest: string | null;
}

/** Display attribution for a context record, separate from authenticated principal identity. */
export interface AttributionReference extends JsonObject {
  /** Human-readable attribution or source label. It must not be used as an authenticated identity. */
  readonly label: string;
}

/** Portable context payload with occurrence metadata and an explicit provenance reference. */
export interface ContextRecord extends JsonObject {
  /** Source record identifier preserved independently of provenance location. */
  readonly id: string;
  /** Human-readable attribution that must not be confused with authenticated principal identity. */
  readonly attribution: AttributionReference;
  /** Source-supplied event time retained during translation; message validation only checks nonempty text. */
  readonly occurredAt: string;
  /** Explicitly supplied context payload; provenance and classification do not make its instructions trusted. */
  readonly content: JsonValue;
  /** Namespaced source location retained with the selected content. */
  readonly provenance: ProvenanceReference;
}

/** Provider-specific diagnostic reference with no execution or authorization semantics. */
export interface OpaqueTrace extends JsonObject {
  /** Namespace that qualifies an external reference; it provides no authentication by itself. */
  readonly namespace: string;
  /** Provider-defined trace category within the named diagnostic namespace. */
  readonly kind: string;
  /** Opaque provider diagnostic identifier; it is not an execution receipt or authorization token. */
  readonly id: string;
}

/** Portable invocation request carrying explicit principal, scopes, context, and authority evidence references. */
export interface PortAuthorityInvocation extends JsonObject {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: typeof PORT_AUTHORITY_INVOCATION_PROTOCOL;
  /** Exact version and digest of the portable contract definition to which this message refers. */
  readonly portAuthority: PortAuthorityReference;
  /** Caller-selected correlation value preserved in outcomes; it is not an idempotency or authority token. */
  readonly correlationId: string;
  /** Explicit host-selected principal reference; message construction does not authenticate it. */
  readonly principal: PrincipalReference;
  /** Explicit caller context scopes; message construction validates shape, not authorization. */
  readonly scopes: readonly ScopeReference[];
  /** Exact capability reference selected from the portable definition. */
  readonly capability: CapabilityReference;
  /** Untrusted capability input. Validate it before dispatch; its fields never establish host authority. */
  readonly input: JsonValue;
  /** Explicit context requirements or bindings; there is no automatic context discovery. */
  readonly contexts: readonly ContextBindingReference[];
  /** References to host-verifiable authority evidence; reference data alone never grants authority. */
  readonly authorityEvidence: readonly AuthorityEvidenceReference[];
  /** Explicit source provenance retained without retrieval or authority inference. */
  readonly source: ProvenanceReference;
}

/** Successful portable result bound to the same contract, capability, and correlation identifier. */
export interface PortAuthoritySuccessOutcome extends JsonObject {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: typeof PORT_AUTHORITY_OUTCOME_PROTOCOL;
  /** Exact version and digest of the portable contract definition to which this message refers. */
  readonly portAuthority: PortAuthorityReference;
  /** Caller-selected correlation value preserved in outcomes; it is not an idempotency or authority token. */
  readonly correlationId: string;
  /** Exact capability reference selected from the portable definition. */
  readonly capability: CapabilityReference;
  /** Literal success discriminator selecting validated output rather than an error shape. */
  readonly status: "success";
  /** Successful capability output, which must satisfy the declared output schema before disclosure. */
  readonly output: JsonValue;
  /** Opaque provider diagnostic references; these are not proof of execution or authority. */
  readonly traces: readonly OpaqueTrace[];
}

/** Portable error shape with diagnostic details and retry guidance, not a thrown provider exception. */
export interface PortAuthorityFailure extends JsonObject {
  /** Stable diagnostic category used for programmatic handling instead of parsing display text. */
  readonly code: string;
  /** Human-readable diagnostic explaining the violated expectation; do not use it as an authority signal. */
  readonly message: string;
  /** Whether this failure may be retried after its stated condition changes; not permission to repeat an uncertain effect. */
  readonly retryable: boolean;
  /** Explicit JSON diagnostic fields; hosts must redact sensitive data before transport disclosure. */
  readonly details: JsonObject;
}

/** Portable failure outcome preserving correlation and optional diagnostic traces. */
export interface PortAuthorityFailureOutcome extends JsonObject {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: typeof PORT_AUTHORITY_OUTCOME_PROTOCOL;
  /** Exact version and digest of the portable contract definition to which this message refers. */
  readonly portAuthority: PortAuthorityReference;
  /** Caller-selected correlation value preserved in outcomes; it is not an idempotency or authority token. */
  readonly correlationId: string;
  /** Exact capability reference selected from the portable definition. */
  readonly capability: CapabilityReference;
  /** Literal failure discriminator selecting the portable error shape. */
  readonly status: "failure";
  /** Structured portable failure with retry guidance and explicit diagnostic data. */
  readonly error: PortAuthorityFailure;
  /** Opaque provider diagnostic references; these are not proof of execution or authority. */
  readonly traces: readonly OpaqueTrace[];
}

/** Discriminated success or failure envelope for a portable capability invocation. */
export type PortAuthorityOutcome = PortAuthoritySuccessOutcome | PortAuthorityFailureOutcome;

/** Inputs to checked portable invocation construction; unknown input must first be plain JSON. */
export interface CreatePortAuthorityInvocationRequest {
  /** Exact version and digest of the portable contract definition to which this message refers. */
  readonly portAuthority: PortAuthorityReference;
  /** Caller-selected correlation value preserved in outcomes; it is not an idempotency or authority token. */
  readonly correlationId: string;
  /** Explicit host-selected principal reference; message construction does not authenticate it. */
  readonly principal: PrincipalReference;
  /** Explicit caller context scopes; message construction validates shape, not authorization. */
  readonly scopes: readonly ScopeReference[];
  /** Exact capability reference selected from the portable definition. */
  readonly capability: CapabilityReference;
  /** Untrusted capability input. Validate it before dispatch; its fields never establish host authority. */
  readonly input: unknown;
  /** Explicit context requirements or bindings; there is no automatic context discovery. */
  readonly contexts?: readonly ContextBindingReference[];
  /** References to host-verifiable authority evidence; reference data alone never grants authority. */
  readonly authorityEvidence?: readonly AuthorityEvidenceReference[];
  /** Explicit source provenance retained without retrieval or authority inference. */
  readonly source: ProvenanceReference;
}

/** Inputs to checked success construction; unknown output must first be plain JSON. */
export interface CreatePortAuthoritySuccessOutcomeRequest {
  /** Exact version and digest of the portable contract definition to which this message refers. */
  readonly portAuthority: PortAuthorityReference;
  /** Caller-selected correlation value preserved in outcomes; it is not an idempotency or authority token. */
  readonly correlationId: string;
  /** Exact capability reference selected from the portable definition. */
  readonly capability: CapabilityReference;
  /** Successful capability output, which must satisfy the declared output schema before disclosure. */
  readonly output: unknown;
  /** Opaque provider diagnostic references; these are not proof of execution or authority. */
  readonly traces?: readonly OpaqueTrace[];
}

/** Inputs to checked failure construction with explicit portable error data. */
export interface CreatePortAuthorityFailureOutcomeRequest {
  /** Exact version and digest of the portable contract definition to which this message refers. */
  readonly portAuthority: PortAuthorityReference;
  /** Caller-selected correlation value preserved in outcomes; it is not an idempotency or authority token. */
  readonly correlationId: string;
  /** Exact capability reference selected from the portable definition. */
  readonly capability: CapabilityReference;
  /** Portable error data validated and frozen during outcome construction. */
  readonly error: PortAuthorityFailure;
  /** Opaque provider diagnostic references; these are not proof of execution or authority. */
  readonly traces?: readonly OpaqueTrace[];
}

/** Reject non-JSON values and cyclic or accessor-bearing objects before constructing portable messages. */
export function assertJsonSafe(value: unknown, label: string): asserts value is JsonValue {
  assertJsonSafeValue(value, label, new WeakSet<object>());
}

/** Recursively inspect property descriptors and ancestry to preserve plain JSON message boundaries. */
function assertJsonSafeValue(
  value: unknown,
  label: string,
  ancestors: WeakSet<object>,
): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
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

/** Require nonempty descriptive text at the labeled contract boundary. */
function assertText(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

/** Validate the protocol version, identifier, and digest syntax of a portable contract reference. */
function assertPortAuthorityReference(reference: PortAuthorityReference): void {
  if (reference.specification !== PORT_AUTHORITY_PROTOCOL) {
    throw new TypeError("Port Authority reference uses an unsupported specification");
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(reference.version)) {
    throw new TypeError("Port Authority reference version must be a semantic version");
  }
  if (!/^[a-f0-9]{64}$/u.test(reference.digest)) {
    throw new TypeError("Port Authority reference digest must be a SHA-256 digest");
  }
  if (reference.id !== `port_authority_${reference.digest.slice(0, 24)}`) {
    throw new TypeError("Port Authority reference id must match its digest");
  }
}

/** Check external identity reference text without authenticating the external subject. */
function assertExternalIdentity(identity: ExternalIdentityReference): void {
  assertText(identity.namespace, "External identity namespace");
  assertText(identity.subject, "External identity subject");
}

/** Check principal and external identity shapes; authentication remains the trusted host's responsibility. */
function assertPrincipal(principal: PrincipalReference): void {
  assertText(principal.id, "Principal id");
  for (const identity of principal.externalIdentities) {
    assertExternalIdentity(identity);
  }
}

/** Require nonempty scope identity and kind without interpreting them as authorization. */
function assertScope(scope: ScopeReference): void {
  assertText(scope.id, "Scope id");
  assertText(scope.kind, "Scope kind");
}

/** Require a capability identity and version before serializing an invocation or outcome. */
function assertCapability(capability: CapabilityReference): void {
  assertText(capability.id, "Capability id");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(capability.version)) {
    throw new TypeError("Capability version must be a semantic version");
  }
}

/** Validate source reference fields while preserving an explicit null parent when absent. */
function assertProvenance(provenance: ProvenanceReference): void {
  assertText(provenance.namespace, "Provenance namespace");
  assertText(provenance.resourceKind, "Provenance resource kind");
  assertText(provenance.resourceId, "Provenance resource id");
  if (provenance.parentResourceId !== null) {
    assertText(provenance.parentResourceId, "Provenance parent resource id");
  }
}

/** Accept null for an unbound reference or a lowercase SHA-256 hex digest for a bound reference. */
function assertDigest(value: string | null, label: string): void {
  if (value !== null && !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a SHA-256 digest when present`);
  }
}

/** Validate context kind, identity, and optional digest without fetching the referenced context. */
function assertContextBinding(binding: ContextBindingReference): void {
  assertText(binding.kindRef, "Context kind reference");
  assertText(binding.id, "Context binding id");
  assertDigest(binding.digest, "Context binding digest");
}

/** Validate an evidence reference without granting the authority it claims to describe. */
function assertAuthorityEvidence(evidence: AuthorityEvidenceReference): void {
  assertText(evidence.schemeRef, "Authority scheme reference");
  assertText(evidence.id, "Authority evidence id");
  assertDigest(evidence.digest, "Authority evidence digest");
}

/** Require nonempty namespaced trace fields without interpreting diagnostic data as a receipt. */
function assertTrace(trace: OpaqueTrace): void {
  assertText(trace.namespace, "Trace namespace");
  assertText(trace.kind, "Trace kind");
  assertText(trace.id, "Trace id");
}

/** Validate common portable contract, correlation, and capability fields before message construction. */
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

/** Validate plain JSON and reference shapes, then return a detached frozen invocation; this performs no dispatch. */
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

/** Validate and freeze explicit successful output and traces without claiming external execution proof. */
export function createPortAuthoritySuccessOutcome(
  request: CreatePortAuthoritySuccessOutcomeRequest,
): PortAuthoritySuccessOutcome {
  const traces = request.traces ?? [];
  assertEnvelope(request.portAuthority, request.correlationId, request.capability, traces);
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

/** Validate and freeze structured portable failure data and diagnostic traces. */
export function createPortAuthorityFailureOutcome(
  request: CreatePortAuthorityFailureOutcomeRequest,
): PortAuthorityFailureOutcome {
  const traces = request.traces ?? [];
  assertEnvelope(request.portAuthority, request.correlationId, request.capability, traces);
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
