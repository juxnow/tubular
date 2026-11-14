import type { JsonObject, JsonValue } from "../core/json.js";

/** A validation diagnostic. Paths identify values without including their contents. */
export interface SchemaIssue {
  /** Value location: generated validators use JSON Pointer with an empty root; legacy parsers use slash paths with `/` at the root. */
  readonly path: string;
  /** Stable diagnostic category such as `type`, `unknown_property`, or `invalid_schema`. */
  readonly code: string;
  /** Explanation of the violated contract, intended for developers rather than policy decisions. */
  readonly message: string;
}

/** Discriminated parser result. Failure exposes diagnostics and never a partially validated value. */
export type ValidationResult<T> =
  | {
      /** Discriminator selecting validated value on success or diagnostic issues on failure. */
      readonly ok: true;
      /** Fully validated value; only available when ok is true. */
      readonly value: T;
    }
  | {
      /** Discriminator selecting validated value on success or diagnostic issues on failure. */
      readonly ok: false;
      /** Validation failures; no partially validated value is exposed on this branch. */
      readonly issues: readonly SchemaIssue[];
    };

/** A JSON Schema and its corresponding trusted parser; authors must keep both semantics aligned. */
export interface RuntimeSchema<T extends JsonValue> {
  /** Canonical schema published in projections; its constraints must match the parser's accepted values. */
  readonly jsonSchema: JsonObject;
  /** Validate unknown input and return a typed value or structured diagnostics without granting authority. */
  parse(input: unknown): ValidationResult<T>;
}

/** Construct a single structured validation failure at the supplied value path. */
export function invalid(path: string, code: string, message: string): ValidationResult<never> {
  return { ok: false, issues: [{ path, code, message }] };
}

/** Report unknown own enumerable keys instead of silently stripping model-supplied fields. */
export function hasOnlyKeys(
  input: JsonObject,
  allowedKeys: ReadonlySet<string>,
): readonly SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: `/${key}`,
        code: "unknown_property",
        message: `Unknown property: ${key}`,
      });
    }
  }
  return issues;
}
