import {
  deepFreezeJsonObject,
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type JsonValue,
  sha256,
  stableStringify,
} from "../core/json.js";

/** Experimental portable definition version discriminator; it is not a finalized MCCP specification. */
export const PERSPECTIVE_PROTOCOL = "perspective/v0" as const;

/** Declared effect on local state; this discovery classification does not enforce read-only behavior. */
export type StateInteraction = "none" | "read" | "create" | "update" | "delete";

/** Declared external disclosure or mutation characteristics of a portable effect kind. */
export type ExternalInteraction = "none" | "read" | "compute" | "write";

/** Declared rollback characteristics, including unknown where no reliable undo promise exists. */
export type Reversibility =
  | "not-applicable"
  | "reversible"
  | "compensatable"
  | "irreversible"
  | "unknown";

/** Retry classification used for portable error discovery, separate from kernel replay state. */
export type Retryability = "never" | "safe" | "conditional" | "unknown";

/** Compact content-addressed reference to one portable contract definition and version. */
export interface PerspectiveReference extends JsonObject {
  /** Content-derived identifier of the referenced sealed portable definition. */
  readonly id: string;
  /** Full lowercase SHA-256 digest of the referenced canonical portable definition body. */
  readonly digest: string;
  /** Explicit contract or component version; callers should not infer compatibility from matching names alone. */
  readonly version: string;
  /** Exact experimental portable-definition version required to interpret the contract. */
  readonly specification: typeof PERSPECTIVE_PROTOCOL;
}

/** Named resource category and schema for its identity, with declared parent-kind relationships. */
export interface ResourceKindDefinition extends JsonObject {
  /** Unique resource-kind key referenced by targets and parent-kind declarations. */
  readonly id: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** JSON Schema for resource identity data; metadata validation does not resolve or authorize a resource. */
  readonly identitySchema: JsonObject;
  /** Declared parent-kind identifiers, all of which must resolve within the same definition. */
  readonly parentKindRefs: readonly string[];
}

/** Portable requirements for selection, provenance, digest binding, disclosure, and omission evidence. */
export interface ContextKindDefinition extends JsonObject {
  /** Unique context-kind key used by capability requirements and context bindings. */
  readonly id: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Requires explicit host selection; automatic ambient context acquisition is outside this contract. */
  readonly selection: "explicit";
  /** Whether records of this kind require explicit origin metadata. */
  readonly provenance: "required" | "optional";
  /** Declared content-integrity mechanism; none makes no cryptographic binding claim. */
  readonly integrity: "sha-256" | "none";
  /** Whether invocation context must match an exact digest or is explicitly unbound. */
  readonly binding: "exact-digest" | "unbound";
  /** Sensitivity labels understood by this context kind; no ordering is inferred by portable validation. */
  readonly classifications: readonly string[];
  /** Disclosure vocabulary supported by the context kind; enforcement belongs to the host profile. */
  readonly disclosurePolicies: readonly string[];
  /** Whether context selection records excluded sources and their reasons. */
  readonly recordsOmissions: boolean;
}

/** Named evidence scheme for host verification. Prompt text is explicitly excluded as an authority source. */
export interface AuthoritySchemeDefinition extends JsonObject {
  /** Unique scheme key referenced by authority requirements and evidence bindings. */
  readonly id: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** JSON Schema for host-verifiable evidence; validating shape alone does not establish authority. */
  readonly evidenceSchema: JsonObject;
  /** Always false: prompts and model-generated arguments cannot issue authority. */
  readonly promptGrantsAuthority: false;
}

/** Declared data disclosure to a port, with fields and retention expectations. */
export interface DisclosureDefinition extends JsonObject {
  /** Declared class of data that may leave the local boundary. */
  readonly dataClass: string;
  /** Named destination port for disclosure; this does not create a network connection. */
  readonly targetPort: string;
  /** Declared retention expectation at the destination; unknown promises no retention control. */
  readonly persistence: "forbidden" | "allowed" | "required" | "unknown";
  /** Named payload fields included in the disclosure; sorted for canonical hashing. */
  readonly fields: readonly string[];
}

/** Portable classification of state interaction, external effects, and reversibility. */
export interface EffectKindDefinition extends JsonObject {
  /** Unique effect-kind key used by capability effect declarations. */
  readonly id: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** State interaction or lifecycle state, as defined by the containing contract. */
  readonly state: StateInteraction;
  /** Declared interaction beyond local state, including disclosure or external mutation. */
  readonly externalInteraction: ExternalInteraction;
  /** Declared ability to undo the effect; unknown makes no rollback promise. */
  readonly reversibility: Reversibility;
}

/** Named lifecycle state and whether that state is terminal in the declared protocol. */
export interface LifecycleStateDefinition extends JsonObject {
  /** State key unique within its lifecycle graph. */
  readonly id: string;
  /** Whether the declared state ends that lifecycle; this metadata does not implement recovery. */
  readonly terminal: boolean;
}

/** Named event connecting two declared lifecycle states; this is discovery metadata. */
export interface LifecycleTransitionDefinition extends JsonObject {
  /** Existing lifecycle state from which the event may transition. */
  readonly from: string;
  /** Existing lifecycle state reached after the declared event. */
  readonly to: string;
  /** Event name triggering the declared transition; no event handler is generated automatically. */
  readonly on: string;
}

/** Portable lifecycle graph with explicit initial state and transitions; no runtime engine is generated from it. */
export interface LifecycleDefinition extends JsonObject {
  /** Unique lifecycle key referenced by capabilities in this definition. */
  readonly id: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Existing state at which the declared lifecycle starts. */
  readonly initialState: string;
  /** Unique state declarations, sorted by identifier during canonicalization. */
  readonly states: readonly LifecycleStateDefinition[];
  /** Declared event edges whose source and destination must resolve to existing states. */
  readonly transitions: readonly LifecycleTransitionDefinition[];
}

/** Discovery declaration that this capability adds no authority scheme requirement. */
export interface NoAuthorityRequirement extends JsonObject {
  /** Discriminator for the absence of an additional portable authority scheme requirement. */
  readonly kind: "none";
}

/** Evidence claims required by one named authority scheme; the host must verify them. */
export interface SchemeAuthorityRequirement extends JsonObject {
  /** Discriminator selecting a named host-verifiable authority scheme. */
  readonly kind: "scheme";
  /** Identifier of an authority scheme declared by the portable definition. */
  readonly schemeRef: string;
  /** JSON claims required by the scheme; a model's claim to satisfy them is not evidence. */
  readonly claims: JsonObject;
}

/** Recursive all-of or any-of combination of authority requirements, canonicalized for hashing. */
export interface CompositeAuthorityRequirement extends JsonObject {
  /** All-of requires every child; any-of permits a child satisfying the host's scheme semantics. */
  readonly kind: "all-of" | "any-of";
  /** Nested requirements sorted canonically. This vocabulary does not assign runtime policy semantics to empty composites. */
  readonly requirements: readonly AuthorityRequirement[];
}

/** Portable authority expression. Parsing or projecting it does not authorize an action. */
export type AuthorityRequirement =
  | NoAuthorityRequirement
  | SchemeAuthorityRequirement
  | CompositeAuthorityRequirement;

/** Named target derived from an input path and interpreted using a declared resource kind. */
export interface TargetDefinition extends JsonObject {
  /** Capability-local target name referenced by effect declarations. */
  readonly name: string;
  /** Identifier of the declared resource kind used to interpret the target. */
  readonly resourceKindRef: string;
  /** Slash-prefixed input path used to describe target selection; adapters must implement actual resolution. */
  readonly fromInput: string;
  /** Whether a target must be available for this capability according to its portable contract. */
  readonly required: boolean;
}

/** Named context selection requirement with item and byte bounds. */
export interface ContextRequirement extends JsonObject {
  /** Capability-local name identifying this context requirement. */
  readonly name: string;
  /** Allowed declared context kinds; every reference must resolve in the definition. */
  readonly acceptsKindRefs: readonly string[];
  /** Whether the invocation must supply context satisfying this requirement. */
  readonly required: boolean;
  /** Nonnegative safe-integer lower bound on selected context records. */
  readonly minItems: number;
  /** Safe-integer upper bound on selected records, at least minItems. */
  readonly maxItems: number;
  /** Positive safe-integer aggregate byte budget; the profile defines payload encoding. */
  readonly maxBytes: number;
}

/** Declared effect kind, occurrence, target, and possible disclosures for one capability. */
export interface EffectDeclaration extends JsonObject {
  /** Identifier of the context or effect kind declared by the portable definition. */
  readonly kindRef: string;
  /** Possible describes a conditional effect; guaranteed declares an effect on successful execution. */
  readonly occurrence: "possible" | "guaranteed";
  /** Capability-local target name, or null when the effect has no named resource target. */
  readonly targetRef: string | null;
  /** Data transfers associated with this effect, including destination and retention expectations. */
  readonly disclosures: readonly DisclosureDefinition[];
}

/** Portable completion, idempotency, receipt, and unknown-outcome promises; adapters must substantiate them. */
export interface ExecutionSemantics extends JsonObject {
  /** Whether a capability completes synchronously, asynchronously, or permits either model. */
  readonly completion: "synchronous" | "asynchronous" | "either";
  /** Declared duplicate-suppression strategy; adapters must actually retain or honor the corresponding key. */
  readonly idempotency: "none" | "invocation-id" | "caller-key" | "inherent";
  /** Whether a completed effect must provide a receipt; this declaration is not itself enforcement. */
  readonly outcomeEvidence: "receipt-required" | "optional";
  /** Required treatment of ambiguous effects: reconcile terminal uncertainty or retry only when safe. */
  readonly unknownOutcome: "terminal-reconciliation-required" | "retry-safe";
}

/** Portable failure category with human explanation and declared retry safety. */
export interface CapabilityErrorDefinition extends JsonObject {
  /** Stable diagnostic category used for programmatic handling instead of parsing display text. */
  readonly code: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Declared retry safety; conditional and unknown require host judgment and evidence. */
  readonly retryability: Retryability;
}

/** Canonical portable capability model from which discovery projections are derived. */
export interface CapabilityDefinition extends JsonObject {
  /** Unique capability key addressed by invocations and projected native tool names. */
  readonly id: string;
  /** Explicit contract or component version; callers should not infer compatibility from matching names alone. */
  readonly version: string;
  /** Short human-readable display title; identifiers remain the stable integration keys. */
  readonly title: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Canonical JSON Schema describing accepted input; consumers must also respect host policy and runtime validation. */
  readonly inputSchema: JsonObject;
  /** Canonical JSON Schema describing successful output; invalid output must not be released as a success. */
  readonly outputSchema: JsonObject;
  /** Declared failure categories and retry guidance; these are contract metadata, not HTTP routes. */
  readonly errors: readonly CapabilityErrorDefinition[];
  /** Named resources selected from input for the declared effect and authority checks. */
  readonly targets: readonly TargetDefinition[];
  /** Explicit context requirements or bindings; there is no automatic context discovery. */
  readonly contexts: readonly ContextRequirement[];
  /** Recursive host-verifiable authority requirement; extensions and schema shape do not enforce it themselves. */
  readonly authority: AuthorityRequirement;
  /** Declared possible or guaranteed effects, used for contract discovery rather than granting permission. */
  readonly effects: readonly EffectDeclaration[];
  /** Declared completion, deduplication, receipt, and unknown-outcome behavior for integrators. */
  readonly execution: ExecutionSemantics;
  /** Identifier of the lifecycle declared by the portable definition; metadata does not drive the kernel state machine. */
  readonly lifecycleRef: string;
}

/** Canonical portable application contract before its content-derived identifier and digest are added. */
export interface PerspectiveBody extends JsonObject {
  /** Exact experimental portable-definition version required to interpret the contract. */
  readonly specification: typeof PERSPECTIVE_PROTOCOL;
  /** Stable application contract name used alongside its explicit version. */
  readonly name: string;
  /** Explicit contract or component version; callers should not infer compatibility from matching names alone. */
  readonly version: string;
  /** Short human-readable display title; identifiers remain the stable integration keys. */
  readonly title: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Declared scope vocabulary accepted by this definition; omitted source collections normalize to empty arrays. */
  readonly scopeKinds: readonly string[];
  /** Named resource categories referenced by capability targets; omitted source collections normalize to empty arrays. */
  readonly resourceKinds: readonly ResourceKindDefinition[];
  /** Named context formats and selection rules; omitted source collections normalize to empty arrays. */
  readonly contextKinds: readonly ContextKindDefinition[];
  /** Host-verifiable evidence schemes referenced by capability authority requirements; defaults to an empty source collection. */
  readonly authoritySchemes: readonly AuthoritySchemeDefinition[];
  /** Declared effect taxonomy referenced by capabilities; an omitted source collection becomes empty. */
  readonly effectKinds: readonly EffectKindDefinition[];
  /** Declared lifecycle graphs referenced by capabilities; an omitted source collection becomes empty. */
  readonly lifecycles: readonly LifecycleDefinition[];
  /** Canonical capability declarations with unique identifiers and resolvable references. */
  readonly capabilities: readonly CapabilityDefinition[];
  /** Extension names a consumer must understand; omitted authoring input becomes an empty list. */
  readonly requiredExtensions: readonly string[];
  /** Namespaced JSON extension data covered by the digest; omitted authoring input becomes an empty object. */
  readonly extensions: JsonObject;
}

/** Sealed portable contract with a canonical SHA-256 digest; integrity is not sender authentication. */
export interface PerspectiveDefinition extends PerspectiveBody {
  /** Content-derived identifier computed from this record's canonical digest; it is not a bearer credential. */
  readonly id: string;
  /** Lowercase SHA-256 hex over the canonical record body, excluding the derived id and digest; this proves integrity, not authenticity. */
  readonly digest: string;
}

/** Authoring input normalized into a canonical portable definition; omitted optional collections become empty. */
export interface PerspectiveSource {
  /** Author-selected stable application contract name, validated before content addressing. */
  readonly name: string;
  /** Explicit contract or component version; callers should not infer compatibility from matching names alone. */
  readonly version: string;
  /** Short human-readable display title; identifiers remain the stable integration keys. */
  readonly title: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Declared scope vocabulary accepted by this definition; omitted source collections normalize to empty arrays. */
  readonly scopeKinds?: readonly string[];
  /** Named resource categories referenced by capability targets; omitted source collections normalize to empty arrays. */
  readonly resourceKinds?: readonly ResourceKindDefinition[];
  /** Named context formats and selection rules; omitted source collections normalize to empty arrays. */
  readonly contextKinds?: readonly ContextKindDefinition[];
  /** Host-verifiable evidence schemes referenced by capability authority requirements; defaults to an empty source collection. */
  readonly authoritySchemes?: readonly AuthoritySchemeDefinition[];
  /** Declared effect taxonomy referenced by capabilities; an omitted source collection becomes empty. */
  readonly effectKinds?: readonly EffectKindDefinition[];
  /** Declared lifecycle graphs referenced by capabilities; an omitted source collection becomes empty. */
  readonly lifecycles?: readonly LifecycleDefinition[];
  /** Canonical capability declarations with unique identifiers and resolvable references. */
  readonly capabilities: readonly CapabilityDefinition[];
  /** Extension names a consumer must understand; omitted authoring input becomes an empty list. */
  readonly requiredExtensions?: readonly string[];
  /** Namespaced JSON extension data covered by the digest; omitted authoring input becomes an empty object. */
  readonly extensions?: JsonObject;
}

/** Location and category of a portable definition's structural or semantic inconsistency. */
export interface PerspectiveConformanceIssue extends JsonObject {
  /** Slash-delimited location of the invalid contract or value; this is not a filesystem path. */
  readonly path: string;
  /** Stable diagnostic category used for programmatic handling instead of parsing display text. */
  readonly code: string;
  /** Human-readable diagnostic explaining the violated expectation; do not use it as an authority signal. */
  readonly message: string;
}

/** Conformance result collecting issues without turning a malformed definition into an executable contract. */
export interface PerspectiveConformanceReport extends JsonObject {
  /** True only when no structural or semantic conformance issues were found. */
  readonly conforms: boolean;
  /** All detected conformance problems; an empty list accompanies a conforming definition. */
  readonly issues: readonly PerspectiveConformanceIssue[];
}

const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const identifierPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const extensionPattern = /^x-[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const prohibitedCanonicalKeys = new Set([
  "documentationOnly",
  "httpMethod",
  "mcpName",
  "operationId",
  "path",
  "proposalOnly",
  "servers",
  "transport",
  "wrapperName",
  "x-network-endpoint",
]);
const opaqueCanonicalValueKeys = new Set([
  "claims",
  "evidenceSchema",
  "identitySchema",
  "inputSchema",
  "outputSchema",
]);

/** Order declared identifiers deterministically before content hashing. */
function compareById(
  left: {
    /** Declared identifier used as the deterministic sort key. */
    readonly id: string;
  },
  right: {
    /** Declared identifier used as the deterministic sort key. */
    readonly id: string;
  },
): number {
  return left.id.localeCompare(right.id);
}

/** Reject identifiers outside the portable definition's bounded ASCII grammar. */
function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new TypeError(`${label} must be a lowercase dotted identifier`);
  }
}

/** Reject empty or malformed explicit contract versions before canonicalization. */
function assertVersion(value: string, label: string): void {
  if (!semanticVersionPattern.test(value)) {
    throw new TypeError(`${label} must be a semantic version`);
  }
}

/** Require nonempty descriptive text at the labeled contract boundary. */
function assertText(value: string, label: string): void {
  if (value.trim().length === 0 || value.length > 2_048) {
    throw new TypeError(`${label} must contain 1 to 2048 characters`);
  }
}

/** Reject duplicate identifiers or names before deterministic normalization can conceal collisions. */
function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new TypeError(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

/** Require finite acyclic JSON values for embedded schema and extension fragments before normalization. */
function assertJsonFragment(value: unknown, label: string): void {
  if (!isJsonValue(value)) {
    throw new TypeError(`${label} must be finite, acyclic JSON data`);
  }
}

/** Check recursive authority evidence claims for JSON safety before canonical hashing. */
function assertAuthorityJson(requirement: AuthorityRequirement): void {
  if (requirement.kind === "scheme") {
    assertJsonFragment(requirement.claims, "Authority claims");
    return;
  }
  if (requirement.kind !== "none") {
    for (const child of requirement.requirements) {
      assertAuthorityJson(child);
    }
  }
}

/** Validate JSON fragments throughout a portable authoring input before normalization. */
function assertSourceJson(source: PerspectiveSource): void {
  assertJsonFragment(source.extensions ?? {}, "Perspective extensions");
  for (const resource of source.resourceKinds ?? []) {
    assertJsonFragment(resource.identitySchema, `Identity schema ${resource.id}`);
  }
  for (const scheme of source.authoritySchemes ?? []) {
    assertJsonFragment(scheme.evidenceSchema, `Evidence schema ${scheme.id}`);
  }
  for (const capability of source.capabilities) {
    assertJsonFragment(capability.inputSchema, `Input schema ${capability.id}`);
    assertJsonFragment(capability.outputSchema, `Output schema ${capability.id}`);
    assertAuthorityJson(capability.authority);
  }
}

/** Collect structural schema and required-key inconsistencies in portable definition fragments. */
function collectSchemaIssues(
  value: JsonValue,
  path: string,
  issues: PerspectiveConformanceIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectSchemaIssues(child, `${path}/${index}`, issues));
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }
  if (value["type"] === "object" && value["additionalProperties"] !== false) {
    issues.push({
      path,
      code: "open_object_schema",
      message: "Every object schema must set additionalProperties to false",
    });
  }
  for (const [key, child] of Object.entries(value)) {
    collectSchemaIssues(child, `${path}/${key}`, issues);
  }
}

/** Report keys outside the canonical portable object vocabulary instead of hashing ignored data. */
function collectCanonicalKeyIssues(
  value: JsonValue,
  path: string,
  issues: PerspectiveConformanceIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectCanonicalKeyIssues(child, `${path}/${index}`, issues));
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (prohibitedCanonicalKeys.has(key)) {
      issues.push({
        path: `${path}/${key}`,
        code: "transport_concern",
        message: `Transport or projection key is not canonical: ${key}`,
      });
    }
    if (!opaqueCanonicalValueKeys.has(key)) {
      collectCanonicalKeyIssues(child, `${path}/${key}`, issues);
    }
  }
}

/** Collect referenced authority scheme identifiers through nested all-of and any-of expressions. */
function authoritySchemeRefs(requirement: AuthorityRequirement, refs: string[]): void {
  if (requirement.kind === "scheme") {
    refs.push(requirement.schemeRef);
    return;
  }
  if (requirement.kind !== "none") {
    for (const child of requirement.requirements) {
      authoritySchemeRefs(child, refs);
    }
  }
}

/** Sort composite requirements and freeze evidence claims for deterministic portable authority metadata. */
function normalizeAuthority(requirement: AuthorityRequirement): AuthorityRequirement {
  if (requirement.kind === "none") {
    return { kind: "none" };
  }
  if (requirement.kind === "scheme") {
    return {
      kind: "scheme",
      schemeRef: requirement.schemeRef,
      claims: deepFreezeJsonObject(requirement.claims),
    };
  }
  const requirements = requirement.requirements.map((child) => normalizeAuthority(child));
  requirements.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  return { kind: requirement.kind, requirements };
}

/** Detach and sort capability errors, targets, contexts, and effects before canonical hashing. */
function normalizeCapability(capability: CapabilityDefinition): CapabilityDefinition {
  const errors = capability.errors.map((error) => ({ ...error }));
  errors.sort((left, right) => left.code.localeCompare(right.code));
  assertUnique(
    errors.map((error) => error.code),
    `error code in ${capability.id}`,
  );

  const targets = capability.targets.map((target) => ({ ...target }));
  targets.sort((left, right) => left.name.localeCompare(right.name));
  assertUnique(
    targets.map((target) => target.name),
    `target in ${capability.id}`,
  );

  const contexts = capability.contexts.map((context) => ({
    ...context,
    acceptsKindRefs: [...context.acceptsKindRefs].sort(),
  }));
  contexts.sort((left, right) => left.name.localeCompare(right.name));
  assertUnique(
    contexts.map((context) => context.name),
    `context in ${capability.id}`,
  );

  const effects = capability.effects.map((effect) => ({
    ...effect,
    disclosures: effect.disclosures
      .map((disclosure) => ({
        ...disclosure,
        fields: [...disclosure.fields].sort(),
      }))
      .sort((left, right) =>
        `${left.targetPort}:${left.dataClass}`.localeCompare(
          `${right.targetPort}:${right.dataClass}`,
        ),
      ),
  }));
  effects.sort((left, right) =>
    `${left.kindRef}:${left.targetRef ?? ""}`.localeCompare(
      `${right.kindRef}:${right.targetRef ?? ""}`,
    ),
  );

  return {
    id: capability.id,
    version: capability.version,
    title: capability.title,
    description: capability.description,
    inputSchema: deepFreezeJsonObject(capability.inputSchema),
    outputSchema: deepFreezeJsonObject(capability.outputSchema),
    errors,
    targets,
    contexts,
    authority: normalizeAuthority(capability.authority),
    effects,
    execution: { ...capability.execution },
    lifecycleRef: capability.lifecycleRef,
  };
}

/** Sort declared states and transitions while preserving lifecycle meaning. */
function normalizeLifecycle(lifecycle: LifecycleDefinition): LifecycleDefinition {
  const states = lifecycle.states.map((state) => ({ ...state })).sort(compareById);
  const transitions = lifecycle.transitions
    .map((transition) => ({ ...transition }))
    .sort((left, right) =>
      `${left.from}:${left.on}:${left.to}`.localeCompare(`${right.from}:${right.on}:${right.to}`),
    );
  return { ...lifecycle, states, transitions };
}

/** Normalize optional collections to empty values and sort portable declarations before hashing. */
function buildBody(source: PerspectiveSource): PerspectiveBody {
  const resourceKinds = (source.resourceKinds ?? [])
    .map((definition) => ({
      ...definition,
      identitySchema: deepFreezeJsonObject(definition.identitySchema),
      parentKindRefs: [...definition.parentKindRefs].sort(),
    }))
    .sort(compareById);
  const contextKinds = (source.contextKinds ?? [])
    .map((definition) => ({
      ...definition,
      classifications: [...definition.classifications].sort(),
      disclosurePolicies: [...definition.disclosurePolicies].sort(),
    }))
    .sort(compareById);
  const authoritySchemes = (source.authoritySchemes ?? [])
    .map((definition) => ({
      ...definition,
      evidenceSchema: deepFreezeJsonObject(definition.evidenceSchema),
    }))
    .sort(compareById);
  const effectKinds = (source.effectKinds ?? [])
    .map((definition) => ({ ...definition }))
    .sort(compareById);
  const lifecycles = (source.lifecycles ?? [])
    .map((definition) => normalizeLifecycle(definition))
    .sort(compareById);
  const capabilities = source.capabilities
    .map((capability) => normalizeCapability(capability))
    .sort(compareById);

  return {
    specification: PERSPECTIVE_PROTOCOL,
    name: source.name,
    version: source.version,
    title: source.title,
    description: source.description,
    scopeKinds: [...(source.scopeKinds ?? [])].sort(),
    resourceKinds,
    contextKinds,
    authoritySchemes,
    effectKinds,
    lifecycles,
    capabilities,
    requiredExtensions: [...(source.requiredExtensions ?? [])].sort(),
    extensions: deepFreezeJsonObject(source.extensions ?? {}),
  };
}

/** Reject unresolved resource, context, authority, effect, and lifecycle references and inconsistent bounds. */
function assertReferences(body: PerspectiveBody): void {
  const resourceKinds = new Set(body.resourceKinds.map((item) => item.id));
  const contextKinds = new Set(body.contextKinds.map((item) => item.id));
  const authoritySchemes = new Set(body.authoritySchemes.map((item) => item.id));
  const effectKinds = new Set(body.effectKinds.map((item) => item.id));
  const lifecycles = new Map(body.lifecycles.map((item) => [item.id, item]));

  for (const resource of body.resourceKinds) {
    assertUnique(resource.parentKindRefs, `parent resource kind in ${resource.id}`);
    for (const parentRef of resource.parentKindRefs) {
      if (!resourceKinds.has(parentRef)) {
        throw new TypeError(`Unknown parent resource kind on ${resource.id}`);
      }
    }
  }

  for (const lifecycle of body.lifecycles) {
    const stateIds = lifecycle.states.map((state) => state.id);
    assertUnique(stateIds, `lifecycle state in ${lifecycle.id}`);
    const states = new Set(stateIds);
    if (!states.has(lifecycle.initialState)) {
      throw new TypeError(`Unknown initial state in lifecycle ${lifecycle.id}`);
    }
    for (const transition of lifecycle.transitions) {
      if (!states.has(transition.from) || !states.has(transition.to)) {
        throw new TypeError(`Unknown transition state in lifecycle ${lifecycle.id}`);
      }
    }
  }

  for (const capability of body.capabilities) {
    if (!lifecycles.has(capability.lifecycleRef)) {
      throw new TypeError(`Unknown lifecycle on capability ${capability.id}`);
    }
    const targetNames = new Set(capability.targets.map((target) => target.name));
    for (const target of capability.targets) {
      if (!resourceKinds.has(target.resourceKindRef)) {
        throw new TypeError(`Unknown resource kind on capability ${capability.id}`);
      }
      if (!target.fromInput.startsWith("/")) {
        throw new TypeError(`Target pointer must start with / on capability ${capability.id}`);
      }
    }
    for (const context of capability.contexts) {
      if (
        !Number.isSafeInteger(context.minItems) ||
        !Number.isSafeInteger(context.maxItems) ||
        !Number.isSafeInteger(context.maxBytes) ||
        context.minItems < 0 ||
        context.maxItems < context.minItems ||
        context.maxBytes < 1
      ) {
        throw new TypeError(`Invalid context bounds on capability ${capability.id}`);
      }
      for (const ref of context.acceptsKindRefs) {
        if (!contextKinds.has(ref)) {
          throw new TypeError(`Unknown context kind on capability ${capability.id}`);
        }
      }
    }
    const schemeRefs: string[] = [];
    authoritySchemeRefs(capability.authority, schemeRefs);
    for (const ref of schemeRefs) {
      if (!authoritySchemes.has(ref)) {
        throw new TypeError(`Unknown authority scheme on capability ${capability.id}`);
      }
    }
    for (const effect of capability.effects) {
      if (!effectKinds.has(effect.kindRef)) {
        throw new TypeError(`Unknown effect kind on capability ${capability.id}`);
      }
      if (effect.targetRef !== null && !targetNames.has(effect.targetRef)) {
        throw new TypeError(`Unknown effect target on capability ${capability.id}`);
      }
    }
  }
}

/** Collect conformance issues without executing capabilities or trusting descriptive authority claims. */
export function inspectPerspectiveBody(body: PerspectiveBody): PerspectiveConformanceReport {
  const issues: PerspectiveConformanceIssue[] = [];
  collectCanonicalKeyIssues(body, "", issues);
  for (const resource of body.resourceKinds) {
    collectSchemaIssues(
      resource.identitySchema,
      `/resourceKinds/${resource.id}/identitySchema`,
      issues,
    );
  }
  for (const scheme of body.authoritySchemes) {
    collectSchemaIssues(
      scheme.evidenceSchema,
      `/authoritySchemes/${scheme.id}/evidenceSchema`,
      issues,
    );
  }
  for (const capability of body.capabilities) {
    collectSchemaIssues(
      capability.inputSchema,
      `/capabilities/${capability.id}/inputSchema`,
      issues,
    );
    collectSchemaIssues(
      capability.outputSchema,
      `/capabilities/${capability.id}/outputSchema`,
      issues,
    );
  }
  return deepFreezeJsonObject({
    conforms: issues.length === 0,
    issues,
  });
}

/** Validate, normalize, hash, and freeze one portable definition; reject inconsistent schemas or references. */
export function definePerspective(source: PerspectiveSource): PerspectiveDefinition {
  assertSourceJson(source);
  assertIdentifier(source.name, "Perspective name");
  assertVersion(source.version, "Perspective version");
  assertText(source.title, "Perspective title");
  assertText(source.description, "Perspective description");
  if (source.capabilities.length === 0) {
    throw new TypeError("A Perspective must declare at least one capability");
  }

  const body = buildBody(source);
  const collections = [
    [body.scopeKinds, "scope kind"],
    [body.resourceKinds.map((item) => item.id), "resource kind"],
    [body.contextKinds.map((item) => item.id), "context kind"],
    [body.authoritySchemes.map((item) => item.id), "authority scheme"],
    [body.effectKinds.map((item) => item.id), "effect kind"],
    [body.lifecycles.map((item) => item.id), "lifecycle"],
    [body.capabilities.map((item) => `${item.id}@${item.version}`), "capability"],
    [body.requiredExtensions, "required extension"],
  ] as const;
  for (const [values, label] of collections) {
    assertUnique(values, label);
  }
  for (const definition of [
    ...body.resourceKinds,
    ...body.contextKinds,
    ...body.authoritySchemes,
    ...body.effectKinds,
    ...body.lifecycles,
    ...body.capabilities,
  ]) {
    assertIdentifier(definition.id, "Definition id");
  }
  for (const capability of body.capabilities) {
    assertVersion(capability.version, `Capability version for ${capability.id}`);
    assertText(capability.title, `Capability title for ${capability.id}`);
    assertText(capability.description, `Capability description for ${capability.id}`);
  }
  for (const extension of body.requiredExtensions) {
    if (!extensionPattern.test(extension)) {
      throw new TypeError(`Invalid required extension: ${extension}`);
    }
    if (body.extensions[extension] === undefined) {
      throw new TypeError(`Required extension is not defined: ${extension}`);
    }
  }
  assertReferences(body);
  const report = inspectPerspectiveBody(body);
  if (!report.conforms) {
    const first = report.issues[0];
    throw new TypeError(
      first === undefined
        ? "Perspective does not conform"
        : `${first.code} at ${first.path}: ${first.message}`,
    );
  }

  const digest = sha256(stableStringify(body));
  return deepFreezeJsonObject({
    ...body,
    id: `perspective_${digest.slice(0, 24)}`,
    digest,
  });
}

/** Extract canonical definition fields without the derived identifier and digest. */
export function perspectiveBody(definition: PerspectiveDefinition): PerspectiveBody {
  return {
    specification: definition.specification,
    name: definition.name,
    version: definition.version,
    title: definition.title,
    description: definition.description,
    scopeKinds: definition.scopeKinds,
    resourceKinds: definition.resourceKinds,
    contextKinds: definition.contextKinds,
    authoritySchemes: definition.authoritySchemes,
    effectKinds: definition.effectKinds,
    lifecycles: definition.lifecycles,
    capabilities: definition.capabilities,
    requiredExtensions: definition.requiredExtensions,
    extensions: definition.extensions,
  };
}

/** Verify conformance and recompute the canonical digest; a valid digest is not a signature. */
export function verifyPerspectiveIntegrity(definition: PerspectiveDefinition): boolean {
  try {
    if (definition.specification !== PERSPECTIVE_PROTOCOL) {
      return false;
    }
    const rebuilt = definePerspective({
      name: definition.name,
      version: definition.version,
      title: definition.title,
      description: definition.description,
      scopeKinds: definition.scopeKinds,
      resourceKinds: definition.resourceKinds,
      contextKinds: definition.contextKinds,
      authoritySchemes: definition.authoritySchemes,
      effectKinds: definition.effectKinds,
      lifecycles: definition.lifecycles,
      capabilities: definition.capabilities,
      requiredExtensions: definition.requiredExtensions,
      extensions: definition.extensions,
    });
    return stableStringify(rebuilt) === stableStringify(definition);
  } catch {
    return false;
  }
}

/** Verify a sealed definition and return its compact identifier, version, and digest reference. */
export function referencePerspective(definition: PerspectiveDefinition): PerspectiveReference {
  return deepFreezeJsonObject({
    id: definition.id,
    digest: definition.digest,
    version: definition.version,
    specification: definition.specification,
  });
}
