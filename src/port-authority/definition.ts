import {
  deepFreezeJsonObject,
  isJsonObject,
  isJsonValue,
  sha256,
  stableStringify,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";

export const PORT_AUTHORITY_PROTOCOL = "port-authority/v0" as const;

export type StateInteraction =
  | "none"
  | "read"
  | "create"
  | "update"
  | "delete";

export type ExternalInteraction =
  | "none"
  | "read"
  | "compute"
  | "write";

export type Reversibility =
  | "not-applicable"
  | "reversible"
  | "compensatable"
  | "irreversible"
  | "unknown";

export type Retryability = "never" | "safe" | "conditional" | "unknown";

export interface PortAuthorityReference extends JsonObject {
  readonly id: string;
  readonly digest: string;
  readonly version: string;
  readonly specification: typeof PORT_AUTHORITY_PROTOCOL;
}

export interface ResourceKindDefinition extends JsonObject {
  readonly id: string;
  readonly description: string;
  readonly identitySchema: JsonObject;
  readonly parentKindRefs: readonly string[];
}

export interface ContextKindDefinition extends JsonObject {
  readonly id: string;
  readonly description: string;
  readonly selection: "explicit";
  readonly provenance: "required" | "optional";
  readonly integrity: "sha-256" | "none";
  readonly binding: "exact-digest" | "unbound";
  readonly classifications: readonly string[];
  readonly disclosurePolicies: readonly string[];
  readonly recordsOmissions: boolean;
}

export interface AuthoritySchemeDefinition extends JsonObject {
  readonly id: string;
  readonly description: string;
  readonly evidenceSchema: JsonObject;
  readonly promptGrantsAuthority: false;
}

export interface DisclosureDefinition extends JsonObject {
  readonly dataClass: string;
  readonly targetPort: string;
  readonly persistence: "forbidden" | "allowed" | "required" | "unknown";
  readonly fields: readonly string[];
}

export interface EffectKindDefinition extends JsonObject {
  readonly id: string;
  readonly description: string;
  readonly state: StateInteraction;
  readonly externalInteraction: ExternalInteraction;
  readonly reversibility: Reversibility;
}

export interface LifecycleStateDefinition extends JsonObject {
  readonly id: string;
  readonly terminal: boolean;
}

export interface LifecycleTransitionDefinition extends JsonObject {
  readonly from: string;
  readonly to: string;
  readonly on: string;
}

export interface LifecycleDefinition extends JsonObject {
  readonly id: string;
  readonly description: string;
  readonly initialState: string;
  readonly states: readonly LifecycleStateDefinition[];
  readonly transitions: readonly LifecycleTransitionDefinition[];
}

export interface NoAuthorityRequirement extends JsonObject {
  readonly kind: "none";
}

export interface SchemeAuthorityRequirement extends JsonObject {
  readonly kind: "scheme";
  readonly schemeRef: string;
  readonly claims: JsonObject;
}

export interface CompositeAuthorityRequirement extends JsonObject {
  readonly kind: "all-of" | "any-of";
  readonly requirements: readonly AuthorityRequirement[];
}

export type AuthorityRequirement =
  | NoAuthorityRequirement
  | SchemeAuthorityRequirement
  | CompositeAuthorityRequirement;

export interface TargetDefinition extends JsonObject {
  readonly name: string;
  readonly resourceKindRef: string;
  readonly fromInput: string;
  readonly required: boolean;
}

export interface ContextRequirement extends JsonObject {
  readonly name: string;
  readonly acceptsKindRefs: readonly string[];
  readonly required: boolean;
  readonly minItems: number;
  readonly maxItems: number;
  readonly maxBytes: number;
}

export interface EffectDeclaration extends JsonObject {
  readonly kindRef: string;
  readonly occurrence: "possible" | "guaranteed";
  readonly targetRef: string | null;
  readonly disclosures: readonly DisclosureDefinition[];
}

export interface ExecutionSemantics extends JsonObject {
  readonly completion: "synchronous" | "asynchronous" | "either";
  readonly idempotency: "none" | "invocation-id" | "caller-key" | "inherent";
  readonly outcomeEvidence: "receipt-required" | "optional";
  readonly unknownOutcome: "terminal-reconciliation-required" | "retry-safe";
}

export interface CapabilityErrorDefinition extends JsonObject {
  readonly code: string;
  readonly description: string;
  readonly retryability: Retryability;
}

export interface CapabilityDefinition extends JsonObject {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly errors: readonly CapabilityErrorDefinition[];
  readonly targets: readonly TargetDefinition[];
  readonly contexts: readonly ContextRequirement[];
  readonly authority: AuthorityRequirement;
  readonly effects: readonly EffectDeclaration[];
  readonly execution: ExecutionSemantics;
  readonly lifecycleRef: string;
}

export interface PortAuthorityBody extends JsonObject {
  readonly specification: typeof PORT_AUTHORITY_PROTOCOL;
  readonly name: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly scopeKinds: readonly string[];
  readonly resourceKinds: readonly ResourceKindDefinition[];
  readonly contextKinds: readonly ContextKindDefinition[];
  readonly authoritySchemes: readonly AuthoritySchemeDefinition[];
  readonly effectKinds: readonly EffectKindDefinition[];
  readonly lifecycles: readonly LifecycleDefinition[];
  readonly capabilities: readonly CapabilityDefinition[];
  readonly requiredExtensions: readonly string[];
  readonly extensions: JsonObject;
}

export interface PortAuthorityDefinition extends PortAuthorityBody {
  readonly id: string;
  readonly digest: string;
}

export interface PortAuthoritySource {
  readonly name: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly scopeKinds?: readonly string[];
  readonly resourceKinds?: readonly ResourceKindDefinition[];
  readonly contextKinds?: readonly ContextKindDefinition[];
  readonly authoritySchemes?: readonly AuthoritySchemeDefinition[];
  readonly effectKinds?: readonly EffectKindDefinition[];
  readonly lifecycles?: readonly LifecycleDefinition[];
  readonly capabilities: readonly CapabilityDefinition[];
  readonly requiredExtensions?: readonly string[];
  readonly extensions?: JsonObject;
}

export interface PortAuthorityConformanceIssue extends JsonObject {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface PortAuthorityConformanceReport extends JsonObject {
  readonly conforms: boolean;
  readonly issues: readonly PortAuthorityConformanceIssue[];
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

function compareById(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id);
}

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new TypeError(`${label} must be a lowercase dotted identifier`);
  }
}

function assertVersion(value: string, label: string): void {
  if (!semanticVersionPattern.test(value)) {
    throw new TypeError(`${label} must be a semantic version`);
  }
}

function assertText(value: string, label: string): void {
  if (value.trim().length === 0 || value.length > 2_048) {
    throw new TypeError(`${label} must contain 1 to 2048 characters`);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new TypeError(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function assertJsonFragment(value: unknown, label: string): void {
  if (!isJsonValue(value)) {
    throw new TypeError(`${label} must be finite, acyclic JSON data`);
  }
}

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

function assertSourceJson(source: PortAuthoritySource): void {
  assertJsonFragment(source.extensions ?? {}, "Port Authority extensions");
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

function collectSchemaIssues(
  value: JsonValue,
  path: string,
  issues: PortAuthorityConformanceIssue[],
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

function collectCanonicalKeyIssues(
  value: JsonValue,
  path: string,
  issues: PortAuthorityConformanceIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectCanonicalKeyIssues(child, `${path}/${index}`, issues),
    );
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

function authoritySchemeRefs(
  requirement: AuthorityRequirement,
  refs: string[],
): void {
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

function normalizeAuthority(
  requirement: AuthorityRequirement,
): AuthorityRequirement {
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
  const requirements = requirement.requirements.map((child) =>
    normalizeAuthority(child),
  );
  requirements.sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right)),
  );
  return { kind: requirement.kind, requirements };
}

function normalizeCapability(capability: CapabilityDefinition): CapabilityDefinition {
  const errors = capability.errors.map((error) => ({ ...error }));
  errors.sort((left, right) => left.code.localeCompare(right.code));
  assertUnique(errors.map((error) => error.code), `error code in ${capability.id}`);

  const targets = capability.targets.map((target) => ({ ...target }));
  targets.sort((left, right) => left.name.localeCompare(right.name));
  assertUnique(targets.map((target) => target.name), `target in ${capability.id}`);

  const contexts = capability.contexts.map((context) => ({
    ...context,
    acceptsKindRefs: [...context.acceptsKindRefs].sort(),
  }));
  contexts.sort((left, right) => left.name.localeCompare(right.name));
  assertUnique(contexts.map((context) => context.name), `context in ${capability.id}`);

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

function normalizeLifecycle(lifecycle: LifecycleDefinition): LifecycleDefinition {
  const states = lifecycle.states.map((state) => ({ ...state })).sort(compareById);
  const transitions = lifecycle.transitions
    .map((transition) => ({ ...transition }))
    .sort((left, right) =>
      `${left.from}:${left.on}:${left.to}`.localeCompare(
        `${right.from}:${right.on}:${right.to}`,
      ),
    );
  return { ...lifecycle, states, transitions };
}

function buildBody(source: PortAuthoritySource): PortAuthorityBody {
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
    specification: PORT_AUTHORITY_PROTOCOL,
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

function assertReferences(body: PortAuthorityBody): void {
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

export function inspectPortAuthorityBody(
  body: PortAuthorityBody,
): PortAuthorityConformanceReport {
  const issues: PortAuthorityConformanceIssue[] = [];
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

export function definePortAuthority(
  source: PortAuthoritySource,
): PortAuthorityDefinition {
  assertSourceJson(source);
  assertIdentifier(source.name, "Port Authority name");
  assertVersion(source.version, "Port Authority version");
  assertText(source.title, "Port Authority title");
  assertText(source.description, "Port Authority description");
  if (source.capabilities.length === 0) {
    throw new TypeError("A Port Authority must declare at least one capability");
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
  const report = inspectPortAuthorityBody(body);
  if (!report.conforms) {
    const first = report.issues[0];
    throw new TypeError(
      first === undefined
        ? "Port Authority does not conform"
        : `${first.code} at ${first.path}: ${first.message}`,
    );
  }

  const digest = sha256(stableStringify(body));
  return deepFreezeJsonObject({
    ...body,
    id: `port_authority_${digest.slice(0, 24)}`,
    digest,
  });
}

export function portAuthorityBody(
  definition: PortAuthorityDefinition,
): PortAuthorityBody {
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

export function verifyPortAuthorityIntegrity(
  definition: PortAuthorityDefinition,
): boolean {
  try {
    if (definition.specification !== PORT_AUTHORITY_PROTOCOL) {
      return false;
    }
    const rebuilt = definePortAuthority({
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

export function referencePortAuthority(
  definition: PortAuthorityDefinition,
): PortAuthorityReference {
  return deepFreezeJsonObject({
    id: definition.id,
    digest: definition.digest,
    version: definition.version,
    specification: definition.specification,
  });
}
