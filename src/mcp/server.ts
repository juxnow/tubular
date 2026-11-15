import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { createMcpToolBindings } from "../contracts/projections.js";
import type { JsonObject } from "../core/json.js";
import { stableStringify } from "../core/json.js";
import type { PerspectiveDefinition } from "../perspective/definition.js";
import type { GatewayResult, ProposalOnlyGateway } from "./gateway.js";

/** Serialize a sanitized gateway result as MCP text and structured content, marking rejections as errors. */
function toolResult(result: GatewayResult) {
  return {
    content: [{ type: "text" as const, text: stableStringify(result) }],
    structuredContent: result,
    isError: !result.ok,
  };
}

/** Register native proposal and status MCP tools; the gateway supplies fixed identity and never exposes approval or dispatch. */
export function buildMcpServer(
  perspective: PerspectiveDefinition,
  gateway: ProposalOnlyGateway,
): McpServer {
  const server = new McpServer(
    { name: "totally-tubular", version: "0.1.0" },
    {
      instructions:
        "This is a proposal-only authority boundary. Tools may create bounded action proposals or inspect safe status. They cannot approve or execute effects.",
    },
  );

  for (const binding of createMcpToolBindings(perspective)) {
    const descriptor = binding.descriptor;
    const options = {
      title: descriptor.title,
      description: descriptor.description,
      inputSchema: fromJsonSchema<JsonObject>(descriptor.inputSchema),
      annotations: descriptor.annotations,
    };
    if (binding.canonicalCapabilityId === null) {
      server.registerTool(
        descriptor.name,
        {
          ...options,
          inputSchema: fromJsonSchema<{
            /** Identity of one submitted proposal, distinct even from an identical independent submission. */
            proposalId: string;
          }>(descriptor.inputSchema),
        },
        async ({ proposalId }) => toolResult(gateway.status(proposalId)),
      );
      continue;
    }
    const capabilityId = binding.canonicalCapabilityId;
    server.registerTool(
      descriptor.name,
      {
        ...options,
      },
      async (input) => toolResult(gateway.propose(capabilityId, input)),
    );
  }

  return server;
}
