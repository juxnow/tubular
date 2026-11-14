import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compileToolBindings,
  compileToolSchemas,
  compileTypeSchemas,
} from "../src/typegen/index.js";

const fixtures: string[] = [];
/** Create a temporary strict TypeScript project so compiler tests exercise real source declarations. */
function fixture(source: string): {
  /** Absolute path to the temporary strict compiler configuration. */
  tsconfigPath: string;
  /** Source entry filename relative to the fixture configuration directory. */
  entryFile: string;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tubular-types-"));
  fixtures.push(dir);
  const tsconfigPath = path.join(dir, "tsconfig.json");
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        skipLibCheck: true,
        types: [],
      },
      files: ["models.ts"],
    }),
  );
  writeFileSync(path.join(dir, "models.ts"), source);
  return { tsconfigPath, entryFile: "models.ts" };
}
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("TypeScript schema compiler", () => {
  it("merges object intersections and preserves readonly arrays and discriminated union members", () => {
    const input = fixture(`
      interface Base { id: string; count?: number }
      export type Input = Base & { count: number; items: readonly ({ kind: "a"; a: string } | { kind: "b"; b: number })[] };
    `);
    const schema = compileTypeSchemas({ ...input, typeNames: ["Input"] })["Input"];
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["count", "id", "items"],
      properties: {
        items: {
          type: "array",
          items: {
            anyOf: [
              { type: "object", required: ["a", "kind"] },
              { type: "object", required: ["b", "kind"] },
            ],
          },
        },
      },
    });
  });

  it("generates direct handler imports and detects implementation-only drift deterministically", () => {
    const source =
      "export function search(input: { query: string }, context: { tenant: string }): { result: string } { return { result: input.query + context.tenant } }";
    const input = fixture(source);
    const options = {
      ...input,
      functionNames: ["search"],
      outputFile: path.join(path.dirname(input.tsconfigPath), "bindings.ts"),
    };
    const generated = compileToolBindings(options);
    expect(generated).toContain('import { "search" as handler0 } from "./models.js"');
    expect(generated).toContain("bindTool(handler0");
    expect(generated).toContain('"sourceDigest"');
    expect(compileToolBindings(options)).toBe(generated);
    writeFileSync(
      path.join(path.dirname(input.tsconfigPath), "models.ts"),
      source.replace("input.query + context.tenant", "context.tenant + input.query"),
    );
    expect(compileToolBindings(options)).not.toBe(generated);
    expect(() =>
      compileToolBindings({
        ...options,
        outputFile: path.join(path.dirname(input.tsconfigPath), "models.ts"),
      }),
    ).toThrow(/overwrite/);
  });
  it("compiles nested, optional, array, literal and union types into closed schemas deterministically", () => {
    const input = fixture(`
      export interface Input {
        /** Item identifier. */
        id: string;
        count?: number;
        enabled: boolean;
        category: "a" | "b";
        values: Array<{ value: number | null }>;
      }
    `);
    const schema = compileTypeSchemas({ ...input, typeNames: ["Input"] });
    expect(schema).toEqual({
      Input: {
        type: "object",
        additionalProperties: false,
        required: ["category", "enabled", "id", "values"],
        properties: {
          category: {
            anyOf: [
              { type: "string", const: "a" },
              { type: "string", const: "b" },
            ],
          },
          count: { type: "number" },
          enabled: { type: "boolean" },
          id: { type: "string", description: "Item identifier." },
          values: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["value"],
              properties: { value: { anyOf: [{ type: "null" }, { type: "number" }] } },
            },
          },
        },
      },
    });
    expect(compileTypeSchemas({ ...input, typeNames: ["Input"] })).toEqual(schema);
  });

  it("rejects projects without strict null checking rather than erasing nullability", () => {
    const input = fixture("export interface Input { value: string | null }");
    writeFileSync(
      input.tsconfigPath,
      JSON.stringify({
        compilerOptions: { strictNullChecks: false, types: [] },
        files: ["models.ts"],
      }),
    );
    expect(() => compileTypeSchemas({ ...input, typeNames: ["Input"] })).toThrow(
      /strictNullChecks must be enabled/,
    );
  });

  it("checks TypeScript diagnostics even when the project disables checking", () => {
    const input = fixture("export interface Input { value: MissingType }");
    writeFileSync(
      input.tsconfigPath,
      JSON.stringify({
        compilerOptions: { strict: true, noCheck: true, types: [] },
        files: ["models.ts"],
      }),
    );
    expect(() => compileTypeSchemas({ ...input, typeNames: ["Input"] })).toThrow(
      /Cannot find name/,
    );
  });

  it("derives an async function's argument and awaited result without separate schemas", () => {
    const input = fixture(`
      export interface Search { query: string; limit?: number }
      export interface Result { matches: string[] }
      /** @tubular */
      export async function search(input: Search, context: { secret: string }): Promise<Result> { return { matches: [input.query + context.secret] }; }
    `);
    const schemas = compileToolSchemas({ ...input, functionNames: ["search"] });
    expect(schemas["search"]?.inputSchema).toMatchObject({
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" }, limit: { type: "number" } },
    });
    expect(schemas["search"]?.inputSchema.properties).not.toHaveProperty("secret");
    expect(schemas["search"]?.outputSchema).toMatchObject({
      type: "object",
      required: ["matches"],
      properties: { matches: { type: "array", items: { type: "string" } } },
    });
  });

  it.each([
    ["any", "export interface Input { dangerous: any }", /Unsupported type/],
    ["unknown", "export interface Input { dangerous: unknown }", /Unsupported type/],
    ["recursive", "export interface Input { next?: Input }", /Recursive type/],
    ["index signatures", "export interface Input { [key: string]: string }", /index signature/],
    ["methods", "export interface Input { run(): string }", /Unsupported property/],
    ["tuples", "export interface Input { point: [number, number] }", /Unsupported tuple/],
    [
      "branded primitives",
      "export type Input = string & { brand: 'id' }",
      /Unsupported intersection/,
    ],
    [
      "impossible intersections",
      "export type Input = { a: string } & { a: number }",
      /Unsupported type/,
    ],
    ["Date", "export interface Input { when: Date }", /Unsupported/],
    ["TypeScript errors", "export interface Input { value: MissingType }", /Cannot find name/],
  ])("rejects %s", (_label, source, error) => {
    const input = fixture(source);
    expect(() => compileTypeSchemas({ ...input, typeNames: ["Input"] })).toThrow(error);
  });

  it("rejects missing exports, non-object inputs and unsupported tool signatures", () => {
    const input = fixture(`
      export function scalar(input: string): string { return input }
      export function two(a: string, b: string, c: string): string { return a + b + c }
      export function optional(input?: { name: string }): string { return input?.name ?? "" }
      export function generic<T>(input: { value: T }): T { return input.value }
      export function badResult(input: { name: string }): any { return input }
    `);
    expect(() => compileTypeSchemas({ ...input, typeNames: ["Missing"] })).toThrow(
      /Export not found/,
    );
    expect(() => compileToolSchemas({ ...input, functionNames: ["scalar"] })).toThrow(
      /input must be an object/,
    );
    expect(() => compileToolSchemas({ ...input, functionNames: ["two"] })).toThrow(
      /one required input/,
    );
    expect(() => compileToolSchemas({ ...input, functionNames: ["optional"] })).toThrow(
      /one required input/,
    );
    expect(() => compileToolSchemas({ ...input, functionNames: ["generic"] })).toThrow(
      /no type parameters/,
    );
    expect(() => compileToolSchemas({ ...input, functionNames: ["badResult"] })).toThrow(
      /Unsupported type/,
    );
  });
});
