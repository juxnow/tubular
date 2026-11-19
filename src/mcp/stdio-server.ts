import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { issueAuthorityLease } from "../authority/types.js";
import { createDefaultRegistry } from "../catalog.js";
import { buildContextManifest } from "../context/manifest.js";
import { SystemClock } from "../core/time.js";
import { perspectiveFromRegistry } from "../profiles/totally-tubular.js";
import {
  ContextRegistrationAuthority,
  LeaseIssuerAuthority,
  TotallyTubularKernel,
} from "../runtime/kernel.js";
import { ProposalOnlyGateway } from "./gateway.js";
import { buildMcpServer } from "./server.js";

/** Launch the local demonstration MCP stdio server with an explicit trusted host binding. */
function start(): void {
  const clock = new SystemClock();
  const registry = createDefaultRegistry();
  const principalId = "agent.mcp-demo";
  const issuer = new LeaseIssuerAuthority("launcher.local");
  const registrar = new ContextRegistrationAuthority("launcher.local");
  const manifest = buildContextManifest(
    [
      {
        id: "context.mcp-demo",
        label: "MCP proposal-only demo context",
        mediaType: "text/plain",
        content:
          "This public demo context authorizes proposal construction, not approval or execution.",
        classification: "public",
        disclosure: "shareable",
        provenance: {
          kind: "generated",
          locator: "builtin://mcp-demo",
          observedAt: clock.now().toISOString(),
        },
      },
    ],
    {
      purpose: "Demonstrate a proposal-only MCP boundary",
      principalId,
      selectedSourceIds: ["context.mcp-demo"],
      classificationCeiling: "public",
    },
    clock,
  );
  const lease = issueAuthorityLease(
    {
      subjectId: principalId,
      issuedBy: issuer.issuerId,
      expiresAt: new Date(clock.now().getTime() + 60 * 60 * 1_000).toISOString(),
      grants: [
        {
          toolName: "workspace.note.append",
          resourcePatterns: ["workspace://demo/**"],
        },
      ],
      effectCeiling: "workspace-write",
      contextManifestDigests: [manifest.digest],
      maxUses: 16,
    },
    clock,
  );
  const kernel = new TotallyTubularKernel(registry, clock, {
    leaseIssuerAuthorities: [issuer],
    contextRegistrationAuthorities: [registrar],
    maxPendingProposalsPerPrincipal: 64,
  });
  kernel.registerManifest(manifest, registrar);
  kernel.registerLease(lease, issuer);
  const gateway = new ProposalOnlyGateway(
    kernel,
    clock,
    {
      principalId,
      leaseId: lease.id,
      contextManifestId: manifest.id,
    },
    { maxCallsPerWindow: 60, windowMs: 60_000 },
  );
  const perspective = perspectiveFromRegistry(registry);
  const handle = serveStdio(() => buildMcpServer(perspective, gateway), {
    legacy: "serve",
    transport: new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: 1_048_576,
    }),
    onerror: () => {
      console.error("Totally Tubular MCP transport error");
    },
  });

  const close = (): void => {
    void handle.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

try {
  start();
} catch {
  console.error("Totally Tubular MCP startup failed");
  process.exitCode = 1;
}
