import { createHash } from "node:crypto";

/** JSON scalar values; numbers must additionally be finite at runtime boundaries. */
export type JsonPrimitive = string | number | boolean | null;

/** String-keyed JSON data model. Use the boundary validators before trusting values cast or received as this type. */
export interface JsonObject {
  /** Each own string key must contain recursively valid JSON data; special keys confer no authority. */
  readonly [key: string]: JsonValue;
}

/** Recursive JSON data, excluding undefined, bigint, symbols, functions, and nonfinite numbers at runtime. */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

/** Serialize JSON with lexically ordered object keys for deterministic hashing; callers must supply valid JSON. */
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

/** Render deterministic indented JSON, including sorted object keys, for checked-in artifacts. */
export function stablePrettyStringify(value: JsonValue, indent = 2): string {
  /** Recursively render deterministic JSON at the requested indentation depth. */
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

/** Hash UTF-8 text or supplied bytes into lowercase SHA-256 hex; this is integrity evidence, not a signature. */
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Derive a prefixed identifier from canonical JSON content, so equal content produces equal addresses. */
export function contentAddress(prefix: string, value: JsonValue): string {
  return `${prefix}_${sha256(stableStringify(value)).slice(0, 24)}`;
}

/** Shallow non-null object guard excluding arrays; it does not inspect properties, prototypes, getters, or cycles. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Legacy recursive JSON-shape check. It reads enumerable values and can invoke getters; use validateSchema or assertJsonSafe at untrusted boundaries. */
export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueInternal(value, new WeakSet<object>());
}

/** Traverse enumerable values with ancestor tracking; this legacy helper is not safe inspection of arbitrary hostile JavaScript objects. */
function isJsonValueInternal(value: unknown, ancestors: WeakSet<object>): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
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

/** Recursively copy and freeze JSON containers; callers must supply already validated JSON data. */
export function deepFreezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeJson(item)));
  }
  return deepFreezeJsonObject(value as JsonObject);
}

/** Copy and freeze a typed JSON record and its descendants; the original caller-owned object is unchanged. */
export function deepFreezeJsonObject<T extends JsonObject>(value: T): T {
  const clone: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(clone, key, { value: deepFreezeJson(child), enumerable: true });
  }
  return Object.freeze(clone) as T;
}
