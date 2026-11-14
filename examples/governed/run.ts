import assert from "node:assert/strict";
import {
  buildContextManifest, ContextRegistrationAuthority, createGovernedToolRuntime,
  HumanApprovalAuthority, issueAuthorityLease, LeaseIssuerAuthority,
  projectCapabilityManifest, projectTypedOpenApi,
} from "@juxnow/tubular";
import { appendNote } from "./bindings.js";

const clock = { now: (): Date => new Date("2026-11-14T12:00:00Z") };
const issuer = new LeaseIssuerAuthority("example.host");
const registrar = new ContextRegistrationAuthority("example.host");
const approver = new HumanApprovalAuthority("example.human");
const runtime = createGovernedToolRuntime({
  clock,
  definitions: [appendNote({
    name: "notes.append", description: "Append a note to the selected workspace.",
    effect: "workspace-write", resource: input => input.resource,
  })],
  kernelOptions: { leaseIssuerAuthorities: [issuer], contextRegistrationAuthorities: [registrar], approvalAuthorities: [approver] },
});
const manifest = buildContextManifest([{
  id: "selected-note", label: "Selected note", content: "A small, host-selected example context.",
  mediaType: "text/plain", classification: "internal", disclosure: "explicit-grant",
  provenance: { kind: "manual", locator: "example://selected-note", observedAt: clock.now().toISOString() },
}], {
  principalId: "example.agent", purpose: "Write one example note", selectedSourceIds: ["selected-note"], classificationCeiling: "internal",
}, clock);
const lease = issueAuthorityLease({
  subjectId: manifest.principalId, issuedBy: issuer.issuerId, expiresAt: "2026-11-14T13:00:00Z",
  grants: [{ toolName: "notes.append", resourcePatterns: ["workspace://example/**"] }],
  effectCeiling: "workspace-write", contextManifestDigests: [manifest.digest], maxUses: 1,
}, clock);
const session = runtime.openSession({ lease, manifest, leaseIssuer: issuer, contextRegistrar: registrar });

const denied = runtime.propose("notes.append", { resource: "workspace://other/note", text: "No" }, session);
assert.equal(denied.ok, false);
const pending = runtime.propose("notes.append", { resource: "workspace://example/note", text: "Hello, Tubular." }, session);
assert(pending.ok && pending.challenge !== null);
assert.equal((await runtime.execute(pending.proposal.id, session)).ok, false);
console.log("Exact proposal for host review:", JSON.stringify(pending.proposal, null, 2));

// A real host calls approve only after its authenticated human review flow.
// This local demonstration simulates that review with an in-process authority.
const approved = runtime.kernel.approve({
  authority: approver, challengeId: pending.challenge.id, proposalId: pending.proposal.id,
  proposalDigest: pending.proposal.digest, proposalRevision: pending.proposal.revision,
});
assert(approved.ok);
const executed = await runtime.execute(pending.proposal.id, session);
assert(executed.ok);
const replay = await runtime.execute(pending.proposal.id, session);
assert(replay.ok && replay.replayed);
assert.equal(replay.receipt.id, executed.receipt.id);
assert(runtime.kernel.audit.verify().valid);
console.log("Receipt:", JSON.stringify(executed.receipt, null, 2));
console.log("Verified: denial, approval gate, execution, receipt replay, audit chain.");
console.log("Capability manifest:", JSON.stringify(projectCapabilityManifest(runtime), null, 2));
assert.equal(projectTypedOpenApi(runtime, { title: "Notes", version: "1" })["x-network-endpoint"], false);
