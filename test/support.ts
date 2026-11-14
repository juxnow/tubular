import {
  AppendNoteExecutor,
  InMemoryWorkspace,
} from "../src/adapters/in-memory-workspace.js";
import { issueAuthorityLease, type AuthorityLease } from "../src/authority/types.js";
import { createDefaultRegistry } from "../src/catalog.js";
import { buildContextManifest, type ContextManifest } from "../src/context/manifest.js";
import type { DisclosurePolicy } from "../src/context/manifest.js";
import type { EffectClass } from "../src/contracts/tool-contract.js";
import type { Clock } from "../src/core/time.js";
import {
  HumanApprovalAuthority,
  LeaseIssuerAuthority,
  ContextRegistrationAuthority,
  TotallyTubularKernel,
  type ToolExecutor,
} from "../src/runtime/kernel.js";

export class TestClock implements Clock {
  #instant: number;

  constructor(iso: string) {
    this.#instant = Date.parse(iso);
  }

  now(): Date {
    return new Date(this.#instant);
  }

  advance(milliseconds: number): void {
    this.#instant += milliseconds;
  }
}

export interface FixtureOptions {
  readonly resourcePatterns?: readonly string[];
  readonly contextAuthorized?: boolean;
  readonly effectCeiling?: EffectClass;
  readonly maxUses?: number;
  readonly expiresInMs?: number;
  readonly executor?: ToolExecutor;
  readonly approverId?: string;
  readonly maxPendingProposalsPerPrincipal?: number;
  readonly disclosure?: DisclosurePolicy;
}

export interface Fixture {
  readonly clock: TestClock;
  readonly manifest: ContextManifest;
  readonly lease: AuthorityLease;
  readonly workspace: InMemoryWorkspace;
  readonly kernel: TotallyTubularKernel;
  readonly approvalAuthority: HumanApprovalAuthority;
  readonly leaseIssuerAuthority: LeaseIssuerAuthority;
  readonly contextRegistrationAuthority: ContextRegistrationAuthority;
}

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
  const contextManifestDigests =
    options.contextAuthorized === false ? [] : [manifest.digest];
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
    approvalAuthorities: [approvalAuthority],
    leaseIssuerAuthorities: [leaseIssuerAuthority],
    contextRegistrationAuthorities: [contextRegistrationAuthority],
    ...(options.maxPendingProposalsPerPrincipal === undefined
      ? {}
      : {
          maxPendingProposalsPerPrincipal:
            options.maxPendingProposalsPerPrincipal,
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
