import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import type { JsonObject } from "../core/json.js";
import { stableStringify } from "../core/json.js";
import { createMcpToolBindings } from "../contracts/projections.js";
import type { PortAuthorityDefinition } from "../port-authority/definition.js";
import type { GatewayResult, ProposalOnlyGateway } from "./gateway.js";

function toolResult(result: GatewayResult) {
  return {
    content: [{ type: "text" as const, text: stableStringify(result) }],
    structuredContent: result,
    isError: !result.ok,
  };
}

export function buildMcpServer(
  portAuthority: PortAuthorityDefinition,
  gateway: ProposalOnlyGateway,
): McpServer {
  const server = new McpServer(
    { name: "totally-tubular", version: "0.1.0" },
    {
      instructions:
        "This is a proposal-only authority boundary. Tools may create bounded action proposals or inspect safe status. They cannot approve or execute effects.",
    },
  );

  for (const binding of createMcpToolBindings(portAuthority)) {
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
          inputSchema: fromJsonSchema<{ proposalId: string }>(
            descriptor.inputSchema,
          ),
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
