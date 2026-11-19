import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import type { JsonObject, JsonValue } from "../core/json.js";
import { isJsonObject, stableStringify } from "../core/json.js";
import type { ToolCatalog } from "../typed-projections/index.js";
import type { ToolRuntime } from "../typed-tools/index.js";

/** Native MCP discovery fields, projected without introducing transport authority. */
export interface TypedMcpToolDefinition extends JsonObject {
  /** Runtime registry name accepted by tools/call. */
  readonly name: string;
  /** Optional source summary for client display. */
  readonly title?: string;
  /** Source description or an explicit host override. */
  readonly description: string;
  /** Closed model argument schema, including enforced bounds and examples. */
  readonly inputSchema: JsonObject;
  /** Validated object result schema, preserving object-only union alternatives. */
  readonly outputSchema: JsonObject;
}

/** Produce the same native definitions used for MCP registration and checked-in discovery artifacts. */
export function projectTypedMcpTools(catalog: ToolCatalog): readonly TypedMcpToolDefinition[] {
  return catalog.list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    inputSchema: structuredClone(objectSchema(tool.inputSchema, tool.name, "input")),
    outputSchema: structuredClone(objectSchema(tool.outputSchema, tool.name, "output")),
  }));
}

/** Host runtime and server display identity for a native MCP adapter; authentication remains a transport concern. */
export interface TypedMcpOptions<Context> {
  /** Trusted invocation boundary; supply its fixed host context separately in the context option. */
  readonly runtime: ToolRuntime<Context>;
  /** A trusted host establishes this value for the server session. */
  readonly context: Context;
  /** MCP server display name; defaults to tubular and grants no authority. */
  readonly name?: string;
  /** MCP server display version; defaults to 0.1.0. */
  readonly version?: string;
}

/** Require an object-shaped native MCP contract; adapt object unions without widening their accepted values. */
function objectSchema(schema: JsonValue, toolName: string, direction: string): JsonObject {
  /** Check that every union branch is object-shaped before publishing a native MCP schema. */
  function hasOnlyObjectVariants(value: JsonValue): boolean {
    if (!isJsonObject(value)) return false;
    if (value["type"] === "object") return true;
    const variants = value["anyOf"];
    return (
      value["type"] === undefined &&
      Array.isArray(variants) &&
      variants.length > 0 &&
      variants.every(hasOnlyObjectVariants)
    );
  }
  if (!isJsonObject(schema) || !hasOnlyObjectVariants(schema)) {
    throw new TypeError(`MCP tool ${toolName} requires an object-shaped ${direction} schema`);
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

  for (const tool of projectTypedMcpTools(options.runtime)) {
    const inputSchema = tool.inputSchema;
    const outputSchema = tool.outputSchema;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        inputSchema: fromJsonSchema<JsonObject>(inputSchema),
        outputSchema: fromJsonSchema<JsonObject>(outputSchema),
      },
      async (input) => {
        const result = await options.runtime.invoke(tool.name, input, options.context);
        if (result.status !== "success") {
          const reference =
            result.status === "ask" && result.proposalId !== undefined
              ? ` ${stableStringify({ proposalId: result.proposalId, proposalDigest: result.proposalDigest ?? null })}`
              : "";
          return {
            content: [
              { type: "text" as const, text: `Tool call failed: ${result.status}${reference}` },
            ],
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
