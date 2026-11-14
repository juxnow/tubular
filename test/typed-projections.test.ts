import { describe, expect, it } from "vitest";
import { isJsonObject } from "../src/core/json.js";
import { projectCapabilityManifest, projectTypedOpenApi } from "../src/typed-projections/index.js";
import type { ToolDescriptor } from "../src/typed-tools/index.js";

const inputSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({ query: Object.freeze({ type: "string" }) }),
  required: Object.freeze(["query"]),
  additionalProperties: false,
});
const outputSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({ count: Object.freeze({ type: "number" }) }),
  required: Object.freeze(["count"]),
  additionalProperties: false,
});
const descriptors: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: "../x/y?z",
    description: "Find matching items",
    effect: "read",
    inputSchema,
    outputSchema,
  }),
  Object.freeze({
    name: "..",
    description: "Describe items",
    effect: "read",
    inputSchema,
    outputSchema,
  }),
]);
const catalog = { list: () => descriptors };

describe("typed contract projections", () => {
  it("creates a provider-neutral manifest without altering or sharing runtime schemas", () => {
    const manifest = projectCapabilityManifest(catalog, { name: "demo", version: "2" });
    expect(manifest).toMatchObject({ formatVersion: "0.1.0", name: "demo", version: "2" });
    expect(manifest["tools"]).toEqual([
      { name: "..", description: "Describe items", effect: "read", inputSchema, outputSchema },
      {
        name: "../x/y?z",
        description: "Find matching items",
        effect: "read",
        inputSchema,
        outputSchema,
      },
    ]);
    const tools = manifest["tools"];
    if (!Array.isArray(tools)) throw new Error("Expected tools");
    const tool = tools[0];
    if (!isJsonObject(tool) || !isJsonObject(tool["inputSchema"]))
      throw new Error("Expected schema");
    expect(tool["inputSchema"]).not.toBe(inputSchema);
    Object.assign(tool["inputSchema"], { type: "changed" });
    expect(inputSchema.type).toBe("object");
    expect(projectCapabilityManifest(catalog)["tools"]).toEqual([
      { name: "..", description: "Describe items", effect: "read", inputSchema, outputSchema },
      {
        name: "../x/y?z",
        description: "Find matching items",
        effect: "read",
        inputSchema,
        outputSchema,
      },
    ]);
  });

  it("uses reusable schema references and safely encoded operation paths", () => {
    const document = projectTypedOpenApi(catalog, { title: "My Tools", version: "1.2.3" });
    expect(document).toMatchObject({
      openapi: "3.1.0",
      "x-documentation-projection": true,
      "x-network-endpoint": false,
      info: { title: "My Tools", version: "1.2.3" },
      paths: {
        "/tools/tool-..": {
          post: {
            "x-documentation-projection": true,
            "x-network-endpoint": false,
            operationId: "..",
            description: "Describe items",
            "x-tubular-effect": "read",
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Tool0Input" } },
              },
            },
            responses: {
              "200": {
                description: "Successful result",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/Tool0Output" } },
                },
              },
            },
          },
        },
        "/tools/tool-..%2Fx%2Fy%3Fz": {
          post: {
            "x-documentation-projection": true,
            "x-network-endpoint": false,
            operationId: "../x/y?z",
            description: "Find matching items",
            "x-tubular-effect": "read",
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Tool1Input" } },
              },
            },
            responses: {
              "200": {
                description: "Successful result",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/Tool1Output" } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Tool0Input: inputSchema,
          Tool0Output: outputSchema,
          Tool1Input: inputSchema,
          Tool1Output: outputSchema,
        },
      },
    });
    expect(new URL("/tools/tool-..", "https://example.com").pathname).toBe("/tools/tool-..");
    expect(descriptors[0]?.inputSchema).toBe(inputSchema);
  });

  it("rejects duplicate names and invalid Unicode", () => {
    const descriptor = descriptors[0];
    if (descriptor === undefined) throw new Error("Expected descriptor");
    expect(() => projectCapabilityManifest({ list: () => [descriptor, descriptor] })).toThrow(
      "Duplicate",
    );
    expect(() =>
      projectTypedOpenApi(
        { list: () => [{ ...descriptor, name: "\ud800" }] },
        { title: "API", version: "1" },
      ),
    ).toThrow("valid Unicode");
  });
});
