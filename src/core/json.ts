import { createHash } from "node:crypto";

export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const objectValue = value as JsonObject;
  const keys = Object.keys(objectValue).sort();
  const entries: string[] = [];

  for (const key of keys) {
    const child = objectValue[key];
    if (child === undefined) {
      throw new TypeError(`JSON object key ${key} has an undefined value`);
    }
    entries.push(`${JSON.stringify(key)}:${stableStringify(child)}`);
  }

  return `{${entries.join(",")}}`;
}

export function stablePrettyStringify(value: JsonValue, indent = 2): string {
  function render(current: JsonValue, depth: number): string {
    if (current === null || typeof current !== "object") {
      return JSON.stringify(current);
    }
    if (Array.isArray(current)) {
      if (current.length === 0) {
        return "[]";
      }
      const padding = " ".repeat(indent * (depth + 1));
      const closing = " ".repeat(indent * depth);
      return `[\n${current
        .map((item) => `${padding}${render(item, depth + 1)}`)
        .join(",\n")}\n${closing}]`;
    }
    const objectValue = current as JsonObject;
    const keys = Object.keys(objectValue).sort();
    if (keys.length === 0) {
      return "{}";
    }
    const padding = " ".repeat(indent * (depth + 1));
    const closing = " ".repeat(indent * depth);
    const entries: string[] = [];
    for (const key of keys) {
      const child = objectValue[key];
      if (child === undefined) {
        throw new TypeError(`JSON object key ${key} has an undefined value`);
      }
      entries.push(`${padding}${JSON.stringify(key)}: ${render(child, depth + 1)}`);
    }
    return `{\n${entries.join(",\n")}\n${closing}}`;
  }

  if (!Number.isSafeInteger(indent) || indent < 0) {
    throw new TypeError("indent must be a non-negative safe integer");
  }
  return render(value, 0);
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contentAddress(prefix: string, value: JsonValue): string {
  return `${prefix}_${sha256(stableStringify(value)).slice(0, 24)}`;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueInternal(value, new WeakSet<object>());
}

function isJsonValueInternal(
  value: unknown,
  ancestors: WeakSet<object>,
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return false;
    }
    ancestors.add(value);
    const valid = value.every((item) => isJsonValueInternal(item, ancestors));
    ancestors.delete(value);
    return valid;
  }
  if (!isJsonObject(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    ancestors.has(value)
  ) {
    return false;
  }
  ancestors.add(value);
  const valid = Object.values(value).every(
    (child) => child !== undefined && isJsonValueInternal(child, ancestors),
  );
  ancestors.delete(value);
  return valid;
}

export function deepFreezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeJson(item)));
  }
  return deepFreezeJsonObject(value as JsonObject);
}

export function deepFreezeJsonObject<T extends JsonObject>(value: T): T {
  const clone: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(clone, key, { value: deepFreezeJson(child), enumerable: true });
  }
  return Object.freeze(clone) as T;
}
