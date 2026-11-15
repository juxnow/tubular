import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultPerspective } from "../src/catalog.js";
import { projectMcpTools } from "../src/contracts/projections.js";
import { isJsonObject } from "../src/core/json.js";

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
});

describe("proposal-only MCP server", () => {
  it("exposes proposal and safe-status tools without an authority backdoor", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/mcp/stdio-server.ts"],
      cwd: process.cwd(),
      stderr: "pipe",
      maxBufferSize: 1_048_576,
    });
    const client = new Client(
      { name: "totally-tubular-test", version: "0.1.0" },
      {
        versionNegotiation: {
          mode: "auto",
          probe: { timeoutMs: 2_000, maxRetries: 0 },
        },
      },
    );
    clients.push(client);
    await client.connect(transport);

    const listed = await client.listTools();
    const projectedTools = projectMcpTools(createDefaultPerspective())["tools"];
    if (!Array.isArray(projectedTools)) {
      throw new Error("Expected projected MCP tools");
    }
    const projectedNames = projectedTools.map((tool) => {
      if (!isJsonObject(tool) || typeof tool["name"] !== "string") {
        throw new Error("Expected a projected MCP tool name");
      }
      return tool["name"];
    });
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(projectedNames.sort());
    for (const projected of projectedTools) {
      if (!isJsonObject(projected) || typeof projected["name"] !== "string") {
        throw new Error("Expected a projected MCP descriptor");
      }
      const live = listed.tools.find((tool) => tool.name === projected["name"]);
      expect(live).toBeDefined();
      expect(live?.title).toBe(projected["title"]);
      expect(live?.description).toBe(projected["description"]);
      expect(live?.inputSchema).toEqual(projected["inputSchema"]);
      expect(live?.annotations).toEqual(projected["annotations"]);
    }
    const listing = JSON.stringify(listed);
    for (const forbidden of [
      "tt.approve",
      "tt.execute",
      "tt.lease",
      "tt.manifest",
      "exportState",
    ]) {
      expect(listing).not.toContain(forbidden);
    }

    const proposal = await client.callTool({
      name: "tt.propose.workspace.note.append",
      arguments: {
        resource: "workspace://demo/notes.md",
        text: "mcp-input-secret-sentinel",
      },
    });
    expect(proposal.isError).not.toBe(true);
    const serializedProposal = JSON.stringify(proposal);
    for (const hidden of [
      "mcp-input-secret-sentinel",
      "workspace://demo/notes.md",
      "agent.mcp-demo",
      "launcher.local",
      "context_",
      "lease_",
    ]) {
      expect(serializedProposal).not.toContain(hidden);
    }
    const structured = isJsonObject(proposal.structuredContent)
      ? proposal.structuredContent["status"]
      : undefined;
    const proposalId = isJsonObject(structured) ? structured["proposalId"] : undefined;
    expect(proposalId).toMatch(/^proposal_[A-Za-z0-9_-]{1,64}_[1-9][0-9]*$/);
    if (typeof proposalId !== "string") {
      throw new Error("Proposal id missing from structured MCP result");
    }

    const status = await client.callTool({
      name: "tt.proposal.status",
      arguments: { proposalId },
    });
    expect(status).toMatchObject({ isError: false });
    expect(status.structuredContent).toMatchObject({
      ok: true,
      status: { proposalId, state: "pending-approval" },
    });
    expect(JSON.stringify(status)).not.toContain("workspace://demo/notes.md");

    const invalid = await client.callTool({
      name: "tt.propose.workspace.note.append",
      arguments: {
        resource: "workspace://demo/notes.md",
        text: "valid",
        surprise: "must be rejected",
      },
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain("must be rejected");
    await expect(
      client.callTool({
        name: "tt.approve",
        arguments: { proposalId },
      }),
    ).rejects.toThrow();
  }, 15_000);
});
