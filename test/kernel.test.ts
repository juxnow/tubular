import { describe, expect, it } from "vitest";
import { verifyAuditEvents, type AuditEvent } from "../src/audit/audit-log.js";
import {
  issueAuthorityLease,
  verifyExecutionReceiptIntegrity,
} from "../src/authority/types.js";
import { buildContextManifest } from "../src/context/manifest.js";
import {
  HumanApprovalAuthority,
  LeaseIssuerAuthority,
} from "../src/runtime/kernel.js";
import { createFixture } from "./support.js";

function proposeAllowedNote(fixture: ReturnType<typeof createFixture>, text = "approved text") {
  return fixture.kernel.propose({
    principalId: "agent.test",
    leaseId: fixture.lease.id,
    toolName: "workspace.note.append",
    input: { resource: "workspace://allowed/note.md", text },
    contextManifestId: fixture.manifest.id,
  });
}

describe("trusted execution kernel", () => {
  it("returns a principal-scoped status without proposal inputs or authority ids", () => {
    const fixture = createFixture({ maxUses: 4 });
    const proposed = proposeAllowedNote(fixture, "status-secret-sentinel");
    if (!proposed.ok) {
      throw new Error("Expected an accepted proposal");
    }
    const visible = fixture.kernel.getProposalStatus(
      "agent.test",
      proposed.proposal.id,
    );
    expect(visible).toMatchObject({
      ok: true,
      status: {
        proposalId: proposed.proposal.id,
        state: "pending-approval",
        approvalRequired: true,
      },
    });
    const serialized = JSON.stringify(visible);
    for (const secret of [
      "status-secret-sentinel",
      "workspace://allowed/note.md",
      fixture.lease.id,
      fixture.manifest.id,
      "agent.test",
      "human.test",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(
      fixture.kernel.getProposalStatus("agent.someone-else", proposed.proposal.id),
    ).toMatchObject({
      ok: false,
      failure: { code: "PROPOSAL_NOT_FOUND" },
    });
  });

  it("reports executing and succeeded without exposing adapter output", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = createFixture({
      maxUses: 2,
      executor: {
        toolName: "workspace.note.append",
        idempotency: "proposal-id",
        async execute() {
          await gate;
          return {
            resource: "workspace://allowed/note.md",
            revision: 1,
            entryCount: 1,
            appendedCharacters: 6,
          };
        },
      },
    });
    const proposed = proposeAllowedNote(fixture, "queued");
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    expect(
      fixture.kernel.approve({
        challengeId: proposed.challenge.id,
        proposalId: proposed.proposal.id,
        proposalDigest: proposed.proposal.digest,
        proposalRevision: proposed.proposal.revision,
        authority: fixture.approvalAuthority,
      }).ok,
    ).toBe(true);
    const execution = fixture.kernel.execute(proposed.proposal.id);
    expect(
      fixture.kernel.getProposalStatus("agent.test", proposed.proposal.id),
    ).toMatchObject({ ok: true, status: { state: "executing" } });
    release?.();
    expect((await execution).ok).toBe(true);
    const completed = fixture.kernel.getProposalStatus(
      "agent.test",
      proposed.proposal.id,
    );
    expect(completed).toMatchObject({
      ok: true,
      status: { state: "succeeded" },
    });
    expect(JSON.stringify(completed)).not.toContain("workspace://allowed/note.md");
  });

  it("enforces a pending proposal cap and releases expired challenges", () => {
    const fixture = createFixture({
      maxUses: 8,
      maxPendingProposalsPerPrincipal: 1,
    });
    const first = proposeAllowedNote(fixture, "first pending");
    expect(first.ok).toBe(true);
    expect(proposeAllowedNote(fixture, "blocked by cap")).toMatchObject({
      ok: false,
      failure: { code: "PROPOSAL_LIMIT_REACHED", retryable: true },
    });
    fixture.clock.advance(15 * 60 * 1_000 + 1);
    if (!first.ok) {
      return;
    }
    expect(
      fixture.kernel.getProposalStatus("agent.test", first.proposal.id),
    ).toMatchObject({ ok: true, status: { state: "approval-expired" } });
    expect(proposeAllowedNote(fixture, "slot reclaimed").ok).toBe(true);
  });

  it("blocks an effect until exact human approval exists", async () => {
    const fixture = createFixture();
    const proposed = proposeAllowedNote(fixture);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    expect(proposed.decision.outcome).toBe("approval-required");
    const result = await fixture.kernel.execute(proposed.proposal.id);
    expect(result).toMatchObject({
      ok: false,
      failure: { code: "APPROVAL_REQUIRED" },
    });
    expect(fixture.workspace.read("workspace://allowed/note.md")).toBeUndefined();
  });

  it("rejects approval for a changed digest", () => {
    const fixture = createFixture();
    const proposed = proposeAllowedNote(fixture, "sensitive raw value");
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    const approval = fixture.kernel.approve({
      challengeId: proposed.challenge.id,
      proposalId: proposed.proposal.id,
      proposalDigest: "0".repeat(64),
      proposalRevision: proposed.proposal.revision,
      authority: fixture.approvalAuthority,
    });
    expect(approval).toMatchObject({
      ok: false,
      failure: { code: "APPROVAL_MISMATCH" },
    });
    expect(JSON.stringify(fixture.kernel.audit.entries())).not.toContain("sensitive raw value");
  });

  it("rejects an unregistered approval authority even when its name matches", () => {
    const fixture = createFixture();
    const proposed = proposeAllowedNote(fixture);
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    const impersonator = new HumanApprovalAuthority("human.test");
    const approval = fixture.kernel.approve({
      challengeId: proposed.challenge.id,
      proposalId: proposed.proposal.id,
      proposalDigest: proposed.proposal.digest,
      proposalRevision: proposed.proposal.revision,
      authority: impersonator,
    });
    expect(approval).toMatchObject({
      ok: false,
      failure: { code: "APPROVER_NOT_AUTHORIZED" },
    });
  });

  it("forbids a registered principal from approving its own proposal", () => {
    const fixture = createFixture({ approverId: "agent.test" });
    const proposed = proposeAllowedNote(fixture);
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    expect(
      fixture.kernel.approve({
        challengeId: proposed.challenge.id,
        proposalId: proposed.proposal.id,
        proposalDigest: proposed.proposal.digest,
        proposalRevision: proposed.proposal.revision,
        authority: fixture.approvalAuthority,
      }),
    ).toMatchObject({
      ok: false,
      failure: { code: "APPROVER_NOT_AUTHORIZED" },
    });
  });

  it("executes once, returns a linked receipt, and replays idempotently", async () => {
    const fixture = createFixture();
    const proposed = proposeAllowedNote(fixture);
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    const approval = fixture.kernel.approve({
      challengeId: proposed.challenge.id,
      proposalId: proposed.proposal.id,
      proposalDigest: proposed.proposal.digest,
      proposalRevision: proposed.proposal.revision,
      authority: fixture.approvalAuthority,
    });
    expect(approval.ok).toBe(true);

    const first = await fixture.kernel.execute(proposed.proposal.id);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.replayed).toBe(false);
    expect(first.receipt.approvalId).toBe(approval.ok ? approval.approval.id : null);
    expect(first.receipt.auditEventId).toMatch(/^audit_/);
    expect(first.receipt.contextManifestId).toBe(fixture.manifest.id);
    expect(verifyExecutionReceiptIntegrity(first.receipt)).toBe(true);
    expect(
      verifyExecutionReceiptIntegrity({
        ...first.receipt,
        result: { tampered: true },
      }),
    ).toBe(false);
    expect(fixture.workspace.read("workspace://allowed/note.md")?.revision).toBe(1);

    const second = await fixture.kernel.execute(proposed.proposal.id);
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(fixture.workspace.read("workspace://allowed/note.md")?.revision).toBe(1);
    expect(fixture.kernel.audit.verify().valid).toBe(true);
  });

  it("coalesces concurrent execution of the same proposal", async () => {
    const fixture = createFixture({ maxUses: 2 });
    const proposed = proposeAllowedNote(fixture);
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    const approval = fixture.kernel.approve({
      challengeId: proposed.challenge.id,
      proposalId: proposed.proposal.id,
      proposalDigest: proposed.proposal.digest,
      proposalRevision: proposed.proposal.revision,
      authority: fixture.approvalAuthority,
    });
    expect(approval.ok).toBe(true);

    const [left, right] = await Promise.all([
      fixture.kernel.execute(proposed.proposal.id),
      fixture.kernel.execute(proposed.proposal.id),
    ]);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    if (!left.ok || !right.ok) {
      return;
    }
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(left.receipt.id).toBe(right.receipt.id);
    expect(fixture.workspace.read("workspace://allowed/note.md")?.entries).toHaveLength(1);
  });

  it("reserves a lease use before awaiting an effect", async () => {
    const fixture = createFixture({ maxUses: 1 });
    const first = proposeAllowedNote(fixture, "first");
    const second = proposeAllowedNote(fixture, "second");
    if (
      !first.ok ||
      first.challenge === null ||
      !second.ok ||
      second.challenge === null
    ) {
      throw new Error("Expected two approval challenges");
    }
    for (const proposed of [first, second]) {
      const approval = fixture.kernel.approve({
        challengeId: proposed.challenge!.id,
        proposalId: proposed.proposal.id,
        proposalDigest: proposed.proposal.digest,
        proposalRevision: proposed.proposal.revision,
        authority: fixture.approvalAuthority,
      });
      expect(approval.ok).toBe(true);
    }

    const results = await Promise.all([
      fixture.kernel.execute(first.proposal.id),
      fixture.kernel.execute(second.proposal.id),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      ok: false,
      failure: {
        code: "POLICY_DENIED",
        details: { policyReasonCode: "LEASE_EXHAUSTED" },
      },
    });
    expect(fixture.workspace.read("workspace://allowed/note.md")?.entries).toHaveLength(1);
  });

  it("denies resources outside the lease as a structured result", () => {
    const fixture = createFixture({ resourcePatterns: ["workspace://other/**"] });
    const result = proposeAllowedNote(fixture);
    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: "POLICY_DENIED",
        details: { policyReasonCode: "RESOURCE_NOT_GRANTED" },
      },
    });
  });

  it("rejects traversal-like workspace resources before policy or execution", () => {
    const fixture = createFixture();
    const result = fixture.kernel.propose({
      principalId: "agent.test",
      leaseId: fixture.lease.id,
      toolName: "workspace.note.append",
      input: {
        resource: "workspace://allowed/../outside",
        text: "must not escape",
      },
      contextManifestId: fixture.manifest.id,
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { code: "INPUT_INVALID" },
    });
    expect(fixture.workspace.read("workspace://outside")).toBeUndefined();
  });

  it("denies context sources not named by the lease", () => {
    const fixture = createFixture({ contextAuthorized: false });
    const result = proposeAllowedNote(fixture);
    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: "POLICY_DENIED",
        details: { policyReasonCode: "CONTEXT_NOT_GRANTED" },
      },
    });
  });

  it("denies local-only context even when its exact digest is leased", () => {
    const fixture = createFixture({ disclosure: "local-only" });
    expect(proposeAllowedNote(fixture)).toMatchObject({
      ok: false,
      failure: {
        code: "POLICY_DENIED",
        details: { policyReasonCode: "DISCLOSURE_NOT_ALLOWED" },
      },
    });
  });

  it("rejects a tampered context manifest at registration", () => {
    const fixture = createFixture();
    expect(() =>
      fixture.kernel.registerManifest(
        {
          ...fixture.manifest,
          id: "context_tampered",
          purpose: "changed without a matching digest",
        },
        fixture.contextRegistrationAuthority,
      ),
    ).toThrow("integrity check");
  });

  it("binds context grants to exact snapshot bytes, not reusable source ids", () => {
    const fixture = createFixture();
    const changed = buildContextManifest(
      [
        {
          id: "source.allowed",
          label: "Changed source",
          mediaType: "text/plain",
          content: "different bytes under the same logical source id",
          classification: "internal",
          disclosure: "explicit-grant",
          provenance: {
            kind: "manual",
            locator: "test://source.allowed",
            observedAt: fixture.clock.now().toISOString(),
          },
        },
      ],
      {
        purpose: "attempt source id reuse",
        principalId: "agent.test",
        selectedSourceIds: ["source.allowed"],
        classificationCeiling: "internal",
      },
      fixture.clock,
    );
    fixture.kernel.registerManifest(changed, fixture.contextRegistrationAuthority);
    const result = fixture.kernel.propose({
      principalId: "agent.test",
      leaseId: fixture.lease.id,
      toolName: "workspace.note.append",
      input: { resource: "workspace://allowed/note.md", text: "nope" },
      contextManifestId: changed.id,
    });
    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: "POLICY_DENIED",
        details: { policyReasonCode: "CONTEXT_NOT_GRANTED" },
      },
    });
  });

  it("rechecks lease expiry immediately before execution", async () => {
    const fixture = createFixture({ expiresInMs: 100 });
    const proposed = proposeAllowedNote(fixture);
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    const approval = fixture.kernel.approve({
      challengeId: proposed.challenge.id,
      proposalId: proposed.proposal.id,
      proposalDigest: proposed.proposal.digest,
      proposalRevision: proposed.proposal.revision,
      authority: fixture.approvalAuthority,
    });
    expect(approval.ok).toBe(true);
    fixture.clock.advance(101);
    const result = await fixture.kernel.execute(proposed.proposal.id);
    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: "POLICY_DENIED",
        details: { policyReasonCode: "LEASE_EXPIRED" },
      },
    });
  });

  it("honors lease revocation before a proposal", () => {
    const fixture = createFixture();
    expect(
      fixture.kernel.revokeLease(fixture.lease.id, fixture.leaseIssuerAuthority),
    ).toBe(true);
    expect(proposeAllowedNote(fixture)).toMatchObject({
      ok: false,
      failure: {
        code: "POLICY_DENIED",
        details: { policyReasonCode: "LEASE_REVOKED" },
      },
    });
  });

  it("honors approval revocation before execution", async () => {
    const fixture = createFixture();
    const proposed = proposeAllowedNote(fixture);
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    const approval = fixture.kernel.approve({
      challengeId: proposed.challenge.id,
      proposalId: proposed.proposal.id,
      proposalDigest: proposed.proposal.digest,
      proposalRevision: proposed.proposal.revision,
      authority: fixture.approvalAuthority,
    });
    expect(approval.ok).toBe(true);
    expect(
      fixture.kernel.revokeApproval(proposed.proposal.id, fixture.approvalAuthority),
    ).toBe(true);
    expect(await fixture.kernel.execute(proposed.proposal.id)).toMatchObject({
      ok: false,
      failure: { code: "APPROVAL_REVOKED" },
    });
  });

  it("rejects unknown input properties atomically", () => {
    const fixture = createFixture();
    const result = fixture.kernel.propose({
      principalId: "agent.test",
      leaseId: fixture.lease.id,
      toolName: "workspace.note.append",
      input: {
        resource: "workspace://allowed/note.md",
        text: "safe",
        surprise: "not accepted",
      },
      contextManifestId: fixture.manifest.id,
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { code: "INPUT_INVALID" },
    });
    expect(fixture.workspace.read("workspace://allowed/note.md")).toBeUndefined();
  });

  it("blocks automatic retry when an executor outcome is unknown", async () => {
    let calls = 0;
    const fixture = createFixture({
      maxUses: 2,
      executor: {
        toolName: "workspace.note.append",
        idempotency: "proposal-id",
        async execute() {
          calls += 1;
          throw new Error("secret-provider-detail");
        },
      },
    });
    const proposed = proposeAllowedNote(fixture);
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    const approval = fixture.kernel.approve({
      challengeId: proposed.challenge.id,
      proposalId: proposed.proposal.id,
      proposalDigest: proposed.proposal.digest,
      proposalRevision: proposed.proposal.revision,
      authority: fixture.approvalAuthority,
    });
    expect(approval.ok).toBe(true);

    const first = await fixture.kernel.execute(proposed.proposal.id);
    const second = await fixture.kernel.execute(proposed.proposal.id);
    expect(first).toMatchObject({
      ok: false,
      failure: { code: "EXECUTION_OUTCOME_UNKNOWN", retryable: false },
    });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(JSON.stringify(fixture.kernel.audit.entries())).not.toContain(
      "secret-provider-detail",
    );
  });

  it("captures an executor implementation when it is registered", async () => {
    let originalCalls = 0;
    let replacementCalls = 0;
    const executor = {
      toolName: "workspace.note.append",
      idempotency: "proposal-id" as const,
      async execute() {
        originalCalls += 1;
        return {
          resource: "workspace://allowed/note.md",
          revision: 1,
          entryCount: 1,
          appendedCharacters: 8,
        };
      },
    };
    const fixture = createFixture({ executor, maxUses: 2 });
    executor.toolName = "mutated.tool";
    executor.execute = async () => {
      replacementCalls += 1;
      throw new Error("replacement must never run");
    };
    const proposed = proposeAllowedNote(fixture, "captured");
    if (!proposed.ok || proposed.challenge === null) {
      throw new Error("Expected an approval challenge");
    }
    expect(
      fixture.kernel.approve({
        challengeId: proposed.challenge.id,
        proposalId: proposed.proposal.id,
        proposalDigest: proposed.proposal.digest,
        proposalRevision: proposed.proposal.revision,
        authority: fixture.approvalAuthority,
      }).ok,
    ).toBe(true);
    expect((await fixture.kernel.execute(proposed.proposal.id)).ok).toBe(true);
    expect(originalCalls).toBe(1);
    expect(replacementCalls).toBe(0);
  });

  it("detects a modified audit event during replay", () => {
    const fixture = createFixture();
    proposeAllowedNote(fixture);
    const entries = fixture.kernel.audit.entries();
    const first = entries[0];
    if (first === undefined) {
      throw new Error("Expected an audit event");
    }
    const tampered: AuditEvent = {
      ...first,
      payload: { ...first.payload, subjectId: "attacker" },
    };
    expect(verifyAuditEvents([tampered, ...entries.slice(1)])).toMatchObject({
      valid: false,
      invalidEventId: first.id,
    });
  });

  it("rejects a caller-fabricated authority lease", () => {
    const fixture = createFixture();
    expect(() =>
      fixture.kernel.registerLease({
        ...fixture.lease,
        id: "lease_fabricated",
        digest: "not-a-digest",
        maxUses: 999,
      }, fixture.leaseIssuerAuthority),
    ).toThrow("integrity check");
  });

  it("rejects a self-issued lease without the registered issuer capability", () => {
    const fixture = createFixture();
    const rogueAuthority = new LeaseIssuerAuthority("agent.test");
    const rogueLease = issueAuthorityLease(
      {
        subjectId: "agent.test",
        issuedBy: "agent.test",
        expiresAt: new Date(fixture.clock.now().getTime() + 60_000).toISOString(),
        grants: [{ toolName: "workspace.note.append", resourcePatterns: ["*"] }],
        effectCeiling: "destructive",
        contextManifestDigests: [fixture.manifest.digest],
        maxUses: 999,
      },
      fixture.clock,
    );
    expect(() => fixture.kernel.registerLease(rogueLease, rogueAuthority)).toThrow(
      "issuer authority",
    );
  });

  it("exposes immutable audit entries", () => {
    const fixture = createFixture();
    proposeAllowedNote(fixture);
    const first = fixture.kernel.audit.entries()[0];
    expect(first).toBeDefined();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.payload)).toBe(true);
  });
});
