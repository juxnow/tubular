import type { AuditEvent, AuditReader } from "../audit/audit-log.js";
import { AuditLog } from "../audit/audit-log.js";
import { PolicyEngine } from "../authority/policy.js";
import {
  approvalChallengeToJson,
  authorityLeaseToJson,
  executionReceiptToJson,
  humanApprovalToJson,
  policyDecisionToJson,
  sealAuthorityLease,
  type ActionProposal,
  type ActionRequest,
  type ApprovalChallenge,
  type AuthorityLease,
  type ExecutionReceipt,
  type HumanApproval,
  type PolicyDecision,
} from "../authority/types.js";
import { kernelFailure, type KernelFailure } from "../core/errors.js";
import {
  deepFreezeJson,
  deepFreezeJsonObject,
  sha256,
  stableStringify,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";
import { parseInstant, type Clock } from "../core/time.js";
import type { ContractRegistry } from "../contracts/registry.js";
import type { RegisteredToolContract } from "../contracts/tool-contract.js";
import type { ContextManifest } from "../context/manifest.js";
import { manifestSourceIds, sealContextManifest } from "../context/manifest.js";

export interface ExecutorContext {
  readonly proposal: ActionProposal;
  readonly operationId: string;
  readonly signal: AbortSignal;
}

export interface ToolExecutor {
  readonly toolName: string;
  readonly idempotency: "proposal-id";
  execute(input: JsonObject, context: ExecutorContext): Promise<unknown>;
}

export interface ProposalAccepted {
  readonly ok: true;
  readonly proposal: ActionProposal;
  readonly decision: PolicyDecision;
  readonly challenge: ApprovalChallenge | null;
}

export interface OperationRejected {
  readonly ok: false;
  readonly failure: KernelFailure;
}

export type ProposalResult = ProposalAccepted | OperationRejected;

export interface ApproveActionRequest {
  readonly challengeId: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly proposalRevision: number;
  readonly authority: HumanApprovalAuthority;
}

export type ApprovalResult =
  | { readonly ok: true; readonly approval: HumanApproval }
  | OperationRejected;

export type ExecutionResult =
  | {
      readonly ok: true;
      readonly receipt: ExecutionReceipt;
      readonly replayed: boolean;
    }
  | OperationRejected;

export type ProposalState =
  | "pending-approval"
  | "approval-expired"
  | "approved"
  | "approval-revoked"
  | "ready"
  | "authority-invalid"
  | "executing"
  | "succeeded"
  | "failed";

export interface SafeProposalStatus extends JsonObject {
  readonly protocol: "totally-tubular.proposal-status/v1";
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly toolName: string;
  readonly effect: string;
  readonly policyOutcome: string;
  readonly state: ProposalState;
  readonly approvalRequired: boolean;
  readonly challengeId: string | null;
  readonly challengeExpiresAt: string | null;
  readonly receiptId: string | null;
  readonly failureCode: string | null;
}

export type ProposalStatusResult =
  | { readonly ok: true; readonly status: SafeProposalStatus }
  | OperationRejected;

interface ProposalRecord {
  readonly proposal: ActionProposal;
  readonly decision: PolicyDecision;
  readonly challenge: ApprovalChallenge | null;
}

export interface KernelOptions {
  readonly approvalTtlMs?: number;
  readonly approvalAuthorities?: readonly HumanApprovalAuthority[];
  readonly leaseIssuerAuthorities?: readonly LeaseIssuerAuthority[];
  readonly contextRegistrationAuthorities?: readonly ContextRegistrationAuthority[];
  readonly maxPendingProposalsPerPrincipal?: number;
}

export class HumanApprovalAuthority {
  readonly approverId: string;

  constructor(approverId: string) {
    if (approverId.trim().length === 0) {
      throw new TypeError("approverId must not be empty");
    }
    this.approverId = approverId;
    Object.freeze(this);
  }
}

export class LeaseIssuerAuthority {
  readonly issuerId: string;

  constructor(issuerId: string) {
    if (issuerId.trim().length === 0) {
      throw new TypeError("issuerId must not be empty");
    }
    this.issuerId = issuerId;
    Object.freeze(this);
  }
}

export class ContextRegistrationAuthority {
  readonly registrarId: string;

  constructor(registrarId: string) {
    if (registrarId.trim().length === 0) {
      throw new TypeError("registrarId must not be empty");
    }
    this.registrarId = registrarId;
    Object.freeze(this);
  }
}

function validationDetails(
  issues: readonly { readonly path: string; readonly code: string; readonly message: string }[],
): JsonObject {
  return {
    issues: issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message,
    })),
  };
}

function safeAuditReference(value: string): string {
  return /^[A-Za-z0-9._:/-]{1,128}$/.test(value)
    ? value
    : `sha256:${sha256(value)}`;
}

function proposalBody(
  request: ActionRequest,
  contract: RegisteredToolContract,
  input: JsonObject,
  resource: string,
  manifest: ContextManifest,
  createdAt: string,
): JsonObject {
  return {
    protocol: "totally-tubular.proposal/v1",
    principalId: request.principalId,
    leaseId: request.leaseId,
    toolName: contract.name,
    toolVersion: contract.version,
    input,
    resource,
    effect: contract.effect,
    contextManifestId: manifest.id,
    contextManifestDigest: manifest.digest,
    contextSourceIds: manifestSourceIds(manifest),
    createdAt,
    revision: 1,
  };
}

function receiptBody(
  proposal: ActionProposal,
  approval: HumanApproval | undefined,
  result: JsonValue,
  auditEvent: AuditEvent,
  executedAt: string,
): JsonObject {
  return {
    protocol: "totally-tubular.execution-receipt/v1",
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    leaseId: proposal.leaseId,
    approvalId: approval?.id ?? null,
    contextManifestId: proposal.contextManifestId,
    toolName: proposal.toolName,
    resource: proposal.resource,
    effect: proposal.effect,
    result,
    auditEventId: auditEvent.id,
    executedAt,
  };
}

export class TotallyTubularKernel {
  readonly #registry: ContractRegistry;
  readonly #clock: Clock;
  readonly #policy: PolicyEngine;
  readonly #audit: AuditLog;
  readonly #auditReader: AuditReader;
  readonly #approvalTtlMs: number;
  readonly #maxPendingProposalsPerPrincipal: number;
  readonly #approvalAuthorities: ReadonlySet<HumanApprovalAuthority>;
  readonly #leaseIssuerAuthorities: ReadonlySet<LeaseIssuerAuthority>;
  readonly #contextRegistrationAuthorities: ReadonlySet<ContextRegistrationAuthority>;
  readonly #leases = new Map<string, AuthorityLease>();
  readonly #leaseUses = new Map<string, number>();
  readonly #revokedLeaseIds = new Set<string>();
  readonly #manifests = new Map<string, ContextManifest>();
  readonly #executors = new Map<string, ToolExecutor>();
  readonly #proposals = new Map<string, ProposalRecord>();
  readonly #challenges = new Map<string, ApprovalChallenge>();
  readonly #approvals = new Map<string, HumanApproval>();
  readonly #revokedProposalApprovals = new Set<string>();
  readonly #receipts = new Map<string, ExecutionReceipt>();
  readonly #terminalExecutionFailures = new Map<string, OperationRejected>();
  readonly #inFlightExecutions = new Map<string, Promise<ExecutionResult>>();

  constructor(registry: ContractRegistry, clock: Clock, options: KernelOptions = {}) {
    this.#registry = registry;
    this.#clock = clock;
    this.#policy = new PolicyEngine(clock);
    this.#audit = new AuditLog(clock);
    this.#auditReader = Object.freeze({
      entries: () => this.#audit.entries(),
      verify: () => this.#audit.verify(),
    });
    this.#approvalTtlMs = options.approvalTtlMs ?? 15 * 60 * 1_000;
    this.#maxPendingProposalsPerPrincipal =
      options.maxPendingProposalsPerPrincipal ?? 128;
    this.#approvalAuthorities = new Set(options.approvalAuthorities ?? []);
    this.#leaseIssuerAuthorities = new Set(options.leaseIssuerAuthorities ?? []);
    this.#contextRegistrationAuthorities = new Set(
      options.contextRegistrationAuthorities ?? [],
    );
    if (!Number.isSafeInteger(this.#approvalTtlMs) || this.#approvalTtlMs < 1) {
      throw new TypeError("approvalTtlMs must be a positive safe integer");
    }
    if (
      !Number.isSafeInteger(this.#maxPendingProposalsPerPrincipal) ||
      this.#maxPendingProposalsPerPrincipal < 1
    ) {
      throw new TypeError("maxPendingProposalsPerPrincipal must be a positive safe integer");
    }
  }

  get audit(): AuditReader {
    return this.#auditReader;
  }

  registerManifest(
    manifest: ContextManifest,
    authority: ContextRegistrationAuthority,
  ): void {
    if (!this.#contextRegistrationAuthorities.has(authority)) {
      throw new Error("The caller does not possess the context registration authority");
    }
    if (this.#manifests.has(manifest.id)) {
      throw new Error(`Context manifest already registered: ${manifest.id}`);
    }
    const sealed = sealContextManifest(manifest);
    this.#manifests.set(sealed.id, sealed);
    this.#audit.append("context.manifest.registered", authority.registrarId, {
      manifestId: sealed.id,
      manifestDigest: sealed.digest,
      principalId: safeAuditReference(sealed.principalId),
      itemCount: sealed.items.length,
      omittedCount: sealed.omitted.length,
    });
  }

  registerLease(lease: AuthorityLease, authority: LeaseIssuerAuthority): void {
    if (
      !this.#leaseIssuerAuthorities.has(authority) ||
      authority.issuerId !== lease.issuedBy
    ) {
      throw new Error("The caller does not possess the lease issuer authority");
    }
    if (this.#leases.has(lease.id)) {
      throw new Error(`Authority lease already registered: ${lease.id}`);
    }
    const sealed = sealAuthorityLease(lease);
    this.#leases.set(sealed.id, sealed);
    this.#leaseUses.set(sealed.id, 0);
    this.#audit.append("authority.lease.registered", sealed.issuedBy, {
      leaseId: sealed.id,
      leaseDigest: sealed.digest,
      subjectId: sealed.subjectId,
      maxUses: sealed.maxUses,
      effectCeiling: sealed.effectCeiling,
    });
  }

  revokeLease(leaseId: string, authority: LeaseIssuerAuthority): boolean {
    const lease = this.#leases.get(leaseId);
    if (lease === undefined) {
      return false;
    }
    if (
      !this.#leaseIssuerAuthorities.has(authority) ||
      authority.issuerId !== lease.issuedBy
    ) {
      throw new Error("The caller does not possess the lease issuer authority");
    }
    if (this.#revokedLeaseIds.has(leaseId)) {
      return false;
    }
    this.#revokedLeaseIds.add(leaseId);
    this.#audit.append("authority.lease.revoked", authority.issuerId, {
      leaseId,
      leaseDigest: lease.digest,
    });
    return true;
  }

  revokeApproval(proposalId: string, authority: HumanApprovalAuthority): boolean {
    if (!this.#approvalAuthorities.has(authority)) {
      throw new Error("The caller does not possess a human approval authority");
    }
    const approval = this.#approvals.get(proposalId);
    if (approval === undefined || approval.approvedBy !== authority.approverId) {
      return false;
    }
    this.#approvals.delete(proposalId);
    this.#revokedProposalApprovals.add(proposalId);
    this.#audit.append("approval.revoked", authority.approverId, {
      approvalId: approval.id,
      proposalId,
      proposalDigest: approval.proposalDigest,
    });
    return true;
  }

  registerExecutor(executor: ToolExecutor): void {
    if (this.#registry.get(executor.toolName) === undefined) {
      throw new Error(`Cannot bind an executor without a contract: ${executor.toolName}`);
    }
    if (this.#executors.has(executor.toolName)) {
      throw new Error(`Executor already registered: ${executor.toolName}`);
    }
    if (executor.idempotency !== "proposal-id") {
      throw new Error("Trusted executors must deduplicate effects by proposal id");
    }
    const execute = executor.execute.bind(executor);
    this.#executors.set(
      executor.toolName,
      Object.freeze({
        toolName: executor.toolName,
        idempotency: "proposal-id",
        execute,
      }),
    );
  }

  propose(request: ActionRequest): ProposalResult {
    const contract = this.#registry.get(request.toolName);
    if (contract === undefined) {
      return this.#rejectProposal(
        request,
        kernelFailure("TOOL_NOT_FOUND", "No contract exists for this tool.", false),
      );
    }
    const lease = this.#leases.get(request.leaseId);
    if (lease === undefined) {
      return this.#rejectProposal(
        request,
        kernelFailure("LEASE_NOT_FOUND", "The requested authority lease does not exist.", false),
      );
    }
    const manifest = this.#manifests.get(request.contextManifestId);
    if (manifest === undefined) {
      return this.#rejectProposal(
        request,
        kernelFailure("MANIFEST_NOT_FOUND", "The requested context manifest does not exist.", false),
      );
    }
    if (manifest.principalId !== request.principalId) {
      return this.#rejectProposal(
        request,
        kernelFailure(
          "PRINCIPAL_MISMATCH",
          "The context manifest belongs to a different principal.",
          false,
        ),
      );
    }

    const pendingCount = [...this.#proposals.values()].filter(
      (record) =>
        record.proposal.principalId === request.principalId &&
        this.#proposalConsumesPendingSlot(record),
    ).length;
    if (pendingCount >= this.#maxPendingProposalsPerPrincipal) {
      return this.#rejectProposal(
        request,
        kernelFailure(
          "PROPOSAL_LIMIT_REACHED",
          "The principal has reached its pending proposal limit.",
          true,
        ),
      );
    }

    let validated: ReturnType<RegisteredToolContract["validateInput"]>;
    try {
      validated = contract.validateInput(request.input);
    } catch {
      return this.#rejectProposal(
        request,
        kernelFailure(
          "INPUT_INVALID",
          "Input validation failed inside the canonical tool contract.",
          false,
        ),
      );
    }
    if (!validated.ok) {
      return this.#rejectProposal(
        request,
        kernelFailure(
          "INPUT_INVALID",
          "The proposed input failed the canonical tool contract.",
          true,
          validationDetails(validated.issues),
        ),
      );
    }

    const input = deepFreezeJsonObject(validated.value);
    let resource: string;
    try {
      resource = contract.resolveResource(input);
    } catch {
      return this.#rejectProposal(
        request,
        kernelFailure(
          "INPUT_INVALID",
          "Resource resolution failed inside the canonical tool contract.",
          false,
        ),
      );
    }
    const createdAt = this.#clock.now().toISOString();
    const body = proposalBody(request, contract, input, resource, manifest, createdAt);
    const digest = sha256(stableStringify(body));
    const proposal: ActionProposal = Object.freeze({
      protocol: "totally-tubular.proposal/v1",
      id: `proposal_${digest.slice(0, 24)}`,
      principalId: request.principalId,
      leaseId: request.leaseId,
      toolName: contract.name,
      toolVersion: contract.version,
      input,
      resource,
      effect: contract.effect,
      contextManifestId: manifest.id,
      contextManifestDigest: manifest.digest,
      contextSourceIds: Object.freeze([...manifestSourceIds(manifest)]),
      createdAt,
      revision: 1,
      digest,
    });

    const decision = this.#policy.evaluate({
      proposal,
      contract,
      lease,
      manifest,
      leaseUses: this.#leaseUses.get(lease.id) ?? 0,
      leaseRevoked: this.#revokedLeaseIds.has(lease.id),
    });
    this.#audit.append("action.proposed", safeAuditReference(request.principalId), {
      proposalId: proposal.id,
      proposalDigest: proposal.digest,
      leaseId: lease.id,
      toolName: proposal.toolName,
      resourceDigest: sha256(proposal.resource),
      effect: proposal.effect,
      contextManifestId: proposal.contextManifestId,
    });
    this.#audit.append("policy.evaluated", "totally-tubular.kernel", {
      decisionId: decision.id,
      decisionDigest: decision.digest,
      proposalId: proposal.id,
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
    });

    if (decision.outcome === "deny") {
      return {
        ok: false,
        failure: kernelFailure(
          "POLICY_DENIED",
          decision.explanation,
          false,
          { policyReasonCode: decision.reasonCode, decisionId: decision.id },
        ),
      };
    }

    const challenge =
      decision.outcome === "approval-required"
        ? this.#createApprovalChallenge(proposal)
        : null;
    this.#proposals.set(proposal.id, { proposal, decision, challenge });
    return { ok: true, proposal, decision, challenge };
  }

  approve(request: ApproveActionRequest): ApprovalResult {
    if (!this.#approvalAuthorities.has(request.authority)) {
      this.#audit.append("approval.rejected", "totally-tubular.kernel", {
        challengeId: safeAuditReference(request.challengeId),
        proposalId: safeAuditReference(request.proposalId),
        requestedApproverId: safeAuditReference(request.authority.approverId),
        reasonCode: "APPROVER_NOT_AUTHORIZED",
      });
      return {
        ok: false,
        failure: kernelFailure(
          "APPROVER_NOT_AUTHORIZED",
          "The caller does not possess a registered human approval authority.",
          false,
        ),
      };
    }
    const approvedBy = request.authority.approverId;
    if (this.#revokedProposalApprovals.has(request.proposalId)) {
      return {
        ok: false,
        failure: kernelFailure(
          "APPROVAL_REVOKED",
          "Approval for this proposal was revoked. Create a new proposal to continue.",
          false,
        ),
      };
    }
    const challenge = this.#challenges.get(request.challengeId);
    const record = this.#proposals.get(request.proposalId);
    if (challenge === undefined || record === undefined) {
      return {
        ok: false,
        failure: kernelFailure(
          "CHALLENGE_NOT_FOUND",
          "The approval challenge or proposal does not exist.",
          false,
        ),
      };
    }
    if (approvedBy === record.proposal.principalId) {
      this.#audit.append("approval.rejected", approvedBy, {
        challengeId: challenge.id,
        proposalId: record.proposal.id,
        reasonCode: "SELF_APPROVAL_FORBIDDEN",
      });
      return {
        ok: false,
        failure: kernelFailure(
          "APPROVER_NOT_AUTHORIZED",
          "A proposal principal cannot approve its own action.",
          false,
        ),
      };
    }
    const now = this.#clock.now().toISOString();
    if (parseInstant(challenge.expiresAt, "approval challenge expiry") <= Date.parse(now)) {
      return {
        ok: false,
        failure: kernelFailure("APPROVAL_EXPIRED", "The approval challenge has expired.", true),
      };
    }
    const exactMatch =
      challenge.proposalId === request.proposalId &&
      challenge.proposalDigest === request.proposalDigest &&
      challenge.proposalRevision === request.proposalRevision &&
      record.proposal.digest === request.proposalDigest &&
      record.proposal.revision === request.proposalRevision;
    if (!exactMatch) {
      this.#audit.append("approval.rejected", approvedBy, {
        challengeId: safeAuditReference(request.challengeId),
        proposalId: safeAuditReference(request.proposalId),
        reasonCode: "APPROVAL_MISMATCH",
      });
      return {
        ok: false,
        failure: kernelFailure(
          "APPROVAL_MISMATCH",
          "Approval did not match the exact proposal digest and revision.",
          false,
        ),
      };
    }

    const body: JsonObject = {
      protocol: "totally-tubular.human-approval/v1",
      challengeId: challenge.id,
      proposalId: challenge.proposalId,
      proposalDigest: challenge.proposalDigest,
      proposalRevision: challenge.proposalRevision,
      approvedBy,
      approvedAt: now,
      expiresAt: challenge.expiresAt,
    };
    const digest = sha256(stableStringify(body));
    const approval: HumanApproval = Object.freeze({
      protocol: "totally-tubular.human-approval/v1",
      id: `approval_${digest.slice(0, 24)}`,
      challengeId: challenge.id,
      proposalId: challenge.proposalId,
      proposalDigest: challenge.proposalDigest,
      proposalRevision: challenge.proposalRevision,
      approvedBy,
      approvedAt: now,
      expiresAt: challenge.expiresAt,
      digest,
    });
    this.#approvals.set(approval.proposalId, approval);
    this.#audit.append("approval.granted", approvedBy, {
      approvalId: approval.id,
      approvalDigest: approval.digest,
      proposalId: approval.proposalId,
      proposalDigest: approval.proposalDigest,
      proposalRevision: approval.proposalRevision,
    });
    return { ok: true, approval };
  }

  async execute(proposalId: string, signal?: AbortSignal): Promise<ExecutionResult> {
    const receipt = this.#receipts.get(proposalId);
    if (receipt !== undefined) {
      return { ok: true, receipt, replayed: true };
    }
    const terminalFailure = this.#terminalExecutionFailures.get(proposalId);
    if (terminalFailure !== undefined) {
      return terminalFailure;
    }
    const inFlight = this.#inFlightExecutions.get(proposalId);
    if (inFlight !== undefined) {
      const result = await inFlight;
      return result.ok ? { ...result, replayed: true } : result;
    }
    const execution = this.#executeOnce(proposalId, signal);
    this.#inFlightExecutions.set(proposalId, execution);
    try {
      return await execution;
    } finally {
      this.#inFlightExecutions.delete(proposalId);
    }
  }

  getProposalStatus(principalId: string, proposalId: string): ProposalStatusResult {
    const record = this.#proposals.get(proposalId);
    if (record === undefined || record.proposal.principalId !== principalId) {
      return {
        ok: false,
        failure: kernelFailure("PROPOSAL_NOT_FOUND", "The proposal does not exist.", false),
      };
    }
    const receipt = this.#receipts.get(proposalId);
    const terminalFailure = this.#terminalExecutionFailures.get(proposalId);
    const approval = this.#approvals.get(proposalId);
    const lease = this.#leases.get(record.proposal.leaseId);
    const now = this.#clock.now().getTime();
    const authorityInvalid =
      lease === undefined ||
      this.#revokedLeaseIds.has(record.proposal.leaseId) ||
      parseInstant(lease.expiresAt, "lease expiry") <= now ||
      (this.#leaseUses.get(lease.id) ?? 0) >= lease.maxUses;
    const approvalExpired =
      approval !== undefined
        ? parseInstant(approval.expiresAt, "approval expiry") <= now
        : record.challenge !== null &&
          parseInstant(record.challenge.expiresAt, "approval challenge expiry") <= now;
    let state: ProposalState;
    if (receipt !== undefined) {
      state = "succeeded";
    } else if (terminalFailure !== undefined) {
      state = "failed";
    } else if (this.#inFlightExecutions.has(proposalId)) {
      state = "executing";
    } else if (this.#revokedProposalApprovals.has(proposalId)) {
      state = "approval-revoked";
    } else if (authorityInvalid) {
      state = "authority-invalid";
    } else if (approvalExpired) {
      state = "approval-expired";
    } else if (approval !== undefined) {
      state = "approved";
    } else if (record.challenge !== null) {
      state = "pending-approval";
    } else {
      state = "ready";
    }
    return {
      ok: true,
      status: Object.freeze({
        protocol: "totally-tubular.proposal-status/v1",
        proposalId: record.proposal.id,
        proposalDigest: record.proposal.digest,
        toolName: record.proposal.toolName,
        effect: record.proposal.effect,
        policyOutcome: record.decision.outcome,
        state,
        approvalRequired: record.challenge !== null,
        challengeId: record.challenge?.id ?? null,
        challengeExpiresAt: record.challenge?.expiresAt ?? null,
        receiptId: receipt?.id ?? null,
        failureCode: terminalFailure?.failure.code ?? null,
      }),
    };
  }

  #proposalConsumesPendingSlot(record: ProposalRecord): boolean {
    const proposalId = record.proposal.id;
    if (
      this.#receipts.has(proposalId) ||
      this.#terminalExecutionFailures.has(proposalId) ||
      this.#revokedProposalApprovals.has(proposalId)
    ) {
      return false;
    }
    const lease = this.#leases.get(record.proposal.leaseId);
    if (
      lease === undefined ||
      this.#revokedLeaseIds.has(lease.id) ||
      parseInstant(lease.expiresAt, "lease expiry") <= this.#clock.now().getTime() ||
      (this.#leaseUses.get(lease.id) ?? 0) >= lease.maxUses
    ) {
      return false;
    }
    const approval = this.#approvals.get(proposalId);
    if (approval !== undefined) {
      return (
        parseInstant(approval.expiresAt, "approval expiry") >
        this.#clock.now().getTime()
      );
    }
    return (
      record.challenge === null ||
      parseInstant(record.challenge.expiresAt, "approval challenge expiry") >
        this.#clock.now().getTime()
    );
  }

  async #executeOnce(proposalId: string, signal?: AbortSignal): Promise<ExecutionResult> {
    const existing = this.#receipts.get(proposalId);
    if (existing !== undefined) {
      return { ok: true, receipt: existing, replayed: true };
    }
    const record = this.#proposals.get(proposalId);
    if (record === undefined) {
      return {
        ok: false,
        failure: kernelFailure("PROPOSAL_NOT_FOUND", "The proposal does not exist.", false),
      };
    }
    const { proposal } = record;
    const contract = this.#registry.get(proposal.toolName);
    const lease = this.#leases.get(proposal.leaseId);
    const manifest = this.#manifests.get(proposal.contextManifestId);
    if (contract === undefined || lease === undefined || manifest === undefined) {
      return {
        ok: false,
        failure: kernelFailure(
          "POLICY_DENIED",
          "A trusted contract, lease, or context manifest disappeared before execution.",
          false,
        ),
      };
    }
    const decision = this.#policy.evaluate({
      proposal,
      contract,
      lease,
      manifest,
      leaseUses: this.#leaseUses.get(lease.id) ?? 0,
      leaseRevoked: this.#revokedLeaseIds.has(lease.id),
    });
    this.#audit.append("policy.reevaluated", "totally-tubular.kernel", {
      decisionId: decision.id,
      proposalId: proposal.id,
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
    });
    if (decision.outcome === "deny") {
      return {
        ok: false,
        failure: kernelFailure(
          "POLICY_DENIED",
          decision.explanation,
          false,
          { policyReasonCode: decision.reasonCode, decisionId: decision.id },
        ),
      };
    }

    const approval = this.#approvals.get(proposal.id);
    if (decision.outcome === "approval-required") {
      if (this.#revokedProposalApprovals.has(proposal.id)) {
        return {
          ok: false,
          failure: kernelFailure(
            "APPROVAL_REVOKED",
            "Approval for this proposal has been revoked.",
            false,
          ),
        };
      }
      if (approval === undefined) {
        return {
          ok: false,
          failure: kernelFailure(
            "APPROVAL_REQUIRED",
            "This proposal requires exact human approval.",
            true,
          ),
        };
      }
      const approvalMatches =
        approval.proposalDigest === proposal.digest &&
        approval.proposalRevision === proposal.revision;
      if (!approvalMatches) {
        return {
          ok: false,
          failure: kernelFailure(
            "APPROVAL_MISMATCH",
            "The stored approval does not match the executable proposal.",
            false,
          ),
        };
      }
      if (
        parseInstant(approval.expiresAt, "approval expiry") <=
        this.#clock.now().getTime()
      ) {
        return {
          ok: false,
          failure: kernelFailure("APPROVAL_EXPIRED", "The approval has expired.", true),
        };
      }
    }

    const executor = this.#executors.get(proposal.toolName);
    if (executor === undefined) {
      return {
        ok: false,
        failure: kernelFailure(
          "EXECUTOR_NOT_FOUND",
          "No trusted executor is bound to this tool.",
          false,
        ),
      };
    }
    const leaseUseNumber = (this.#leaseUses.get(lease.id) ?? 0) + 1;
    this.#leaseUses.set(lease.id, leaseUseNumber);
    const executionSignal = signal ?? new AbortController().signal;
    this.#audit.append("action.execution.started", "totally-tubular.kernel", {
      proposalId: proposal.id,
      proposalDigest: proposal.digest,
      executorToolName: executor.toolName,
      leaseUseNumber,
    });

    let rawResult: unknown;
    try {
      rawResult = await executor.execute(proposal.input, {
        proposal,
        operationId: proposal.id,
        signal: executionSignal,
      });
    } catch {
      this.#audit.append("action.execution.failed", "totally-tubular.kernel", {
        proposalId: proposal.id,
        reasonCode: "EXECUTION_OUTCOME_UNKNOWN",
      });
      const rejected: OperationRejected = {
        ok: false,
        failure: kernelFailure(
          "EXECUTION_OUTCOME_UNKNOWN",
          "The executor failed after dispatch. The outcome is unknown and automatic retry is blocked.",
          false,
        ),
      };
      this.#terminalExecutionFailures.set(proposal.id, rejected);
      return rejected;
    }

    let validatedResult: ReturnType<RegisteredToolContract["validateOutput"]>;
    try {
      validatedResult = contract.validateOutput(rawResult);
    } catch {
      this.#audit.append("action.execution.failed", "totally-tubular.kernel", {
        proposalId: proposal.id,
        reasonCode: "OUTPUT_VALIDATOR_FAILED",
      });
      const rejected: OperationRejected = {
        ok: false,
        failure: kernelFailure(
          "EXECUTION_OUTCOME_UNKNOWN",
          "Output validation failed after dispatch. Automatic retry is blocked.",
          false,
        ),
      };
      this.#terminalExecutionFailures.set(proposal.id, rejected);
      return rejected;
    }
    if (!validatedResult.ok) {
      this.#audit.append("action.execution.failed", "totally-tubular.kernel", {
        proposalId: proposal.id,
        reasonCode: "OUTPUT_INVALID",
        issueCount: validatedResult.issues.length,
      });
      const rejected: OperationRejected = {
        ok: false,
        failure: kernelFailure(
          "OUTPUT_INVALID",
          "The executor result failed the canonical output contract.",
          false,
          validationDetails(validatedResult.issues),
        ),
      };
      this.#terminalExecutionFailures.set(proposal.id, rejected);
      return rejected;
    }

    const result = deepFreezeJson(validatedResult.value);
    const resultDigest = sha256(stableStringify(result));
    const executedAt = this.#clock.now().toISOString();
    const auditEvent = this.#audit.append("action.effect.completed", executor.toolName, {
      proposalId: proposal.id,
      proposalDigest: proposal.digest,
      resultDigest,
    });
    const body = receiptBody(proposal, approval, result, auditEvent, executedAt);
    const receiptDigest = sha256(stableStringify(body));
    const receipt: ExecutionReceipt = Object.freeze({
      protocol: "totally-tubular.execution-receipt/v1",
      id: `receipt_${receiptDigest.slice(0, 24)}`,
      proposalId: proposal.id,
      proposalDigest: proposal.digest,
      leaseId: proposal.leaseId,
      approvalId: approval?.id ?? null,
      contextManifestId: proposal.contextManifestId,
      toolName: proposal.toolName,
      resource: proposal.resource,
      effect: proposal.effect,
      result,
      auditEventId: auditEvent.id,
      executedAt,
      digest: receiptDigest,
    });
    this.#receipts.set(proposal.id, receipt);
    this.#audit.append("execution.receipt.issued", "totally-tubular.kernel", {
      receiptId: receipt.id,
      receiptDigest: receipt.digest,
      proposalId: proposal.id,
      auditEventId: auditEvent.id,
    });
    return { ok: true, receipt, replayed: false };
  }

  #rejectProposal(request: ActionRequest, failure: KernelFailure): OperationRejected {
    this.#audit.append("action.rejected", "totally-tubular.kernel", {
      principalId: safeAuditReference(request.principalId),
      leaseId: safeAuditReference(request.leaseId),
      toolName: safeAuditReference(request.toolName),
      contextManifestId: safeAuditReference(request.contextManifestId),
      reasonCode: failure.code,
    });
    return { ok: false, failure };
  }

  #createApprovalChallenge(proposal: ActionProposal): ApprovalChallenge {
    const requestedAt = this.#clock.now().toISOString();
    const expiresAt = new Date(
      parseInstant(requestedAt, "approval request time") + this.#approvalTtlMs,
    ).toISOString();
    const body: JsonObject = {
      protocol: "totally-tubular.approval-challenge/v1",
      proposalId: proposal.id,
      proposalDigest: proposal.digest,
      proposalRevision: proposal.revision,
      requestedAt,
      expiresAt,
    };
    const digest = sha256(stableStringify(body));
    const challenge: ApprovalChallenge = Object.freeze({
      protocol: "totally-tubular.approval-challenge/v1",
      id: `challenge_${digest.slice(0, 24)}`,
      proposalId: proposal.id,
      proposalDigest: proposal.digest,
      proposalRevision: proposal.revision,
      requestedAt,
      expiresAt,
      digest,
    });
    this.#challenges.set(challenge.id, challenge);
    this.#audit.append("approval.requested", "totally-tubular.kernel", {
      challengeId: challenge.id,
      challengeDigest: challenge.digest,
      proposalId: proposal.id,
      proposalDigest: proposal.digest,
      proposalRevision: proposal.revision,
      expiresAt: challenge.expiresAt,
    });
    return challenge;
  }

  exportState(): JsonObject {
    return {
      leases: [...this.#leases.values()].map((lease) => authorityLeaseToJson(lease)),
      decisions: [...this.#proposals.values()].map((record) =>
        policyDecisionToJson(record.decision),
      ),
      challenges: [...this.#challenges.values()].map((challenge) =>
        approvalChallengeToJson(challenge),
      ),
      approvals: [...this.#approvals.values()].map((approval) =>
        humanApprovalToJson(approval),
      ),
      receipts: [...this.#receipts.values()].map((receipt) =>
        executionReceiptToJson(receipt),
      ),
      audit: this.#audit.entries().map((event) => ({
        id: event.id,
        sequence: event.sequence,
        type: event.type,
        actorId: event.actorId,
        previousHash: event.previousHash,
        hash: event.hash,
      })),
    };
  }
}
