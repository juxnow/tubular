import { AppendNoteExecutor, InMemoryWorkspace } from "./adapters/in-memory-workspace.js";
import { issueAuthorityLease } from "./authority/types.js";
import { createDefaultRegistry } from "./catalog.js";
import { createHandoffEnvelope } from "./context/handoff.js";
import { buildContextManifest, type ContextSource } from "./context/manifest.js";
import { type JsonObject, stablePrettyStringify } from "./core/json.js";
import type { Clock } from "./core/time.js";
import {
  ContextRegistrationAuthority,
  HumanApprovalAuthority,
  LeaseIssuerAuthority,
  TotallyTubularKernel,
} from "./runtime/kernel.js";

const DEMO_TIME = "2026-09-13T16:00:00.000Z";

const clock: Clock = {
  /** Return the fixed demonstration instant so generated evidence is reproducible. */
  now(): Date {
    return new Date(DEMO_TIME);
  },
};

const sources: readonly ContextSource[] = [
  {
    id: "architecture-note",
    label: "Architecture note",
    mediaType: "text/markdown",
    content: "Models propose actions. The trusted kernel decides and executes.",
    classification: "internal",
    disclosure: "explicit-grant",
    provenance: {
      kind: "manual",
      locator: "demo://architecture-note",
      observedAt: DEMO_TIME,
    },
  },
  {
    id: "private-scratchpad",
    label: "Private scratchpad",
    mediaType: "text/plain",
    content: "This source must not cross an internal classification ceiling.",
    classification: "private",
    disclosure: "local-only",
    provenance: {
      kind: "manual",
      locator: "demo://private-scratchpad",
      observedAt: DEMO_TIME,
    },
  },
];

const manifest = buildContextManifest(
  sources,
  {
    purpose: "Demonstrate a bounded note-writing action",
    principalId: "agent.demo",
    selectedSourceIds: ["architecture-note", "private-scratchpad"],
    classificationCeiling: "internal",
  },
  clock,
);

const handoff = createHandoffEnvelope(
  {
    fromPrincipalId: "human.mj",
    intendedPrincipalIds: ["agent.demo"],
    objective: "Append one architecture note after exact approval",
    constraints: [
      "Do not execute without a matching capability lease",
      "Do not execute without exact human approval",
    ],
    openQuestions: [],
    contextManifest: manifest,
  },
  clock,
);

const lease = issueAuthorityLease(
  {
    subjectId: "agent.demo",
    issuedBy: "human.mj",
    expiresAt: "2026-09-13T17:00:00.000Z",
    grants: [
      {
        toolName: "workspace.note.append",
        resourcePatterns: ["workspace://demo/**"],
      },
    ],
    effectCeiling: "workspace-write",
    contextManifestDigests: [manifest.digest],
    maxUses: 1,
  },
  clock,
);

const workspace = new InMemoryWorkspace();
const approvalAuthority = new HumanApprovalAuthority("human.mj");
const leaseIssuerAuthority = new LeaseIssuerAuthority("human.mj");
const contextRegistrationAuthority = new ContextRegistrationAuthority("context.local");
const kernel = new TotallyTubularKernel(createDefaultRegistry(), clock, {
  approvalAuthorities: [approvalAuthority],
  leaseIssuerAuthorities: [leaseIssuerAuthority],
  contextRegistrationAuthorities: [contextRegistrationAuthority],
});
kernel.registerManifest(manifest, contextRegistrationAuthority);
kernel.registerLease(lease, leaseIssuerAuthority);
kernel.registerExecutor(new AppendNoteExecutor(workspace));

const proposed = kernel.propose({
  principalId: "agent.demo",
  leaseId: lease.id,
  toolName: "workspace.note.append",
  input: {
    resource: "workspace://demo/architecture.md",
    text: "Models propose. The kernel disposes.",
  },
  contextManifestId: manifest.id,
});

if (!proposed.ok || proposed.challenge === null) {
  throw new Error("Demo proposal did not produce the expected approval challenge");
}

const beforeApproval = await kernel.execute(proposed.proposal.id);
if (beforeApproval.ok || beforeApproval.failure.code !== "APPROVAL_REQUIRED") {
  throw new Error("Demo action was not blocked before approval");
}

const approved = kernel.approve({
  challengeId: proposed.challenge.id,
  proposalId: proposed.proposal.id,
  proposalDigest: proposed.proposal.digest,
  proposalRevision: proposed.proposal.revision,
  authority: approvalAuthority,
});
if (!approved.ok) {
  throw new Error(`Demo approval failed: ${approved.failure.code}`);
}

const executed = await kernel.execute(proposed.proposal.id);
if (!executed.ok) {
  throw new Error(`Demo execution failed: ${executed.failure.code}`);
}

const verification = kernel.audit.verify();
if (!verification.valid) {
  throw new Error(`Audit verification failed at ${verification.invalidEventId ?? "unknown"}`);
}

const summary: JsonObject = {
  project: "Totally Tubular",
  handoffId: handoff.id,
  contextManifest: {
    id: manifest.id,
    includedSourceIds: manifest.items.map((item) => item.sourceId),
    omittedSources: manifest.omitted.map((item) => ({
      sourceId: item.sourceId,
      reason: item.reason,
    })),
  },
  leaseId: lease.id,
  proposal: {
    id: proposed.proposal.id,
    decision: proposed.decision.outcome,
    digest: proposed.proposal.digest,
  },
  preApprovalAttempt: beforeApproval.failure.code,
  approvalId: approved.approval.id,
  receipt: {
    id: executed.receipt.id,
    auditEventId: executed.receipt.auditEventId,
    digest: executed.receipt.digest,
  },
  workspaceRevision: workspace.read("workspace://demo/architecture.md")?.revision ?? null,
  audit: {
    valid: verification.valid,
    eventCount: verification.eventCount,
    headHash: verification.headHash,
  },
};

process.stdout.write(`${stablePrettyStringify(summary)}\n`);
