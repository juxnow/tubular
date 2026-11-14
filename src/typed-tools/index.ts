import type { ApprovalRequirement, EffectClass } from "../contracts/tool-contract.js";
import type { ToolInvocationResult } from "../contracts/tool-results.js";

export type { ToolInvocationResult } from "../contracts/tool-results.js";

import type { ToolDocumentation } from "../contracts/documentation.js";
import type { JsonValue } from "../core/json.js";
import { validateSchema } from "../type-validation/index.js";

/** Internal adapter hook. Only invoke after canonical input validation. */
export const executeTool = Symbol("execute typed tool");
const supportedEffects = new Set<EffectClass>([
  "read",
  "draft",
  "workspace-write",
  "external-write",
  "destructive",
]);

/** Legacy typed declaration requiring a separately paired schema map; prefer generated bindTool factories for drift checks. */
export interface ToolDeclaration<Input, Output, Context> {
  /** Unique runtime tool identifier used for lookup and legacy schema-map association. */
  readonly name: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Trusted host effect classification checked against the lease ceiling; model arguments cannot select or downgrade it. */
  readonly effect: EffectClass;
  /** Trusted host implementation called only after runtime input validation and authorization. */
  readonly handler: (input: Input, context: Context) => Output | Promise<Output>;
}

/** A declaration with its input type erased only at the validated runtime boundary. */
export interface ToolDefinition<Context> {
  /** Exact registered tool identifier; duplicates are rejected when creating the runtime. */
  readonly name: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Trusted host effect classification checked against the lease ceiling; model arguments cannot select or downgrade it. */
  readonly effect: EffectClass;
  /** Captured generated schemas when bound; absent only for legacy name-paired definitions. */
  readonly schemas?: GeneratedToolSchemas;
  /** Compiler binding origin when available; legacy name-paired definitions have no provenance guarantee. */
  readonly provenance?: BindingProvenance;
  /** Source-derived discovery text and annotations; omission means the source supplied none. */
  readonly documentation?: ToolDocumentation;
  /** Erased implementation hook for adapters that have already validated input and established host authorization. */
  readonly [executeTool]: (input: JsonValue, context: Context) => unknown;
}

/** Compiler source and export identity captured with a handler binding; it detects drift but is not a security signature. */
export interface BindingProvenance {
  /** Compiler-recorded source entry path used to identify the originating handler module. */
  readonly entry: string;
  /** Exact exported function captured by the generated binding, independent of the runtime tool name. */
  readonly exportName: string;
  /** SHA-256 fingerprint covering the compiler's source and declaration dependency inputs for drift checks. */
  readonly sourceDigest: string;
}

/** Host policy choices layered onto a generated handler binding; model arguments never supply these options. */
export interface BoundToolOptions<Input> {
  /** Optional runtime rename; defaults to the captured export name without changing the imported handler. */
  readonly name?: string;
  /** Optional host override of source-derived function prose; source prose is used when omitted. */
  readonly description?: string;
  /** Trusted host effect classification checked against the lease ceiling; model arguments cannot select or downgrade it. */
  readonly effect: EffectClass;
  /** Defaults to none for reads and exact-human for other effects; governed policy still applies in either case. */
  readonly approval?: ApprovalRequirement;
  /** Trusted resolver from validated input to a canonical workspace URI; required by the governed runtime. */
  readonly resource?: (input: Input) => string;
}

/** Handler and generated contracts captured together, with explicit host effect and approval settings. */
export interface BoundToolDefinition<Context> extends ToolDefinition<Context> {
  /** Immutable generated input, output, and documentation metadata captured with the handler. */
  readonly schemas: GeneratedToolSchemas;
  /** Captured handler source identity and drift fingerprint, independent of runtime renaming. */
  readonly provenance: BindingProvenance;
  /** Host-selected gate enforced by the governed kernel before dispatch. */
  readonly approval: ApprovalRequirement;
  /** Adapter for the trusted resolver, called only with validated JSON; required for governed execution. */
  readonly resolveResource?: (input: JsonValue) => string;
}

/** Compiler output uses this to capture the imported handler and its schemas together. */
export function bindTool<Input, Output, Context>(
  handler: (input: Input, context: Context) => Output | Promise<Output>,
  schemas: GeneratedToolSchemas,
  provenance: BindingProvenance,
): (options: BoundToolOptions<Input>) => BoundToolDefinition<Context> {
  if (
    !provenance.entry ||
    !provenance.exportName ||
    !/^[a-f0-9]{64}$/.test(provenance.sourceDigest)
  ) {
    throw new TypeError("Generated bindings require source provenance");
  }
  const source = Object.freeze({ ...provenance });
  const snapshot = Object.freeze({
    inputSchema: snapshotSchema(schemas.inputSchema, source.exportName),
    outputSchema: snapshotSchema(schemas.outputSchema, source.exportName),
    ...(schemas.documentation === undefined
      ? {}
      : { documentation: Object.freeze({ ...schemas.documentation }) }),
  });
  return (options) => {
    const approval = options.approval ?? (options.effect === "read" ? "none" : "exact-human");
    if (approval !== "none" && approval !== "exact-human")
      throw new TypeError("Unsupported approval requirement");
    const resource = options.resource;
    return Object.freeze({
      ...defineTool({
        name: options.name ?? source.exportName,
        description: options.description ?? snapshot.documentation?.description ?? "",
        effect: options.effect,
        handler,
      }),
      schemas: snapshot,
      provenance: source,
      ...(snapshot.documentation === undefined ? {} : { documentation: snapshot.documentation }),
      approval,
      // This adapter receives only input validated against the captured schema.
      ...(resource === undefined
        ? {}
        : { resolveResource: (input: JsonValue): string => resource(input as Input) }),
    });
  };
}

/** Compiler-generated input, output, and discovery metadata validated when a runtime captures the binding. */
export interface GeneratedToolSchemas {
  /** Canonical JSON Schema describing accepted input; consumers must also respect host policy and runtime validation. */
  readonly inputSchema: unknown;
  /** Canonical JSON Schema describing successful output; invalid output must not be released as a success. */
  readonly outputSchema: unknown;
  /** Source-derived discovery text and annotations; omission means the source supplied none. */
  readonly documentation?: ToolDocumentation;
}

/** Serializable discovery view of one registered typed tool, with canonical schemas and optional governed semantics. */
export interface ToolDescriptor extends ToolDocumentation {
  /** Unique runtime lookup key advertised to model and transport integrations. */
  readonly name: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Trusted host effect classification checked against the lease ceiling; model arguments cannot select or downgrade it. */
  readonly effect: EffectClass;
  /** Canonical JSON Schema describing accepted input; consumers must also respect host policy and runtime validation. */
  readonly inputSchema: JsonValue;
  /** Canonical JSON Schema describing successful output; invalid output must not be released as a success. */
  readonly outputSchema: JsonValue;
  /** Optional generated binding source identity, useful for drift review rather than authorization. */
  readonly provenance?: BindingProvenance;
  /** Present for governed bindings; absence does not mean an effect is approved. */
  readonly approval?: ApprovalRequirement;
  /** Present only when this descriptor is served by the governed execution path. */
  readonly execution?: "governed";
}

/** Trusted host decision: ALLOW may proceed, ASK pauses, and DENY refuses. No model text can grant ALLOW. */
export type AuthorizationDecision = "ALLOW" | "ASK" | "DENY";

/** Validated input and trusted host context supplied to the host authorization callback. */
export interface AuthorizationRequest<Context> {
  /** Canonical descriptor whose schema has already validated the submitted input. */
  readonly tool: ToolDescriptor;
  /** Untrusted capability input. Validate it before dispatch; its fields never establish host authority. */
  readonly input: JsonValue;
  /** Trusted host context passed out of band, never merged from model-supplied arguments. */
  readonly context: Context;
}

/** Read-only runtime construction options; non-read effects require createGovernedToolRuntime. */
export interface ToolRuntimeOptions<Context> {
  /** Trusted handler declarations captured into an immutable runtime registry. */
  readonly definitions: readonly ToolDefinition<Context>[];
  /** Legacy name-paired schema map. Omit for generated bindings; mixing both association mechanisms is rejected. */
  readonly schemas?: Readonly<Record<string, GeneratedToolSchemas>>;
  /** Trusted host policy callback. ASK and DENY never dispatch; exceptions become authorization_error. */
  readonly authorize: (
    request: AuthorizationRequest<Context>,
  ) => AuthorizationDecision | Promise<AuthorizationDecision>;
}

/** In-process typed tool discovery and invocation boundary; host context is supplied separately from tool arguments. */
export interface ToolRuntime<Context> {
  /** Return immutable descriptors without executing tools or selecting host authority. */
  list(): readonly ToolDescriptor[];
  /** Validate input, obtain a host decision, dispatch reads only, and validate output; return structured failures instead of provider exceptions. */
  invoke(name: string, input: unknown, context: Context): Promise<ToolInvocationResult>;
}

/**
 * Use the same input and output types on the function passed to the compiler.
 * Generated schemas are bound by tool name when the runtime is created.
 */
export function defineTool<Input, Output, Context>(
  declaration: ToolDeclaration<Input, Output, Context>,
): ToolDefinition<Context> {
  if (
    typeof declaration.name !== "string" ||
    !declaration.name.trim() ||
    typeof declaration.description !== "string" ||
    !declaration.description.trim() ||
    typeof declaration.handler !== "function" ||
    !supportedEffects.has(declaration.effect)
  ) {
    throw new TypeError("A tool requires a name, description, supported effect, and handler");
  }
  const handler = declaration.handler;
  return Object.freeze({
    name: declaration.name,
    description: declaration.description,
    effect: declaration.effect,
    // The generated schema for Input is checked immediately before this call.
    [executeTool]: (input: JsonValue, context: Context): unknown =>
      handler(input as Input, context),
  });
}

/** Recursively freeze detached JSON so authorization cannot race with input mutation. */
function freezeJson(value: JsonValue): JsonValue {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      freezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}

/** Copy plain JSON schema data via descriptors without invoking getters; reject cycles, symbols, and nesting beyond 100 levels. */
function copySchemaData(value: unknown, ancestors: WeakSet<object>, depth: number): JsonValue {
  if (depth > 100) throw new TypeError("Schema nesting limit exceeded");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value))
    throw new TypeError("Schema must be plain JSON");
  const isArray = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
  ) {
    throw new TypeError("Schema must be plain JSON");
  }
  const properties = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(properties);
  if (keys.some((key) => typeof key !== "string")) throw new TypeError("Schema must be plain JSON");
  ancestors.add(value);
  try {
    if (isArray) {
      const length: unknown = properties["length"]?.value;
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        keys.length !== length + 1
      ) {
        throw new TypeError("Schema must be plain JSON");
      }
      const result: JsonValue[] = [];
      for (let i = 0; i < length; i += 1) {
        const property = properties[String(i)];
        if (!property || !("value" in property) || !property.enumerable)
          throw new TypeError("Schema must be plain JSON");
        result.push(copySchemaData(property.value, ancestors, depth + 1));
      }
      return result;
    }
    const result: Record<string, JsonValue> = {};
    for (const key of keys) {
      if (typeof key !== "string") throw new TypeError("Schema must be plain JSON");
      const property = properties[key];
      if (!property || !("value" in property) || !property.enumerable)
        throw new TypeError("Schema must be plain JSON");
      Object.defineProperty(result, key, {
        value: copySchemaData(property.value, ancestors, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

/** Validate, detach, and freeze a supported schema; reject unsupported vocabulary before any invocation. */
export function snapshotSchema(schema: unknown, name: string): JsonValue {
  let snapshot: JsonValue;
  try {
    snapshot = copySchemaData(schema, new WeakSet(), 0);
  } catch {
    throw new TypeError(`Schema for ${name} must be a plain JSON Schema object`);
  }
  const checked = validateSchema(snapshot, null);
  if (!checked.ok && checked.issues.some((issue) => issue.code === "invalid_schema")) {
    throw new TypeError(`Schema for ${name} is invalid or unsupported`);
  }
  return freezeJson(snapshot);
}

/**
 * Creates an in-process runtime. Authorization is a trusted host responsibility;
 * ASK pauses by returning a result and is never interpreted as permission.
 * Non-read effects fail closed: this runtime has no automatic kernel bridge.
 * A read classification is a trusted developer declaration, not proof of purity.
 */
export function createToolRuntime<Context>(
  options: ToolRuntimeOptions<Context>,
): ToolRuntime<Context> {
  if (typeof options.authorize !== "function") {
    throw new TypeError("A host authorization callback is required");
  }
  const authorize = options.authorize;
  const registry = new Map<
    string,
    {
      /** Captured trusted handler declaration used only after validation and host authorization. */
      definition: ToolDefinition<Context>;
      /** Immutable discovery and validation view paired with the captured handler. */
      descriptor: ToolDescriptor;
    }
  >();
  for (const definition of options.definitions) {
    if (registry.has(definition.name)) {
      throw new TypeError(`Duplicate tool: ${definition.name}`);
    }
    if (definition.schemas !== undefined && options.schemas !== undefined) {
      throw new TypeError("Bound tools cannot be paired with a separate schema map");
    }
    const schemas =
      definition.schemas ??
      (options.schemas !== undefined && Object.hasOwn(options.schemas, definition.name)
        ? options.schemas[definition.name]
        : undefined);
    if (
      schemas === undefined ||
      schemas.inputSchema === undefined ||
      schemas.outputSchema === undefined
    ) {
      throw new TypeError(`Missing schemas for tool: ${definition.name}`);
    }
    const descriptor: ToolDescriptor = Object.freeze({
      ...definition.documentation,
      name: definition.name,
      description: definition.description,
      effect: definition.effect,
      inputSchema: snapshotSchema(schemas.inputSchema, definition.name),
      outputSchema: snapshotSchema(schemas.outputSchema, definition.name),
      ...(definition.provenance === undefined ? {} : { provenance: definition.provenance }),
    });
    registry.set(definition.name, { definition, descriptor });
  }
  const descriptors = Object.freeze([...registry.values()].map(({ descriptor }) => descriptor));
  return Object.freeze({
    list: (): readonly ToolDescriptor[] => descriptors,
    /** Validate a detached input snapshot, authorize it through the host, and validate read-handler output before disclosure. */
    async invoke(name: string, input: unknown, context: Context): Promise<ToolInvocationResult> {
      const entry = registry.get(name);
      if (entry === undefined) return { status: "not_found" };
      const validatedInput = validateSchema(entry.descriptor.inputSchema, input);
      if (!validatedInput.ok) return { status: "invalid_input", issues: validatedInput.issues };
      const safeInput = freezeJson(validatedInput.value);
      let decision: AuthorizationDecision;
      try {
        decision = await authorize(
          Object.freeze({ tool: entry.descriptor, input: safeInput, context }),
        );
      } catch {
        return { status: "authorization_error" };
      }
      if (decision === "ASK") return { status: "ask" };
      if (decision === "DENY") return { status: "deny" };
      if (decision !== "ALLOW") return { status: "authorization_error" };
      if (entry.descriptor.effect !== "read") return { status: "kernel_required" };
      // Keep the authorized snapshot immutable, while allowing ordinary mutable
      // TypeScript inputs inside the trusted handler.
      const handlerInput = validateSchema(entry.descriptor.inputSchema, safeInput);
      if (!handlerInput.ok) return { status: "invalid_input", issues: handlerInput.issues };
      let output: unknown;
      try {
        output = await entry.definition[executeTool](handlerInput.value, context);
      } catch {
        return { status: "execution_error" };
      }
      const validatedOutput = validateSchema(entry.descriptor.outputSchema, output);
      if (!validatedOutput.ok) return { status: "invalid_output", issues: validatedOutput.issues };
      return { status: "success", output: freezeJson(validatedOutput.value) };
    },
  });
}
