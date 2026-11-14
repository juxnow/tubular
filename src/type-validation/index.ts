import type { JsonObject, JsonValue } from "../core/json.js";
import type { SchemaIssue, ValidationResult } from "../contracts/schema.js";

/** The compiler emits this deliberately bounded subset of JSON Schema. */
const schemaKeywords = new Set([
  "type", "properties", "required", "additionalProperties", "items", "anyOf", "const", "description",
]);
const schemaTypes = new Set(["object", "array", "string", "number", "boolean", "null"]);
const maxDepth = 100;

function issue(path: string, code: string, message: string): SchemaIssue {
  return { path, code, message };
}

function pointer(path: string, key: string): string {
  return `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function record(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copies input before evaluating it, rejecting values JSON cannot safely represent. */
function copyJson(value: unknown, path: string, ancestors: WeakSet<object>, depth: number): ValidationResult<JsonValue> {
  if (depth > maxDepth) return { ok: false, issues: [issue(path, "depth", "Maximum nesting depth exceeded")] };
  if (value === null || typeof value === "string" || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value };
  if (typeof value !== "object" || value === null) return { ok: false, issues: [issue(path, "non_json", "Expected a JSON value")] };
  if (ancestors.has(value)) return { ok: false, issues: [issue(path, "cycle", "Cyclic values are not supported")] };

  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    return { ok: false, issues: [issue(path, "prototype", "Only plain JSON objects and arrays are supported")] };
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) return { ok: false, issues: [issue(path, "symbol", "Symbol properties are not supported")] };
  ancestors.add(value);
  try {
    if (array) {
      const lengthDescriptor = descriptors["length"];
      const length: unknown = lengthDescriptor?.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) {
        return { ok: false, issues: [issue(path, "array_shape", "Expected a dense array without extra properties")] };
      }
      const output: JsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const element = descriptors[String(index)];
        if (!element || !("value" in element) || !element.enumerable) return { ok: false, issues: [issue(pointer(path, String(index)), "array_shape", "Expected an enumerable data element")] };
        const copied = copyJson(element.value, pointer(path, String(index)), ancestors, depth + 1);
        if (!copied.ok) return copied;
        output.push(copied.value);
      }
      return { ok: true, value: output };
    }
    const output: Record<string, JsonValue> = {};
    for (const key of keys) {
      if (typeof key !== "string") continue;
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return { ok: false, issues: [issue(pointer(path, key), "property", "Expected an enumerable data property")] };
      }
      const copied = copyJson(descriptor.value, pointer(path, key), ancestors, depth + 1);
      if (!copied.ok) return copied;
      Object.defineProperty(output, key, { value: copied.value, enumerable: true, writable: true, configurable: true });
    }
    return { ok: true, value: output };
  } finally {
    ancestors.delete(value);
  }
}

function schemaIssues(schema: JsonValue, path: string, depth: number): SchemaIssue[] {
  if (!record(schema) || depth > maxDepth) return [issue(path, "invalid_schema", "Expected a supported schema object")];
  for (const key of Object.keys(schema)) {
    if (!schemaKeywords.has(key)) return [issue(pointer(path, key), "invalid_schema", `Unsupported schema keyword: ${key}`)];
  }
  const type = schema["type"];
  if (type !== undefined && (typeof type !== "string" || !schemaTypes.has(type))) return [issue(pointer(path, "type"), "invalid_schema", "Unsupported schema type")];
  if (schema["description"] !== undefined && typeof schema["description"] !== "string") return [issue(pointer(path, "description"), "invalid_schema", "Description must be a string")];
  const hasConst = Object.hasOwn(schema, "const");
  const constant = schema["const"];
  if (hasConst && constant !== null && typeof constant !== "string" && typeof constant !== "number" && typeof constant !== "boolean") return [issue(pointer(path, "const"), "invalid_schema", "Only primitive literals are supported")];
  const variants = schema["anyOf"];
  if (variants !== undefined) {
    if (!Array.isArray(variants) || variants.length === 0) return [issue(pointer(path, "anyOf"), "invalid_schema", "Expected nonempty alternatives")];
    for (let i = 0; i < variants.length; i += 1) {
      const child: JsonValue | undefined = variants[i];
      if (child === undefined) return [issue(path, "invalid_schema", "Missing alternative")];
      const errors = schemaIssues(child, pointer(pointer(path, "anyOf"), String(i)), depth + 1);
      if (errors.length) return errors;
    }
  }
  if (type === undefined && !hasConst && variants === undefined) return [issue(path, "invalid_schema", "Schema must constrain its value")];
  if (type === "object") {
    const properties = schema["properties"];
    if (!record(properties) || schema["additionalProperties"] !== false) return [issue(path, "invalid_schema", "Objects must declare properties and reject additional properties")];
    const required = schema["required"];
    if (required !== undefined) {
      if (!Array.isArray(required)) return [issue(pointer(path, "required"), "invalid_schema", "Required must be an array")];
      const seen = new Set<string>();
      for (const key of required) {
        if (typeof key !== "string" || !Object.hasOwn(properties, key) || seen.has(key)) return [issue(pointer(path, "required"), "invalid_schema", "Required properties must be unique declared names")];
        seen.add(key);
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      const errors = schemaIssues(child, pointer(pointer(path, "properties"), key), depth + 1);
      if (errors.length) return errors;
    }
  } else if (schema["properties"] !== undefined || schema["required"] !== undefined || schema["additionalProperties"] !== undefined) {
    return [issue(path, "invalid_schema", "Object keywords require object type")];
  }
  if (type === "array") {
    const items = schema["items"];
    if (items === undefined) return [issue(path, "invalid_schema", "Arrays must declare items")];
    const errors = schemaIssues(items, pointer(path, "items"), depth + 1);
    if (errors.length) return errors;
  } else if (schema["items"] !== undefined) {
    return [issue(path, "invalid_schema", "Items requires array type")];
  }
  return [];
}

function matches(schema: JsonObject, value: JsonValue, path: string): SchemaIssue[] {
  const type = schema["type"];
  const validType = type === undefined ||
    (type === "null" && value === null) ||
    (type === "object" && record(value)) ||
    (type === "array" && Array.isArray(value)) ||
    (type === "string" && typeof value === "string") ||
    (type === "number" && typeof value === "number") ||
    (type === "boolean" && typeof value === "boolean");
  if (!validType) return [issue(path, "type", `Expected ${String(type)}`)];
  if (Object.hasOwn(schema, "const") && value !== schema["const"]) return [issue(path, "const", "Value does not match the required literal")];
  const variants = schema["anyOf"];
  if (Array.isArray(variants) && !variants.some((candidate: JsonValue) => record(candidate) && matches(candidate, value, path).length === 0)) {
    return [issue(path, "any_of", "Value does not match any allowed alternative")];
  }
  if (type === "object" && record(value)) {
    const properties = schema["properties"];
    if (!record(properties)) return [issue(path, "invalid_schema", "Missing properties")];
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const key of required) if (typeof key === "string" && !Object.hasOwn(value, key)) return [issue(pointer(path, key), "required", "Required property is missing")];
    }
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(properties, key)) return [issue(pointer(path, key), "unknown_property", "Unexpected property")];
      const childSchema = properties[key];
      if (!record(childSchema)) return [issue(path, "invalid_schema", "Invalid property schema")];
      const errors = matches(childSchema, child, pointer(path, key));
      if (errors.length) return errors;
    }
  }
  if (type === "array" && Array.isArray(value)) {
    const itemSchema = schema["items"];
    if (!record(itemSchema)) return [issue(path, "invalid_schema", "Invalid item schema")];
    for (let i = 0; i < value.length; i += 1) {
      const child: JsonValue | undefined = value[i];
      if (child === undefined) return [issue(path, "non_json", "Missing array item")];
      const errors = matches(itemSchema, child, pointer(path, String(i)));
      if (errors.length) return errors;
    }
  }
  return [];
}

/** Validate and defensively copy data against the compiler's JSON Schema subset. */
export function validateSchema(schema: unknown, input: unknown): ValidationResult<JsonValue> {
  try {
    const safeSchema = copyJson(schema, "", new WeakSet(), 0);
    if (!safeSchema.ok) return { ok: false, issues: [issue("", "invalid_schema", "Schema must be plain JSON data")] };
    const errors = schemaIssues(safeSchema.value, "", 0);
    if (errors.length || !record(safeSchema.value)) return { ok: false, issues: errors };
    const safeInput = copyJson(input, "", new WeakSet(), 0);
    if (!safeInput.ok) return safeInput;
    const failures = matches(safeSchema.value, safeInput.value, "");
    return failures.length ? { ok: false, issues: failures } : safeInput;
  } catch {
    return { ok: false, issues: [issue("", "invalid_input", "Could not safely inspect the supplied data")] };
  }
}
