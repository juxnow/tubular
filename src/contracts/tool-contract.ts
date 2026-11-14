import {
  deepFreezeJsonObject,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";
import type { RuntimeSchema, ValidationResult } from "./schema.js";
import type {
  AuthorityRequirement,
  ContextRequirement,
  EffectDeclaration,
  ExecutionSemantics,
  TargetDefinition,
} from "../port-authority/definition.js";

export type EffectClass =
  | "read"
  | "draft"
  | "workspace-write"
  | "external-write"
  | "destructive";

export type ApprovalRequirement = "none" | "exact-human";

export interface ContractError {
  readonly code: string;
  readonly description: string;
  readonly retryable: boolean;
}

export interface PortableContractSemantics extends JsonObject {
  readonly targets: readonly TargetDefinition[];
  readonly contexts: readonly ContextRequirement[];
  readonly authority: AuthorityRequirement;
  readonly effects: readonly EffectDeclaration[];
  readonly execution: ExecutionSemantics;
  readonly lifecycleRef: string;
}

export interface ToolContractDefinition<I extends JsonObject, O extends JsonValue> {
  readonly name: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly effect: EffectClass;
  readonly approval: ApprovalRequirement;
  readonly input: RuntimeSchema<I>;
  readonly output: RuntimeSchema<O>;
  readonly errors: readonly ContractError[];
  readonly semantics: PortableContractSemantics;
  resolveResource(input: I): string;
}

export interface RegisteredToolContract {
  readonly name: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly effect: EffectClass;
  readonly approval: ApprovalRequirement;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly errors: readonly ContractError[];
  readonly semantics: PortableContractSemantics;
  validateInput(input: unknown): ValidationResult<JsonObject>;
  validateOutput(output: unknown): ValidationResult<JsonValue>;
  resolveResource(input: JsonObject): string;
}

const definedToolContracts = new WeakSet<object>();

function authorityUsesScheme(
  requirement: AuthorityRequirement,
  schemeId: string,
): boolean {
  if (requirement.kind === "none") {
    return false;
  }
  if (requirement.kind === "scheme") {
    return requirement.schemeRef === schemeId;
  }
  return requirement.requirements.some((child) =>
    authorityUsesScheme(child, schemeId),
  );
}

export function isDefinedToolContract(
  contract: RegisteredToolContract,
): boolean {
  return definedToolContracts.has(contract);
}

export function defineToolContract<I extends JsonObject, O extends JsonValue>(
  definition: ToolContractDefinition<I, O>,
): RegisteredToolContract {
  if (definition.semantics.effects.length === 0) {
    throw new TypeError("Portable contract semantics must declare an effect ceiling");
  }
  const semanticEffectClasses = definition.semantics.effects.map((effect) => {
    if (!isEffectClass(effect.kindRef)) {
      throw new TypeError(
        `Totally Tubular cannot enforce unknown effect kind: ${effect.kindRef}`,
      );
    }
    return effect.kindRef;
  });
  const semanticEffectCeiling = semanticEffectClasses.reduce(
    (ceiling, effect) =>
      effectRanks[effect] > effectRanks[ceiling] ? effect : ceiling,
  );
  if (semanticEffectCeiling !== definition.effect) {
    throw new TypeError(
      "Runtime effect ceiling must equal the strongest portable semantic effect",
    );
  }
  const semanticRequiresExactHuman = authorityUsesScheme(
    definition.semantics.authority,
    "exact-human-approval",
  );
  if (
    semanticRequiresExactHuman !== (definition.approval === "exact-human")
  ) {
    throw new TypeError(
      "Runtime approval must exactly match portable contract authority",
    );
  }
  const inputSchema = deepFreezeJsonObject(definition.input.jsonSchema);
  const outputSchema = deepFreezeJsonObject(definition.output.jsonSchema);
  const inputParser = definition.input.parse;
  const outputParser = definition.output.parse;
  const resolveResource = definition.resolveResource;
  const errors = Object.freeze(
    definition.errors.map((error) => Object.freeze({ ...error })),
  );
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
    validateInput(input: unknown): ValidationResult<JsonObject> {
      const result = inputParser(input);
      if (!result.ok) {
        return result;
      }
      return { ok: true, value: result.value };
    },
    validateOutput(output: unknown): ValidationResult<JsonValue> {
      const result = outputParser(output);
      if (!result.ok) {
        return result;
      }
      return { ok: true, value: result.value };
    },
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

function isEffectClass(value: string): value is EffectClass {
  return effectClassValues.has(value);
}

export function effectAtMost(actual: EffectClass, ceiling: EffectClass): boolean {
  return effectRanks[actual] <= effectRanks[ceiling];
}
