import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { issueAuthorityLease } from "../src/authority/types.js";
import { buildContextManifest } from "../src/context/manifest.js";
import { deepFreezeJsonObject } from "../src/core/json.js";
import {
  createGovernedToolRuntime,
  type GovernedToolContext,
} from "../src/governed-tools/index.js";
import {
  ContextRegistrationAuthority,
  HumanApprovalAuthority,
  LeaseIssuerAuthority,
  type ProposalAccepted,
} from "../src/runtime/kernel.js";
import { createTypedMcpServer } from "../src/typed-mcp/index.js";
import { projectCapabilityManifest, projectTypedOpenApi } from "../src/typed-projections/index.js";
import { bindTool } from "../src/typed-tools/index.js";
import { TestClock } from "./support.js";

/** Model arguments for governed execution tests, excluding all host authority fields. */
interface Input {
  /** Canonical logical workspace URI selected for the operation; it does not grant filesystem access. */
  resource: string;
  /** Fixture append payload whose effects and repeated dispatches are counted by assertions. */
  text: string;
}
const schemas = {
  inputSchema: {
    type: "object",
    properties: { resource: { type: "string" }, text: { type: "string" } },
    required: ["resource", "text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
};
const input: Input = { resource: "workspace://notes/one", text: "Hello" };

/** Construct isolated governed host authority, context, lease, and handler spies for each boundary scenario. */
function fixture(
  options: {
    /** Optional test override; omitted scenarios require exact human approval. */
    approval?: "none" | "exact-human";
    /** Optional injected handler failure: return invalid output or throw after dispatch. */
    output?: "invalid" | "throw";
    /** Host-assigned disclosure restriction; local-only context cannot accompany a governed agent action. */
    disclosure?: "local-only";
    /** Optional read-only lease ceiling used to prove that workspace writes are denied. */
    ceiling?: "read";
    /** Optional lease subject override used to test mismatched host identity. */
    principal?: string;
    /** Positive safe-integer dispatch budget. A dispatched attempt consumes a use even if its outcome becomes unknown. */
    maxUses?: number;
  } = {},
) {
  const clock = new TestClock("2026-11-14T12:00:00Z");
  const issuer = new LeaseIssuerAuthority("host");
  const registrar = new ContextRegistrationAuthority("host");
  const approver = new HumanApprovalAuthority("human");
  const handler = vi.fn(async (value: Input, context: GovernedToolContext) => {
    expect(context.manifest.digest).toBe(manifest.digest);
    expect(context.proposal.principalId).toBe(options.principal ?? "agent");
    if (options.output === "throw") throw new Error("secret failure detail");
    if (options.output === "invalid") return { text: 42 };
    value.text += "!";
    return { text: value.text };
  });
  const definition = bindTool(handler, schemas, {
    entry: "tools.ts",
    exportName: "append",
    sourceDigest: "a".repeat(64),
  })({
    name: "append",
    description: "Append a note",
    effect: "workspace-write",
    resource: (value) => value.resource,
    ...(options.approval === undefined ? {} : { approval: options.approval }),
  });
  const runtime = createGovernedToolRuntime({
    definitions: [definition],
    clock,
    kernelOptions: {
      approvalAuthorities: [approver],
      leaseIssuerAuthorities: [issuer],
      contextRegistrationAuthorities: [registrar],
    },
  });
  const manifest = buildContextManifest(
    [
      {
        id: "selected",
        label: "Selected",
        content: "Context is not authority",
        mediaType: "text/plain",
        classification: "internal",
        disclosure: options.disclosure ?? "explicit-grant",
        provenance: {
          kind: "manual",
          locator: "test://selected",
          observedAt: clock.now().toISOString(),
        },
      },
    ],
    {
      principalId: options.principal ?? "agent",
      purpose: "Append a note",
      selectedSourceIds: ["selected"],
      classificationCeiling: "internal",
    },
    clock,
  );
  const lease = issueAuthorityLease(
    {
      subjectId: manifest.principalId,
      issuedBy: issuer.issuerId,
      expiresAt: "2026-11-14T13:00:00Z",
      grants: [{ toolName: "append", resourcePatterns: ["workspace://notes/**"] }],
      effectCeiling: options.ceiling ?? "workspace-write",
      contextManifestDigests: [manifest.digest],
      maxUses: options.maxUses ?? 1,
    },
    clock,
  );
  const sessionOptions = { manifest, lease, leaseIssuer: issuer, contextRegistrar: registrar };
  const session = runtime.openSession(sessionOptions);
  return { runtime, handler, clock, approver, issuer, manifest, lease, session, sessionOptions };
}

/** Create and assert acceptance of a fixture proposal without executing it. */
function proposal(f: ReturnType<typeof fixture>, value: Input = input): ProposalAccepted {
  const result = f.runtime.propose("append", value, f.session);
  if (!result.ok) throw new Error(result.failure.code);
  return result;
}

/** Submit the exact fixture challenge binding through the configured trusted approver. */
function approve(f: ReturnType<typeof fixture>, p: ProposalAccepted) {
  if (p.challenge === null) throw new Error("Expected approval challenge");
  return f.runtime.kernel.approve({
    authority: f.approver,
    challengeId: p.challenge.id,
    proposalId: p.proposal.id,
    proposalDigest: p.proposal.digest,
    proposalRevision: p.proposal.revision,
  });
}

describe("generated capabilities through the governed kernel", () => {
  it("dispatches independent identical fixed-clock invocations instead of treating them as replays", async () => {
    const f = fixture({ approval: "none", maxUses: 2 });
    const results = await Promise.all([
      f.runtime.invoke("append", input, f.session),
      f.runtime.invoke("append", input, f.session),
    ]);
    expect(results).toMatchObject([
      { status: "success", replayed: false },
      { status: "success", replayed: false },
    ]);
    const [first, second] = results;
    if (
      first?.status !== "success" ||
      second?.status !== "success" ||
      first.receipt === undefined ||
      second.receipt === undefined
    )
      throw new Error("Expected receipts");
    expect(first.receipt.proposalId).not.toBe(second.receipt.proposalId);
    expect(await f.runtime.execute(first.receipt.proposalId, f.session)).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(f.handler).toHaveBeenCalledTimes(2);
  });
  it("requires exact approval, executes once under concurrency, and returns an audited receipt", async () => {
    const f = fixture();
    const p = proposal(f);
    expect(await f.runtime.execute(p.proposal.id, f.session)).toMatchObject({
      ok: false,
      failure: { code: "APPROVAL_REQUIRED" },
    });
    expect(f.handler).not.toHaveBeenCalled();
    expect(approve(f, p)).toMatchObject({ ok: true });
    const results = await Promise.all([
      f.runtime.execute(p.proposal.id, f.session),
      f.runtime.execute(p.proposal.id, f.session),
    ]);
    expect(results[0]).toMatchObject({
      ok: true,
      replayed: false,
      receipt: { result: { text: "Hello!" }, proposalDigest: p.proposal.digest },
    });
    expect(results[1]).toMatchObject({ ok: true, replayed: true });
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(p.proposal.input["text"]).toBe("Hello");
    expect(f.runtime.kernel.audit.verify().valid).toBe(true);
    expect(f.runtime.kernel.audit.entries().map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "policy.evaluated",
        "approval.granted",
        "action.effect.completed",
        "execution.receipt.issued",
      ]),
    );
    expect(f.runtime.propose("append", { ...input, text: "next" }, f.session)).toMatchObject({
      ok: false,
      failure: { details: { policyReasonCode: "LEASE_EXHAUSTED" } },
    });
  });

  it("rejects copied sessions and isolates proposals between sessions even for the same principal", async () => {
    const f = fixture();
    const p = proposal(f);
    expect(f.runtime.propose("append", input, { ...f.session })).toMatchObject({
      ok: false,
      failure: { code: "PRINCIPAL_MISMATCH" },
    });
    const other = f.runtime.openSession(f.sessionOptions);
    expect(await f.runtime.execute(p.proposal.id, other)).toMatchObject({
      ok: false,
      failure: { code: "PROPOSAL_NOT_FOUND" },
    });
    expect(() =>
      f.runtime.openSession({ ...f.sessionOptions, leaseIssuer: new LeaseIssuerAuthority("host") }),
    ).toThrow(/authority/);
    expect(f.handler).not.toHaveBeenCalled();
  });

  it("does not accept identity, approval or lease fields in model arguments", () => {
    const f = fixture();
    expect(
      f.runtime.propose(
        "append",
        { ...input, principalId: "human", leaseId: f.lease.id, approval: "ALLOW" },
        f.session,
      ),
    ).toMatchObject({ ok: false, failure: { code: "INPUT_INVALID" } });
    expect(f.handler).not.toHaveBeenCalled();
  });

  it.each(["revoked", "expired", "approval-revoked", "approval-expired"] as const)(
    "rechecks %s authority at execution",
    async (change) => {
      const f = fixture();
      const p = proposal(f);
      approve(f, p);
      if (change === "revoked") f.runtime.kernel.revokeLease(f.lease.id, f.issuer);
      if (change === "expired") f.clock.advance(3_600_001);
      if (change === "approval-revoked") f.runtime.kernel.revokeApproval(p.proposal.id, f.approver);
      if (change === "approval-expired") f.clock.advance(900_001);
      expect(await f.runtime.execute(p.proposal.id, f.session)).toMatchObject({ ok: false });
      expect(f.handler).not.toHaveBeenCalled();
    },
  );

  it("requires new approval for edited input and rejects a mismatched digest", async () => {
    const f = fixture();
    const first = proposal(f);
    approve(f, first);
    const edited = proposal(f, { ...input, text: "Changed" });
    expect(await f.runtime.execute(edited.proposal.id, f.session)).toMatchObject({
      ok: false,
      failure: { code: "APPROVAL_REQUIRED" },
    });
    if (edited.challenge === null) throw new Error("Expected challenge");
    expect(
      f.runtime.kernel.approve({
        authority: f.approver,
        challengeId: edited.challenge.id,
        proposalId: edited.proposal.id,
        proposalDigest: first.proposal.digest,
        proposalRevision: 1,
      }),
    ).toMatchObject({ ok: false, failure: { code: "APPROVAL_MISMATCH" } });
  });

  it("enforces resource scope, effect ceilings, and context disclosure", () => {
    const f = fixture();
    expect(
      f.runtime.propose("append", { ...input, resource: "workspace://other/one" }, f.session),
    ).toMatchObject({
      ok: false,
      failure: { details: { policyReasonCode: "RESOURCE_NOT_GRANTED" } },
    });
    expect(
      f.runtime.propose("append", { ...input, resource: "https://example.com" }, f.session),
    ).toMatchObject({ ok: false, failure: { code: "INPUT_INVALID" } });
    const low = fixture({ ceiling: "read" });
    expect(low.runtime.propose("append", input, low.session)).toMatchObject({
      ok: false,
      failure: { details: { policyReasonCode: "EFFECT_EXCEEDS_LEASE" } },
    });
    const local = fixture({ disclosure: "local-only" });
    expect(local.runtime.propose("append", input, local.session)).toMatchObject({
      ok: false,
      failure: { details: { policyReasonCode: "DISCLOSURE_NOT_ALLOWED" } },
    });
    const other = fixture({ principal: "other" });
    expect(() => f.runtime.openSession({ ...f.sessionOptions, manifest: other.manifest })).toThrow(
      /bound by the lease/,
    );
  });

  it.each(["invalid", "throw"] as const)(
    "blocks redispatch after %s output or execution",
    async (output) => {
      const f = fixture({ output });
      const p = proposal(f);
      approve(f, p);
      const first = await f.runtime.execute(p.proposal.id, f.session);
      expect(first).toMatchObject({
        ok: false,
        failure: { code: output === "invalid" ? "OUTPUT_INVALID" : "EXECUTION_OUTCOME_UNKNOWN" },
      });
      expect(await f.runtime.execute(p.proposal.id, f.session)).toEqual(first);
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(first)).not.toContain("secret failure detail");
    },
  );

  it("executes an explicitly approval-free capability through policy and audit", async () => {
    const f = fixture({ approval: "none" });
    expect(await f.runtime.invoke("append", input, f.session)).toMatchObject({
      status: "success",
      receipt: { approvalId: null },
    });
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(
      f.runtime.kernel.audit.entries().some((event) => event.type === "action.effect.completed"),
    ).toBe(true);
    expect(projectCapabilityManifest(f.runtime)).toMatchObject({
      tools: [
        { approval: "none", execution: "governed", provenance: { sourceDigest: "a".repeat(64) } },
      ],
    });
    expect(projectTypedOpenApi(f.runtime, { title: "Notes", version: "1" })).toMatchObject({
      "x-documentation-projection": true,
      "x-network-endpoint": false,
    });
  });

  it("returns a proposal reference through MCP without exposing host controls or executing", async () => {
    const f = fixture();
    const server = createTypedMcpServer({ runtime: f.runtime, context: f.session });
    const client = new Client({ name: "governed-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["append"]);
      const response = await client.callTool({ name: "append", arguments: { ...input } });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response)).toContain("proposalDigest");
      expect(JSON.stringify(response)).not.toContain(f.lease.id);
      expect(f.handler).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preserves literal __proto__ data through kernel snapshots", () => {
    const frozen = deepFreezeJsonObject({ ["__proto__"]: { text: "data" }, safe: true });
    expect(Object.hasOwn(frozen, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(frozen)).toBe(Object.prototype);
    expect(JSON.stringify(frozen)).toBe('{"__proto__":{"text":"data"},"safe":true}');
  });
});
