import { resolve } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createTypedMcpServer } from "../src/typed-mcp/index.js";
import { createToolRuntime, defineTool } from "../src/typed-tools/index.js";
import { compileToolSchemas } from "../src/typegen/index.js";

/** Model-facing greeting arguments compiled into native MCP input schema. */
interface Input {
  /** Greeting target supplied by the model; authority is carried separately in host context. */
  readonly text: string;
}
/** Validated greeting response used to test native MCP output and structured-content behavior. */
interface Output {
  /** Display greeting released only after output validation succeeds. */
  readonly greeting: string;
}
/** Trusted fixture identity and policy decision resolved outside model input. */
interface HostContext {
  /** Host-selected fixture identity that extra model input fields cannot replace. */
  readonly principal: string;
  /** Trusted fixture decision returned by the host authorization callback; ASK never dispatches. */
  readonly decision: "ALLOW" | "ASK" | "DENY";
}

/** Produce a greeting from validated arguments and independently supplied host context. */
export function generatedGreet(input: Input, context: HostContext): Output {
  return { greeting: `${input.text}, ${context.principal}` };
}

const inputSchema = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
} as const;
const outputSchema = {
  type: "object",
  properties: { greeting: { type: "string" } },
  required: ["greeting"],
  additionalProperties: false,
} as const;

describe("typed MCP adapter", () => {
  it("preserves object-only output unions in MCP discovery and validation", async () => {
    const variant = (kind: string, field: string) => ({
      type: "object",
      properties: { kind: { const: kind }, [field]: { type: "string" } },
      required: ["kind", field],
      additionalProperties: false,
    });
    const output = { anyOf: [variant("found", "value"), variant("missing", "reason")] };
    const runtime = createToolRuntime({
      definitions: [
        defineTool({
          name: "lookup",
          description: "Look up a value",
          effect: "read",
          handler: (_input: Input, _context: HostContext) => ({ kind: "found", value: "yes" }),
        }),
      ],
      schemas: { lookup: { inputSchema, outputSchema: output } },
      authorize: () => "ALLOW",
    });
    const server = createTypedMcpServer({
      runtime,
      context: { principal: "host", decision: "ALLOW" },
    });
    const client = new Client({ name: "union-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools[0]?.outputSchema).toEqual({
        type: "object",
        ...output,
      });
      const response = await client.callTool({ name: "lookup", arguments: { text: "x" } });
      expect(response.structuredContent).toEqual({ kind: "found", value: "yes" });
      expect(response.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("runs a generated TypeScript contract through the MCP client and server", async () => {
    const schemas = compileToolSchemas({
      tsconfigPath: resolve("tsconfig.json"),
      entryFile: resolve("test/typed-mcp.test.ts"),
      functionNames: ["generatedGreet"],
    });
    const runtime = createToolRuntime<HostContext>({
      definitions: [
        defineTool<Input, Output, HostContext>({
          name: "generatedGreet",
          description: "Greet from a generated contract",
          effect: "read",
          handler: generatedGreet,
        }),
      ],
      schemas,
      authorize: ({ context }) => context.decision,
    });
    const server = createTypedMcpServer({
      runtime,
      context: { principal: "trusted", decision: "ALLOW" },
    });
    const client = new Client({ name: "typed-mcp-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listing = await client.listTools();
      expect(listing.tools[0]).toMatchObject({
        inputSchema: schemas["generatedGreet"]?.inputSchema,
        outputSchema: schemas["generatedGreet"]?.outputSchema,
      });
      const response = await client.callTool({
        name: "generatedGreet",
        arguments: { text: "hello" },
      });
      expect(response.structuredContent).toEqual({ greeting: "hello, trusted" });
    } finally {
      await client.close();
      await server.close();
    }
  }, 15_000);

  it("advertises the real schemas and runs calls with host authority", async () => {
    let called = 0;
    const principals: string[] = [];
    const runtime = createToolRuntime<HostContext>({
      definitions: [
        defineTool<Input, Output, HostContext>({
          name: "greet",
          description: "Greet someone",
          effect: "read",
          /** Trusted host implementation called only after runtime input validation and authorization. */
          handler(input, context) {
            called += 1;
            principals.push(context.principal);
            return { greeting: `${input.text}, ${context.principal}` };
          },
        }),
      ],
      schemas: { greet: { inputSchema, outputSchema } },
      authorize: ({ context }) => context.decision,
    });
    const host: HostContext = { principal: "trusted-host", decision: "ALLOW" };
    const server = createTypedMcpServer({ runtime, context: host });
    const client = new Client({ name: "typed-mcp-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listing = await client.listTools();
      expect(listing.tools).toHaveLength(1);
      expect(listing.tools[0]).toMatchObject({ name: "greet", inputSchema, outputSchema });
      const response = await client.callTool({ name: "greet", arguments: { text: "hello" } });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toEqual({ greeting: "hello, trusted-host" });
      expect(called).toBe(1);
      expect(principals).toEqual(["trusted-host"]);
      const forgedContext = await client.callTool({
        name: "greet",
        arguments: { text: "hello", principal: "attacker" },
      });
      expect(forgedContext.isError).toBe(true);
      expect(called).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each(["ASK", "DENY"] as const)("does not execute a %s decision", async (decision) => {
    let called = 0;
    const runtime = createToolRuntime<HostContext>({
      definitions: [
        defineTool<Input, Output, HostContext>({
          name: "greet",
          description: "Greet someone",
          effect: "read",
          /** Trusted host implementation called only after runtime input validation and authorization. */
          handler() {
            called += 1;
            return { greeting: "hello" };
          },
        }),
      ],
      schemas: { greet: { inputSchema, outputSchema } },
      authorize: ({ context }) => context.decision,
    });
    const server = createTypedMcpServer({ runtime, context: { principal: "trusted", decision } });
    const client = new Client({ name: "typed-mcp-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const response = await client.callTool({ name: "greet", arguments: { text: "hi" } });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).toContain(decision.toLowerCase());
      expect(called).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns an error instead of publishing an invalid handler result", async () => {
    const runtime = createToolRuntime<HostContext>({
      definitions: [
        defineTool<Input, unknown, HostContext>({
          name: "greet",
          description: "Greet someone",
          effect: "read",
          /** Trusted host implementation called only after runtime input validation and authorization. */
          handler() {
            return { greeting: 123, secret: "do-not-leak" };
          },
        }),
      ],
      schemas: { greet: { inputSchema, outputSchema } },
      authorize: () => "ALLOW",
    });
    const server = createTypedMcpServer({
      runtime,
      context: { principal: "trusted", decision: "ALLOW" },
    });
    const client = new Client({ name: "typed-mcp-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const response = await client.callTool({ name: "greet", arguments: { text: "hi" } });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).toContain("invalid_output");
      expect(JSON.stringify(response)).not.toContain("do-not-leak");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects non-object MCP tool schema roots", () => {
    const runtime = createToolRuntime<HostContext>({
      definitions: [
        defineTool<string, Output, HostContext>({
          name: "greet",
          description: "Greet someone",
          effect: "read",
          /** Trusted host implementation called only after runtime input validation and authorization. */
          handler() {
            return { greeting: "hello" };
          },
        }),
      ],
      schemas: { greet: { inputSchema: { type: "string" }, outputSchema } },
      authorize: () => "DENY",
    });
    expect(() =>
      createTypedMcpServer({ runtime, context: { principal: "trusted", decision: "DENY" } }),
    ).toThrow("object-shaped input schema");
  });
});
