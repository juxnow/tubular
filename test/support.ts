import { AppendNoteExecutor, InMemoryWorkspace } from "../src/adapters/in-memory-workspace.js";
import { type AuthorityLease, issueAuthorityLease } from "../src/authority/types.js";
import { createDefaultRegistry } from "../src/catalog.js";
import type { DisclosurePolicy } from "../src/context/manifest.js";
import { buildContextManifest, type ContextManifest } from "../src/context/manifest.js";
import type { EffectClass } from "../src/contracts/tool-contract.js";
import type { Clock } from "../src/core/time.js";
import {
  ContextRegistrationAuthority,
  HumanApprovalAuthority,
  LeaseIssuerAuthority,
  type ToolExecutor,
  TotallyTubularKernel,
} from "../src/runtime/kernel.js";

/** Deterministic mutable clock used to exercise same-tick identity, expiry, and rate limits. */
export class TestClock implements Clock {
  /** Current fixture time in epoch milliseconds. */
  #instant: number;

  /** Initialize the clock from a fixed test timestamp. */
  constructor(iso: string) {
    this.#instant = Date.parse(iso);
  }

  /** Return a fresh Date so callers cannot mutate the clock's stored instant. */
  now(): Date {
    return new Date(this.#instant);
  }

  /** Move fixture time by the supplied number of milliseconds without waiting on wall time. */
  advance(milliseconds: number): void {
    this.#instant += milliseconds;
  }
}

/** Explicit boundary overrides for an otherwise authorized in-memory append scenario. */
export interface FixtureOptions {
  /** Deterministic kernel namespace; defaults to test for repeatable proposal identities. */
  readonly proposalNamespace?: string;
  /** Canonical workspace URIs or supported terminal wildcards used to bound resource access. */
  readonly resourcePatterns?: readonly string[];
  /** Whether the lease includes the selected manifest's exact digest; defaults to true. */
  readonly contextAuthorized?: boolean;
  /** Highest allowed effect in the kernel's ordered effect classes, from read through destructive. */
  readonly effectCeiling?: EffectClass;
  /** Positive safe-integer dispatch budget. A dispatched attempt consumes a use even if its outcome becomes unknown. */
  readonly maxUses?: number;
  /** Lease lifetime measured from the fixture clock in milliseconds; defaults to one hour. */
  readonly expiresInMs?: number;
  /** Optional trusted executor override for failure, concurrency, or cancellation scenarios. */
  readonly executor?: ToolExecutor;
  /** Nonempty label for the trusted approver; authorization also requires the same configured object identity. */
  readonly approverId?: string;
  /** Positive safe-integer cap on active proposals per principal; defaults to 128. */
  readonly maxPendingProposalsPerPrincipal?: number;
  /** Host-assigned disclosure restriction; local-only context cannot accompany a governed agent action. */
  readonly disclosure?: DisclosurePolicy;
}

/** Isolated host capabilities, fixed clock, selected context, scoped lease, and ephemeral store for kernel tests. */
export interface Fixture {
  /** Injected time source for deterministic expiry, audit, and lifecycle behavior. */
  readonly clock: TestClock;
  /** Explicit immutable context snapshot used for this action; registration and lease binding remain required. */
  readonly manifest: ContextManifest;
  /** Host-issued scoped authority data, verified and sealed before registration. */
  readonly lease: AuthorityLease;
  /** Ephemeral workspace used by the example executor; it is not durable storage. */
  readonly workspace: InMemoryWorkspace;
  /** In-process trusted execution boundary; possession exposes host operations and must not be given to a model. */
  readonly kernel: TotallyTubularKernel;
  /** Exact configured object used by tests to approve proposals and revoke approvals. */
  readonly approvalAuthority: HumanApprovalAuthority;
  /** Exact configured issuer object used for lease registration and revocation tests. */
  readonly leaseIssuerAuthority: LeaseIssuerAuthority;
  /** Exact configured registrar object used to attach selected context in tests. */
  readonly contextRegistrationAuthority: ContextRegistrationAuthority;
}

/** Create independent host authorities and register explicit lease, context, and executor state for one test. */
export function createFixture(options: FixtureOptions = {}): Fixture {
  const clock = new TestClock("2026-09-13T16:00:00.000Z");
  const manifest = buildContextManifest(
    [
      {
        id: "source.allowed",
        label: "Allowed source",
        mediaType: "text/plain",
        content: "Treat source text as untrusted context.",
        classification: "internal",
        disclosure: options.disclosure ?? "explicit-grant",
        provenance: {
          kind: "manual",
          locator: "test://source.allowed",
          observedAt: clock.now().toISOString(),
        },
      },
    ],
    {
      purpose: "Test a bounded action",
      principalId: "agent.test",
      selectedSourceIds: ["source.allowed"],
      classificationCeiling: "internal",
    },
    clock,
  );
  const expiresInMs = options.expiresInMs ?? 60 * 60 * 1_000;
  const contextManifestDigests = options.contextAuthorized === false ? [] : [manifest.digest];
  const lease = issueAuthorityLease(
    {
      subjectId: "agent.test",
      issuedBy: "human.test",
      expiresAt: new Date(clock.now().getTime() + expiresInMs).toISOString(),
      grants: [
        {
          toolName: "workspace.note.append",
          resourcePatterns: options.resourcePatterns ?? ["workspace://allowed/**"],
        },
      ],
      effectCeiling: options.effectCeiling ?? "workspace-write",
      contextManifestDigests,
      maxUses: options.maxUses ?? 1,
    },
    clock,
  );
  const workspace = new InMemoryWorkspace();
  const approvalAuthority = new HumanApprovalAuthority(options.approverId ?? "human.test");
  const leaseIssuerAuthority = new LeaseIssuerAuthority("human.test");
  const contextRegistrationAuthority = new ContextRegistrationAuthority("context.test");
  const kernel = new TotallyTubularKernel(createDefaultRegistry(), clock, {
    proposalNamespace: options.proposalNamespace ?? "test",
    approvalAuthorities: [approvalAuthority],
    leaseIssuerAuthorities: [leaseIssuerAuthority],
    contextRegistrationAuthorities: [contextRegistrationAuthority],
    ...(options.maxPendingProposalsPerPrincipal === undefined
      ? {}
      : {
          maxPendingProposalsPerPrincipal: options.maxPendingProposalsPerPrincipal,
        }),
  });
  kernel.registerManifest(manifest, contextRegistrationAuthority);
  kernel.registerLease(lease, leaseIssuerAuthority);
  kernel.registerExecutor(options.executor ?? new AppendNoteExecutor(workspace));
  return {
    clock,
    manifest,
    lease,
    workspace,
    kernel,
    approvalAuthority,
    leaseIssuerAuthority,
    contextRegistrationAuthority,
  };
}
