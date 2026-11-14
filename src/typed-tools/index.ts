import type { ApprovalRequirement, EffectClass } from "../contracts/tool-contract.js";
import type { ExecutionReceipt } from "../authority/types.js";
import type { KernelFailure } from "../core/errors.js";
import type { SchemaIssue } from "../contracts/schema.js";
import type { JsonValue } from "../core/json.js";
import { validateSchema } from "../type-validation/index.js";

/** Internal adapter hook. Only invoke after canonical input validation. */
export const executeTool = Symbol("execute typed tool");
const supportedEffects = new Set<EffectClass>(["read", "draft", "workspace-write", "external-write", "destructive"]);

export interface ToolDeclaration<Input, Output, Context> {
  readonly name: string;
  readonly description: string;
  readonly effect: EffectClass;
  readonly handler: (input: Input, context: Context) => Output | Promise<Output>;
}

/** A declaration with its input type erased only at the validated runtime boundary. */
export interface ToolDefinition<Context> {
  readonly name: string;
  readonly description: string;
  readonly effect: EffectClass;
  readonly schemas?: GeneratedToolSchemas;
  readonly provenance?: BindingProvenance;
  readonly [executeTool]: (input: JsonValue, context: Context) => unknown;
}

export interface BindingProvenance {
  readonly entry: string;
  readonly exportName: string;
  readonly sourceDigest: string;
}

export interface BoundToolOptions<Input> {
  readonly name?: string;
  readonly description: string;
  readonly effect: EffectClass;
  readonly approval?: ApprovalRequirement;
  readonly resource?: (input: Input) => string;
}

export interface BoundToolDefinition<Context> extends ToolDefinition<Context> {
  readonly schemas: GeneratedToolSchemas;
  readonly provenance: BindingProvenance;
  readonly approval: ApprovalRequirement;
  readonly resolveResource?: (input: JsonValue) => string;
}

/** Compiler output uses this to capture the imported handler and its schemas together. */
export function bindTool<Input, Output, Context>(
  handler: (input: Input, context: Context) => Output | Promise<Output>,
  schemas: GeneratedToolSchemas,
  provenance: BindingProvenance,
): (options: BoundToolOptions<Input>) => BoundToolDefinition<Context> {
  if (!provenance.entry || !provenance.exportName || !/^[a-f0-9]{64}$/.test(provenance.sourceDigest)) {
    throw new TypeError("Generated bindings require source provenance");
  }
  const source = Object.freeze({ ...provenance });
  const snapshot = Object.freeze({
    inputSchema: snapshotSchema(schemas.inputSchema, source.exportName),
    outputSchema: snapshotSchema(schemas.outputSchema, source.exportName),
  });
  return (options) => {
    const approval = options.approval ?? (options.effect === "read" ? "none" : "exact-human");
    if (approval !== "none" && approval !== "exact-human") throw new TypeError("Unsupported approval requirement");
    const resource = options.resource;
    return Object.freeze({
      ...defineTool({ name: options.name ?? source.exportName, description: options.description, effect: options.effect, handler }),
      schemas: snapshot,
      provenance: source,
      approval,
      // This adapter receives only input validated against the captured schema.
      ...(resource === undefined ? {} : { resolveResource: (input: JsonValue): string => resource(input as Input) }),
    });
  };
}

export interface GeneratedToolSchemas {
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly effect: EffectClass;
  readonly inputSchema: JsonValue;
  readonly outputSchema: JsonValue;
  readonly provenance?: BindingProvenance;
  readonly approval?: ApprovalRequirement;
  readonly execution?: "governed";
}

export type AuthorizationDecision = "ALLOW" | "ASK" | "DENY";

export interface AuthorizationRequest<Context> {
  readonly tool: ToolDescriptor;
  readonly input: JsonValue;
  readonly context: Context;
}

export interface ToolRuntimeOptions<Context> {
  readonly definitions: readonly ToolDefinition<Context>[];
  readonly schemas?: Readonly<Record<string, GeneratedToolSchemas>>;
  readonly authorize: (request: AuthorizationRequest<Context>) =>
    AuthorizationDecision | Promise<AuthorizationDecision>;
}

export type ToolInvocationResult =
  | { readonly status: "success"; readonly output: JsonValue; readonly receipt?: ExecutionReceipt; readonly replayed?: boolean }
  | { readonly status: "invalid_input" | "invalid_output"; readonly issues: readonly SchemaIssue[] }
  | { readonly status: "ask"; readonly proposalId?: string; readonly proposalDigest?: string }
  | { readonly status: "deny" | "not_found" | "authorization_error" | "execution_error" | "kernel_required"; readonly failure?: KernelFailure };

export interface ToolRuntime<Context> {
  list(): readonly ToolDescriptor[];
  invoke(name: string, input: unknown, context: Context): Promise<ToolInvocationResult>;
}

/**
 * Use the same input and output types on the function passed to the compiler.
 * Generated schemas are bound by tool name when the runtime is created.
 */
export function defineTool<Input, Output, Context>(
  declaration: ToolDeclaration<Input, Output, Context>,
): ToolDefinition<Context> {
  if (typeof declaration.name !== "string" || !declaration.name.trim() ||
      typeof declaration.description !== "string" || !declaration.description.trim() ||
      typeof declaration.handler !== "function" || !supportedEffects.has(declaration.effect)) {
    throw new TypeError("A tool requires a name, description, supported effect, and handler");
  }
  const handler = declaration.handler;
  return Object.freeze({
    name: declaration.name,
    description: declaration.description,
    effect: declaration.effect,
    // The generated schema for Input is checked immediately before this call.
    [executeTool]: (input: JsonValue, context: Context): unknown => handler(input as Input, context),
  });
}

function freezeJson(value: JsonValue): JsonValue {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      freezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}

function copySchemaData(value: unknown, ancestors: WeakSet<object>, depth: number): JsonValue {
  if (depth > 100) throw new TypeError("Schema nesting limit exceeded");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value)) throw new TypeError("Schema must be plain JSON");
  const isArray = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Schema must be plain JSON");
  }
  const properties = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(properties);
  if (keys.some((key) => typeof key !== "string")) throw new TypeError("Schema must be plain JSON");
  ancestors.add(value);
  try {
    if (isArray) {
      const length: unknown = properties["length"]?.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) {
        throw new TypeError("Schema must be plain JSON");
      }
      const result: JsonValue[] = [];
      for (let i = 0; i < length; i += 1) {
        const property = properties[String(i)];
        if (!property || !("value" in property) || !property.enumerable) throw new TypeError("Schema must be plain JSON");
        result.push(copySchemaData(property.value, ancestors, depth + 1));
      }
      return result;
    }
    const result: Record<string, JsonValue> = {};
    for (const key of keys) {
      if (typeof key !== "string") throw new TypeError("Schema must be plain JSON");
      const property = properties[key];
      if (!property || !("value" in property) || !property.enumerable) throw new TypeError("Schema must be plain JSON");
      Object.defineProperty(result, key, { value: copySchemaData(property.value, ancestors, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

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
export function createToolRuntime<Context>(options: ToolRuntimeOptions<Context>): ToolRuntime<Context> {
  if (typeof options.authorize !== "function") {
    throw new TypeError("A host authorization callback is required");
  }
  const authorize = options.authorize;
  const registry = new Map<string, { definition: ToolDefinition<Context>; descriptor: ToolDescriptor }>();
  for (const definition of options.definitions) {
    if (registry.has(definition.name)) {
      throw new TypeError(`Duplicate tool: ${definition.name}`);
    }
    if (definition.schemas !== undefined && options.schemas !== undefined) {
      throw new TypeError("Bound tools cannot be paired with a separate schema map");
    }
    const schemas = definition.schemas ?? (options.schemas !== undefined && Object.hasOwn(options.schemas, definition.name) ? options.schemas[definition.name] : undefined);
    if (schemas === undefined || schemas.inputSchema === undefined || schemas.outputSchema === undefined) {
      throw new TypeError(`Missing schemas for tool: ${definition.name}`);
    }
    const descriptor: ToolDescriptor = Object.freeze({
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
    async invoke(name: string, input: unknown, context: Context): Promise<ToolInvocationResult> {
      const entry = registry.get(name);
      if (entry === undefined) return { status: "not_found" };
      const validatedInput = validateSchema(entry.descriptor.inputSchema, input);
      if (!validatedInput.ok) return { status: "invalid_input", issues: validatedInput.issues };
      const safeInput = freezeJson(validatedInput.value);
      let decision: AuthorizationDecision;
      try {
        decision = await authorize(Object.freeze({ tool: entry.descriptor, input: safeInput, context }));
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
