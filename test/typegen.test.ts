import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileToolBindings,
  compileToolSchemas,
  compileTypeSchemas,
  createSchemaCompiler,
} from "../src/typegen/index.js";

import { compilerProject as fixture } from "./fixtures/compiler-project.js";

describe("TypeScript schema compiler", () => {
  it("resolves virtual dependencies and holds one source snapshot until explicitly rebuilt", () => {
    const dependency = "export interface Query { term: string }";
    const input = fixture(
      `import type { Query } from "./query.js";
      export function search(input: Query): { result: string } { return { result: input.term } }`,
      {},
      { "query.ts": dependency },
    );
    const compiler = createSchemaCompiler(input);
    const schemas = compiler.compileTools(["search"]);
    const bindings = compiler.compileBindings(["search"], "bindings.ts");
    expect(schemas["search"]?.inputSchema.required).toEqual(["term"]);
    expect(bindings).toContain('from "./models.js"');
    input.migrate("query.ts", dependency, "export interface Query { term: string; limit: number }");
    expect(compiler.compileTools(["search"])).toEqual(schemas);
    expect(compiler.compileBindings(["search"], "bindings.ts")).toBe(bindings);
    const changed = createSchemaCompiler(input);
    expect(changed.compileTools(["search"])["search"]?.inputSchema.required).toEqual([
      "limit",
      "term",
    ]);
    expect(changed.compileBindings(["search"], "bindings.ts")).not.toBe(bindings);
    expect(input.writes).toEqual([]);
  });

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
    const compiler = createSchemaCompiler(input);
    const generated = compiler.compileBindings(options.functionNames, options.outputFile);
    expect(generated).toContain('import { "search" as handler0 } from "./models.js"');
    expect(generated).toContain("bindTool(handler0");
    expect(generated).toContain('"sourceDigest"');
    expect(compiler.compileBindings(options.functionNames, options.outputFile)).toBe(generated);
    input.migrate(
      "models.ts",
      source,
      source.replace("input.query + context.tenant", "context.tenant + input.query"),
    );
    expect(compiler.compileBindings(options.functionNames, options.outputFile)).toBe(generated);
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
    const compiler = createSchemaCompiler(input);
    const schema = compiler.compileTypes(["Input"]);
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
    expect(compiler.compileTypes(["Input"])).toEqual(schema);
  });

  it("rejects projects without strict null checking rather than erasing nullability", () => {
    const input = fixture("export interface Input { value: string | null }", {
      strictNullChecks: false,
    });
    expect(() => compileTypeSchemas({ ...input, typeNames: ["Input"] })).toThrow(
      /strictNullChecks must be enabled/,
    );
  });

  it("checks TypeScript diagnostics even when the project disables checking", () => {
    const input = fixture("export interface Input { value: MissingType }", { noCheck: true });
    expect(() => compileTypeSchemas({ ...input, typeNames: ["Input"] })).toThrow(
      /Cannot find name/,
    );
  });

  it("preserves nullability with TypeScript 6's implicit strict default", () => {
    const input = fixture("export interface Input { value: string | null }");
    const config = input.fileSystem.readFile(input.tsconfigPath);
    if (!config) throw new Error("Missing fixture configuration");
    input.migrate("tsconfig.json", config, config.replace('"strict":true,', ""));
    expect(
      compileTypeSchemas({ ...input, typeNames: ["Input"] })["Input"]?.properties?.["value"],
    ).toEqual({ anyOf: [{ type: "null" }, { type: "string" }] });
  });

  it("rejects explicit strict false unless strictNullChecks is explicitly restored", () => {
    const source = "export interface Input { value: string | null }";
    expect(() => createSchemaCompiler(fixture(source, { strict: false }))).toThrow(
      /strictNullChecks/,
    );
    expect(
      createSchemaCompiler(fixture(source, { strict: false, strictNullChecks: true })).compileTypes(
        ["Input"],
      )["Input"]?.properties?.["value"],
    ).toEqual({ anyOf: [{ type: "null" }, { type: "string" }] });
  });

  it("isolates cached schemas from caller mutation when producing later bindings", () => {
    const input = fixture(
      "export function greet(input: { name: string }): { greeting: string } { return { greeting: input.name }; }",
    );
    const compiler = createSchemaCompiler(input);
    const original = compiler.compileBindings(["greet"], "bindings.ts");
    const schemas = compiler.compileTools(["greet", "greet"]);
    const required = schemas["greet"]?.inputSchema.required;
    if (!required) throw new Error("Missing required name");
    required.splice(0);
    expect(compiler.compileTools(["greet"])["greet"]?.inputSchema.required).toEqual(["name"]);
    expect(compiler.compileBindings(["greet"], "bindings.ts")).toBe(original);
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
    const compiler = createSchemaCompiler(input);
    expect(() => compiler.compileTypes(["Missing"])).toThrow(/Export not found/);
    expect(() => compiler.compileTools(["scalar"])).toThrow(/input must be an object/);
    expect(() => compiler.compileTools(["two"])).toThrow(/one required input/);
    expect(() => compiler.compileTools(["optional"])).toThrow(/one required input/);
    expect(() => compiler.compileTools(["generic"])).toThrow(/no type parameters/);
    expect(() => compiler.compileTools(["badResult"])).toThrow(/Unsupported type/);
  });
});
