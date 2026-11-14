import { describe, expect, it } from "vitest";
import { validateSchema } from "../src/type-validation/index.js";

const contract = {
  type: "object",
  properties: {
    name: { type: "string", description: "Person name" },
    count: { type: "number" },
    kind: { anyOf: [{ type: "string", const: "friend" }, { type: "string", const: "colleague" }] },
    notes: { type: "array", items: { anyOf: [{ type: "string" }, { type: "null" }] } },
    nested: { type: "object", properties: { active: { type: "boolean" } }, required: ["active"], additionalProperties: false },
  },
  required: ["name", "kind", "notes", "nested"],
  additionalProperties: false,
};

const valid = { name: "Tony", kind: "friend", notes: ["hello", null], nested: { active: true } };

describe("generated schema validation", () => {
  it("validates nested objects, arrays, optional properties, literals and unions", () => {
    const result = validateSchema(contract, valid);
    expect(result).toEqual({ ok: true, value: valid });
    if (result.ok) expect(result.value).not.toBe(valid);
    expect(validateSchema(contract, { ...valid, count: 3 }).ok).toBe(true);
    expect(validateSchema(contract, { ...valid, kind: "stranger" }).ok).toBe(false);
    expect(validateSchema(contract, { ...valid, notes: [false] }).ok).toBe(false);
    expect(validateSchema(contract, { ...valid, nested: {} }).ok).toBe(false);
    expect(validateSchema(contract, { ...valid, extra: true }).ok).toBe(false);
    expect(validateSchema(contract, { ...valid, count: undefined }).ok).toBe(false);
  });

  it("rejects unsupported or malformed schemas instead of widening them", () => {
    expect(validateSchema({ type: "string", pattern: "a" }, "b").ok).toBe(false);
    expect(validateSchema({ type: "object", properties: {} }, {}).ok).toBe(false);
    expect(validateSchema({ type: "object", properties: {}, required: ["missing"], additionalProperties: false }, {}).ok).toBe(false);
    expect(validateSchema({ type: "array" }, []).ok).toBe(false);
    expect(validateSchema({ anyOf: [] }, "anything").ok).toBe(false);
    expect(validateSchema({}, "anything").ok).toBe(false);
  });

  it("rejects malformed nested schemas even if another union branch would match", () => {
    const schema = {
      type: "object",
      properties: {
        choice: { anyOf: [{ type: "string" }, { type: "array", items: { type: "number", minimum: 2 } }] },
      },
      required: ["choice"],
      additionalProperties: false,
    };
    const result = validateSchema(schema, { choice: "valid for the first branch" });
    expect(result).toMatchObject({ ok: false, issues: [{ code: "invalid_schema" }] });
  });

  it("does not inspect input when the schema is invalid or invoke schema getters", () => {
    let schemaGetter = false;
    let inputGetter = false;
    const schema = Object.defineProperty({}, "type", { enumerable: true, get() { schemaGetter = true; return "string"; } });
    const input = Object.defineProperty({}, "secret", { enumerable: true, get() { inputGetter = true; return 1; } });
    expect(validateSchema(schema, input)).toMatchObject({ ok: false, issues: [{ code: "invalid_schema" }] });
    expect(schemaGetter).toBe(false);
    expect(inputGetter).toBe(false);
  });

  it("rejects non-finite numbers and non-JSON values", () => {
    expect(validateSchema({ type: "number" }, Number.NaN).ok).toBe(false);
    expect(validateSchema({ type: "number" }, Infinity).ok).toBe(false);
    expect(validateSchema({ type: "number" }, 3n).ok).toBe(false);
    expect(validateSchema({ type: "object", properties: {}, required: [], additionalProperties: false }, new Date()).ok).toBe(false);
  });

  it("does not execute getters and rejects custom prototypes, symbols, and hidden fields", () => {
    let touched = false;
    const getter = Object.defineProperty({}, "name", { enumerable: true, get() { touched = true; return "Tony"; } });
    expect(validateSchema(contract, getter).ok).toBe(false);
    expect(touched).toBe(false);
    expect(validateSchema(contract, Object.assign(Object.create({ inherited: true }), valid)).ok).toBe(false);
    expect(validateSchema(contract, { ...valid, [Symbol("secret")]: true }).ok).toBe(false);
    expect(validateSchema(contract, Object.defineProperty({ ...valid }, "hidden", { value: 1 })).ok).toBe(false);
  });

  it("rejects sparse and extended arrays and cyclic values", () => {
    const sparse = new Array(2);
    expect(validateSchema({ type: "array", items: { type: "number" } }, sparse).ok).toBe(false);
    const extended = [1];
    Object.defineProperty(extended, "extra", { value: true, enumerable: true });
    expect(validateSchema({ type: "array", items: { type: "number" } }, extended).ok).toBe(false);
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    expect(validateSchema(contract, cycle).ok).toBe(false);
  });

  it("rejects nested accessors without calling them", () => {
    let called = false;
    const nested = Object.defineProperty({}, "active", { enumerable: true, get() { called = true; return true; } });
    expect(validateSchema(contract, { ...valid, nested }).ok).toBe(false);
    expect(called).toBe(false);
  });

  it("treats __proto__ as a data property and fails safely on throwing proxies", () => {
    const input: unknown = JSON.parse('{"__proto__":{"polluted":true}}');
    const schema: unknown = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"object","properties":{"polluted":{"type":"boolean"}},"required":["polluted"],"additionalProperties":false}},"required":["__proto__"],"additionalProperties":false}');
    const result = validateSchema(schema, input);
    expect(result.ok).toBe(true);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    const throwing = new Proxy({}, { ownKeys() { throw new Error("hostile"); } });
    expect(validateSchema(contract, throwing).ok).toBe(false);
  });
});
