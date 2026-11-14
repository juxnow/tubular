import type { JsonObject, JsonValue } from "../core/json.js";

export interface SchemaIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

export interface RuntimeSchema<T extends JsonValue> {
  readonly jsonSchema: JsonObject;
  parse(input: unknown): ValidationResult<T>;
}

export function invalid(
  path: string,
  code: string,
  message: string,
): ValidationResult<never> {
  return { ok: false, issues: [{ path, code, message }] };
}

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
