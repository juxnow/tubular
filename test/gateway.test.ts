import { describe, expect, it } from "vitest";
import { ProposalOnlyGateway } from "../src/mcp/gateway.js";
import { createFixture } from "./support.js";

describe("proposal-only gateway", () => {
  it("has no approval or execution method and enforces its call budget", () => {
    const fixture = createFixture({ maxUses: 4 });
    const gateway = new ProposalOnlyGateway(
      fixture.kernel,
      fixture.clock,
      {
        principalId: "agent.test",
        leaseId: fixture.lease.id,
        contextManifestId: fixture.manifest.id,
      },
      { maxCallsPerWindow: 1, windowMs: 1_000 },
    );
    expect(Object.getOwnPropertyNames(ProposalOnlyGateway.prototype).sort()).toEqual([
      "constructor",
      "propose",
      "status",
    ]);
    expect(
      gateway.propose("workspace.note.append", {
        resource: "workspace://allowed/note.md",
        text: "gateway secret",
      }),
    ).toMatchObject({ ok: true, status: { state: "pending-approval" } });
    expect(gateway.status("proposal_000000000000000000000000")).toEqual({
      protocol: "totally-tubular.mcp-result/v1",
      ok: false,
      error: { code: "RATE_LIMITED", retryable: true },
    });
    fixture.clock.advance(1_001);
    expect(gateway.status("proposal_000000000000000000000000")).toMatchObject({
      ok: false,
      error: { code: "PROPOSAL_NOT_FOUND", retryable: false },
    });
  });
});
