import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { isJsonObject, stableStringify } from "../core/json.js";
import type { JsonObject, JsonValue } from "../core/json.js";
import type { ToolRuntime } from "../typed-tools/index.js";

export interface TypedMcpOptions<Context> {
  readonly runtime: ToolRuntime<Context>;
  /** A trusted host establishes this value for the server session. */
  readonly context: Context;
  readonly name?: string;
  readonly version?: string;
}

function objectSchema(schema: JsonValue, toolName: string, direction: string): JsonObject {
  function hasOnlyObjectVariants(value: JsonValue): boolean {
    if (!isJsonObject(value)) return false;
    if (value["type"] === "object") return true;
    const variants = value["anyOf"];
    return value["type"] === undefined && Array.isArray(variants) && variants.length > 0 && variants.every(hasOnlyObjectVariants);
  }
  if (!isJsonObject(schema) || !hasOnlyObjectVariants(schema)) {
    throw new TypeError(
      `MCP tool ${toolName} requires an object-shaped ${direction} schema`,
    );
  }
  // Adding the implied object type preserves every union alternative while
  // satisfying MCP's object-root requirement for structured output.
  return schema["type"] === "object" ? schema : { ...schema, type: "object" };
}

/**
 * Binds an already-authorized-by-host runtime to one MCP server session.
 * The MCP client never supplies or selects the host's context.
 */
export function createTypedMcpServer<Context>(options: TypedMcpOptions<Context>): McpServer {
  const server = new McpServer({
    name: options.name ?? "tubular",
    version: options.version ?? "0.1.0",
  });

  for (const tool of options.runtime.list()) {
    const inputSchema = objectSchema(tool.inputSchema, tool.name, "input");
    const outputSchema = objectSchema(tool.outputSchema, tool.name, "output");
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<JsonObject>(inputSchema),
        outputSchema: fromJsonSchema<JsonObject>(outputSchema),
      },
      async (input) => {
        const result = await options.runtime.invoke(tool.name, input, options.context);
        if (result.status !== "success") {
          const reference = result.status === "ask" && result.proposalId !== undefined
            ? ` ${stableStringify({ proposalId: result.proposalId, proposalDigest: result.proposalDigest ?? null })}`
            : "";
          return {
            content: [{ type: "text" as const, text: `Tool call failed: ${result.status}${reference}` }],
            isError: true,
          };
        }
        if (!isJsonObject(result.output)) {
          return {
            content: [{ type: "text" as const, text: "Tool call failed: invalid_output" }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: stableStringify(result.output) }],
          structuredContent: result.output,
          isError: false,
        };
      },
    );
  }

  return server;
}
