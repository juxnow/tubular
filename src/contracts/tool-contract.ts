import { deepFreezeJsonObject, type JsonObject, type JsonValue } from "../core/json.js";
import type {
  AuthorityRequirement,
  ContextRequirement,
  EffectDeclaration,
  ExecutionSemantics,
  TargetDefinition,
} from "../port-authority/definition.js";
import type { RuntimeSchema, ValidationResult } from "./schema.js";

/** Ordered effect ceiling: read, draft, workspace-write, external-write, destructive. Declarations are trusted host claims. */
export type EffectClass = "read" | "draft" | "workspace-write" | "external-write" | "destructive";

/** None skips human approval but not policy; exact-human requires one exact proposal binding. */
export type ApprovalRequirement = "none" | "exact-human";

/** Declared contract failure and retry guidance; it does not imply an HTTP status mapping. */
export interface ContractError {
  /** Stable diagnostic category used for programmatic handling instead of parsing display text. */
  readonly code: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Whether this failure may be retried after its stated condition changes; not permission to repeat an uncertain effect. */
  readonly retryable: boolean;
}

/** Transport-independent discovery semantics projected from the canonical legacy contract. */
export interface PortableContractSemantics extends JsonObject {
  /** Named resources selected from input for the declared effect and authority checks. */
  readonly targets: readonly TargetDefinition[];
  /** Explicit context requirements or bindings; there is no automatic context discovery. */
  readonly contexts: readonly ContextRequirement[];
  /** Portable host-verifiable authority requirement, never a model-issued grant. */
  readonly authority: AuthorityRequirement;
  /** Declared possible or guaranteed effects, used for contract discovery rather than granting permission. */
  readonly effects: readonly EffectDeclaration[];
  /** Declared completion and replay semantics checked against the legacy kernel contract. */
  readonly execution: ExecutionSemantics;
  /** Identifier of the lifecycle declared by the portable definition; metadata does not drive the kernel state machine. */
  readonly lifecycleRef: string;
}

/** Trusted legacy contract declaration pairing schemas, parsers, policy metadata, and a resource resolver. */
export interface ToolContractDefinition<I extends JsonObject, O extends JsonValue> {
  /** Unique canonical tool identifier used by policy grants and executor lookup. */
  readonly name: string;
  /** Explicit contract or component version; callers should not infer compatibility from matching names alone. */
  readonly version: string;
  /** Short human-readable display title; identifiers remain the stable integration keys. */
  readonly title: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Trusted host effect classification checked against the lease ceiling; model arguments cannot select or downgrade it. */
  readonly effect: EffectClass;
  /** Host-declared approval gate; exact-human binds approval to one proposal digest. */
  readonly approval: ApprovalRequirement;
  /** Canonical input schema and parser checked before resolving resources or evaluating policy. */
  readonly input: RuntimeSchema<I>;
  /** Canonical success schema and parser checked before a receipt is issued. */
  readonly output: RuntimeSchema<O>;
  /** Declared failure categories and retry guidance; these are contract metadata, not HTTP routes. */
  readonly errors: readonly ContractError[];
  /** Portable discovery metadata checked for consistency with the executable contract. */
  readonly semantics: PortableContractSemantics;
  /** Select the target resource from validated input for policy matching before dispatch. */
  resolveResource(input: I): string;
}

/** Sealed contract registered by defineToolContract, with erased but validated JSON boundaries. */
export interface RegisteredToolContract {
  /** Exact sealed tool identifier used across registry, policy, and execution. */
  readonly name: string;
  /** Explicit contract or component version; callers should not infer compatibility from matching names alone. */
  readonly version: string;
  /** Short human-readable display title; identifiers remain the stable integration keys. */
  readonly title: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Trusted host effect classification checked against the lease ceiling; model arguments cannot select or downgrade it. */
  readonly effect: EffectClass;
  /** Host-declared approval requirement enforced by the kernel, not by projection extensions. */
  readonly approval: ApprovalRequirement;
  /** Canonical JSON Schema describing accepted input; consumers must also respect host policy and runtime validation. */
  readonly inputSchema: JsonObject;
  /** Canonical JSON Schema describing successful output; invalid output must not be released as a success. */
  readonly outputSchema: JsonObject;
  /** Declared failure categories and retry guidance; these are contract metadata, not HTTP routes. */
  readonly errors: readonly ContractError[];
  /** Sealed portable discovery metadata shared by all contract projections. */
  readonly semantics: PortableContractSemantics;
  /** Validate and narrow unknown arguments into the canonical JSON input shape. */
  validateInput(input: unknown): ValidationResult<JsonObject>;
  /** Validate unknown executor output before audit completion and receipt release. */
  validateOutput(output: unknown): ValidationResult<JsonValue>;
  /** Resolve a canonical resource from validated input; this may not widen lease permissions. */
  resolveResource(input: JsonObject): string;
}

const definedToolContracts = new WeakSet<object>();

/** Recursively inspect a portable authority expression for a named scheme; this is not authorization. */
function authorityUsesScheme(requirement: AuthorityRequirement, schemeId: string): boolean {
  if (requirement.kind === "none") {
    return false;
  }
  if (requirement.kind === "scheme") {
    return requirement.schemeRef === schemeId;
  }
  return requirement.requirements.some((child) => authorityUsesScheme(child, schemeId));
}

/** Check this module's object-identity registry of sealed definitions; structural lookalikes are rejected. */
export function isDefinedToolContract(contract: RegisteredToolContract): boolean {
  return definedToolContracts.has(contract);
}

/** Validate metadata consistency and capture parsers and resolver in a sealed canonical contract. */
export function defineToolContract<I extends JsonObject, O extends JsonValue>(
  definition: ToolContractDefinition<I, O>,
): RegisteredToolContract {
  if (definition.semantics.effects.length === 0) {
    throw new TypeError("Portable contract semantics must declare an effect ceiling");
  }
  const semanticEffectClasses = definition.semantics.effects.map((effect) => {
    if (!isEffectClass(effect.kindRef)) {
      throw new TypeError(`Totally Tubular cannot enforce unknown effect kind: ${effect.kindRef}`);
    }
    return effect.kindRef;
  });
  const semanticEffectCeiling = semanticEffectClasses.reduce((ceiling, effect) =>
    effectRanks[effect] > effectRanks[ceiling] ? effect : ceiling,
  );
  if (semanticEffectCeiling !== definition.effect) {
    throw new TypeError("Runtime effect ceiling must equal the strongest portable semantic effect");
  }
  const semanticRequiresExactHuman = authorityUsesScheme(
    definition.semantics.authority,
    "exact-human-approval",
  );
  if (semanticRequiresExactHuman !== (definition.approval === "exact-human")) {
    throw new TypeError("Runtime approval must exactly match portable contract authority");
  }
  const inputSchema = deepFreezeJsonObject(definition.input.jsonSchema);
  const outputSchema = deepFreezeJsonObject(definition.output.jsonSchema);
  const inputParser = definition.input.parse;
  const outputParser = definition.output.parse;
  const resolveResource = definition.resolveResource;
  const errors = Object.freeze(definition.errors.map((error) => Object.freeze({ ...error })));
  const semantics = deepFreezeJsonObject(definition.semantics);
  const contract: RegisteredToolContract = Object.freeze({
    name: definition.name,
    version: definition.version,
    title: definition.title,
    description: definition.description,
    effect: definition.effect,
    approval: definition.approval,
    inputSchema,
    outputSchema,
    errors,
    semantics,
    /** Run the captured input parser at the untrusted JSON boundary. */
    validateInput(input: unknown): ValidationResult<JsonObject> {
      const result = inputParser(input);
      if (!result.ok) {
        return result;
      }
      return { ok: true, value: result.value };
    },
    /** Run the captured output parser before recording success or disclosing results. */
    validateOutput(output: unknown): ValidationResult<JsonValue> {
      const result = outputParser(output);
      if (!result.ok) {
        return result;
      }
      return { ok: true, value: result.value };
    },
    /** Revalidate input before calling the trusted resource resolver. */
    resolveResource(input: JsonObject): string {
      const parsed = inputParser(input);
      if (!parsed.ok) {
        throw new TypeError("resolveResource received input that failed its contract");
      }
      return resolveResource(parsed.value);
    },
  });
  definedToolContracts.add(contract);
  return contract;
}

const effectRanks: Readonly<Record<EffectClass, number>> = {
  read: 0,
  draft: 1,
  "workspace-write": 2,
  "external-write": 3,
  destructive: 4,
};

const effectClassValues = new Set<string>(Object.keys(effectRanks));

/** Narrow to one supported kernel effect class without accepting unknown strings. */
function isEffectClass(value: string): value is EffectClass {
  return effectClassValues.has(value);
}

/** Compare trusted effect declarations using the kernel's fixed effect ceiling order. */
export function effectAtMost(actual: EffectClass, ceiling: EffectClass): boolean {
  return effectRanks[actual] <= effectRanks[ceiling];
}
