import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertOpenApi31 } from "../scripts/openapi-validation.js";
import { validateSchema } from "../src/type-validation/index.js";
import { createTypedMcpServer } from "../src/typed-mcp/index.js";
import { projectCapabilityManifest, projectTypedOpenApi } from "../src/typed-projections/index.js";
import { bindTool, createToolRuntime } from "../src/typed-tools/index.js";
import { compileToolSchemas, compileTypeSchemas } from "../src/typegen/index.js";
import { documentedSearch } from "./fixtures/documented-tools.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** Compile a small independent model to exercise annotation diagnostics without executing it. */
function compile(source: string) {
  const directory = mkdtempSync(path.join(tmpdir(), "tubular-doc-tags-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "models.ts"), source);
  writeFileSync(
    path.join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, types: [], skipLibCheck: true },
      files: ["models.ts"],
    }),
  );
  return compileTypeSchemas({
    tsconfigPath: path.join(directory, "tsconfig.json"),
    entryFile: "models.ts",
    typeNames: ["Input"],
  })["Input"];
}

describe("source documentation as executable contracts", () => {
  it("carries source descriptions and constraints through binding, validation, MCP, and OpenAPI 3.1", async () => {
    const schema = compileToolSchemas({
      tsconfigPath: "tsconfig.json",
      entryFile: "test/fixtures/documented-tools.ts",
      functionNames: ["documentedSearch"],
    })["documentedSearch"];
    if (schema === undefined) throw new Error("Missing compiled tool");
    expect(schema.inputSchema).toMatchObject({
      title: "Documented query",
      description: expect.stringContaining("scope is selected by the host"),
      properties: {
        id: { format: "uuid" },
        query: { minLength: 2, maxLength: 8, pattern: "^[a-z]+$", examples: ["hello"] },
        count: { type: "integer", minimum: 1, maximum: 5, default: 2 },
        label: { maxLength: 3, default: null },
        tags: { minItems: 1, maxItems: 2 },
      },
    });
    expect(schema.outputSchema.description).toContain("host-selected prefix");
    const handler = vi.fn(documentedSearch);
    const definition = bindTool(handler, schema, {
      entry: "documented-tools.ts",
      exportName: "documentedSearch",
      sourceDigest: "a".repeat(64),
    })({ effect: "read" });
    const runtime = createToolRuntime({ definitions: [definition], authorize: () => "ALLOW" });
    const input = { id: "123e4567-e89b-12d3-a456-426614174000", query: "hello", tags: ["a"] };
    expect(await runtime.invoke("documentedSearch", input, { prefix: "trusted" })).toMatchObject({
      status: "success",
      output: { value: "trusted:hello", count: 2, label: null },
    });
    expect(handler.mock.calls[0]?.[0]).not.toHaveProperty("count");
    const ajv = new Ajv2020({ strict: false });
    formats.default(ajv);
    const standardValidation = ajv.compile(schema.inputSchema);
    for (const sample of [
      input,
      { ...input, count: 5, label: null },
      { ...input, count: 1.5 },
      { ...input, count: 0 },
      { ...input, count: 6 },
      { ...input, label: "long" },
      { ...input, tags: [] },
      { ...input, tags: ["a", "a", "a"] },
      { ...input, id: "forged" },
      { ...input, query: "HELLO" },
      { ...input, principal: "admin" },
    ]) {
      expect(validateSchema(schema.inputSchema, sample).ok).toBe(standardValidation(sample));
    }
    const manifest = projectCapabilityManifest(runtime);
    expect(manifest).toMatchObject({
      tools: [
        {
          title: "Documented search",
          deprecated: true,
          description: "Search only the host-selected synthetic context.",
        },
      ],
    });
    const openapi = projectTypedOpenApi(runtime, { title: "Documented tools", version: "1" });
    await assertOpenApi31(openapi);
    expect(openapi).toMatchObject({
      paths: {
        "/tools/tool-documentedSearch": {
          post: {
            summary: "Documented search",
            deprecated: true,
            "x-network-endpoint": false,
            responses: {
              "200": { description: "The validated host-scoped match and effective count." },
              "422": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ToolInputValidationFailure" },
                  },
                },
              },
            },
          },
        },
      },
    });
    const server = createTypedMcpServer({ runtime, context: { prefix: "trusted" } });
    const client = new Client({ name: "documentation-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listing = (await client.listTools()).tools[0];
      expect(listing).toMatchObject({
        title: "Documented search",
        description: schema.documentation?.description,
        inputSchema: schema.inputSchema,
        outputSchema: schema.outputSchema,
      });
      expect(
        (await client.callTool({ name: "documentedSearch", arguments: input })).isError,
      ).not.toBe(true);
      const calls = handler.mock.calls.length;
      expect(
        (await client.callTool({ name: "documentedSearch", arguments: { ...input, count: 9 } }))
          .isError,
      ).toBe(true);
      expect(handler).toHaveBeenCalledTimes(calls);
    } finally {
      await client.close();
      await server.close();
    }
  }, 20_000);

  it.each([
    ["@format email", "string", /Unsupported @format/],
    ["@multipleOf 0.1", "number", /Unsupported documentation tag/],
    ["@minLength 2", "number", /Invalid minLength/],
    ["@minimum 9\n * @maximum 2", "number", /Contradictory/],
    ["@minItems -1", "string[]", /Invalid minItems/],
    ["@pattern [", "string", /regular expression/],
    ["@example nope", "string", /Expected JSON/],
    ["@example 2", "string", /example violates/],
    ["@default null", "number", /default violates/],
    ["@nullable true", "string", /Unsupported documentation tag/],
    ["@isInt", "string", /numeric type/],
    ["@minLength 1\n * @minLength 2", "string", /Repeated/],
    ["@isInt", "1.5", /literal value violates/],
    ["@minLength 3", '"a"', /literal value violates/],
  ])("rejects unsupported or misleading %s", (annotation, type, error) => {
    expect(() =>
      compile(`export interface Input {\n/** Value.\n * ${annotation}\n */\nvalue: ${type}\n}`),
    ).toThrow(error);
  });

  it("uses Unicode code-point length and preserves nullability without injecting defaults", () => {
    const schema = compile(
      "export interface Input {\n/** Label.\n * @minLength 2\n * @maxLength 2\n * @default null\n */\nvalue?: string | null\n}",
    );
    expect(validateSchema(schema, { value: "😀a" }).ok).toBe(true);
    expect(validateSchema(schema, { value: "😀" }).ok).toBe(false);
    expect(validateSchema(schema, { value: null }).ok).toBe(true);
    expect(validateSchema(schema, {})).toEqual({ ok: true, value: {} });
  });

  it("validates exclusive numeric bounds and rejects malformed annotation schemas", () => {
    const schema = compile(
      "export interface Input {\n/** Ratio.\n * @exclusiveMinimum 0\n * @exclusiveMaximum 1\n */\nvalue: number\n}",
    );
    expect(validateSchema(schema, { value: 0.5 }).ok).toBe(true);
    expect(validateSchema(schema, { value: 0 }).ok).toBe(false);
    expect(validateSchema(schema, { value: 1 }).ok).toBe(false);
    expect(validateSchema({ type: "string", format: "email" }, "ok")).toMatchObject({
      ok: false,
      issues: [{ code: "invalid_schema" }],
    });
    expect(
      validateSchema(
        { type: "string", format: "uuid" },
        "urn:uuid:123e4567-e89b-12d3-a456-426614174000",
      ).ok,
    ).toBe(false);
    expect(
      validateSchema({ type: "string", format: "uuid" }, "123E4567-E89B-12D3-A456-426614174000").ok,
    ).toBe(true);
    expect(
      validateSchema({ type: "array", items: { type: "string" }, examples: "bad" }, []),
    ).toMatchObject({ ok: false, issues: [{ code: "invalid_schema" }] });
  });

  it("standards-aware validation rejects invalid OAS structure and malformed embedded schemas", async () => {
    await expect(
      assertOpenApi31({ openapi: "3.1.0", info: { version: "1" }, paths: {} }),
    ).rejects.toThrow(/Invalid OpenAPI/);
    await expect(
      assertOpenApi31({
        openapi: "3.1.0",
        info: { title: "Invalid schema", version: "1" },
        paths: {},
        components: { schemas: { Invalid: { type: "string", minLength: "two" } } },
      }),
    ).rejects.toThrow();
  });

  it("preserves inherited property annotations and disjoint object intersections", () => {
    const inherited = compile(`interface Base {
      /** Search label.\n * @minLength 2\n */
      value: string;
    }
    /** Inherited request. */
    export interface Input extends Base { active?: boolean }`);
    expect(inherited).toMatchObject({
      description: "Inherited request.",
      properties: { value: { description: "Search label.", minLength: 2 } },
    });
    expect(validateSchema(inherited, { value: "x" }).ok).toBe(false);
    const intersection = compile(`interface Base {
      /** Search label.\n * @minLength 2\n */
      value: string;
    }
    export type Input = Base & { active: boolean };`);
    expect(validateSchema(intersection, { value: "ok", active: true }).ok).toBe(true);
    expect(validateSchema(intersection, { value: "x", active: true }).ok).toBe(false);
  });

  it.each([
    [
      "/** Scalar alias.\n * @minLength 2\n */\ntype Label = string;\nexport interface Input { value: Label[] }",
      /type alias Label/,
    ],
    [
      "/** Object alias.\n * @example {}\n */\nexport type Input = { value?: string }",
      /type alias Input/,
    ],
    [
      "interface Base {\n/** Label.\n * @minLength 2\n */\nvalue: string\n}\nexport interface Input extends Base { value: string }",
      /Overridden annotated property/,
    ],
    [
      "interface Base {\n/** Label.\n * @minLength 2\n */\nvalue: string\n}\nexport type Input = Base & { value: string }",
      /Ambiguous intersection annotations/,
    ],
    [
      "/** Base shape.\n * @example {}\n */\ninterface Base {}\nexport type Input = Base & { value: string }",
      /annotated intersection component/,
    ],
  ])(
    "rejects annotations that TypeScript could erase or merge ambiguously: %s",
    (source, error) => {
      expect(() => compile(source)).toThrow(error);
    },
  );
});
