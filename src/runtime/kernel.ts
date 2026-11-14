import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditReader } from "../audit/audit-log.js";
import { AuditLog } from "../audit/audit-log.js";
import { PolicyEngine } from "../authority/policy.js";
import {
  type ActionProposal,
  type ActionRequest,
  type ApprovalChallenge,
  type AuthorityLease,
  approvalChallengeToJson,
  authorityLeaseToJson,
  type ExecutionReceipt,
  executionReceiptToJson,
  type HumanApproval,
  humanApprovalToJson,
  type PolicyDecision,
  policyDecisionToJson,
  sealAuthorityLease,
} from "../authority/types.js";
import type { ContextManifest } from "../context/manifest.js";
import { manifestSourceIds, sealContextManifest } from "../context/manifest.js";
import type { ContractRegistry } from "../contracts/registry.js";
import type { RegisteredToolContract } from "../contracts/tool-contract.js";
import { type KernelFailure, kernelFailure } from "../core/errors.js";
import {
  deepFreezeJson,
  deepFreezeJsonObject,
  type JsonObject,
  type JsonValue,
  sha256,
  stableStringify,
} from "../core/json.js";
import { type Clock, parseInstant } from "../core/time.js";

/** Trusted dispatch metadata carrying the sealed proposal, idempotency key, and cooperative cancellation signal. */
export interface ExecutorContext {
  /** Immutable validated action and exact context binding retained by the kernel. */
  readonly proposal: ActionProposal;
  /** Proposal identity passed to the executor as its idempotency key; reuse must not repeat the effect. */
  readonly operationId: string;
  /** Cooperative cancellation signal. Aborting does not prove that an already dispatched effect was rolled back. */
  readonly signal: AbortSignal;
}

/** Host-installed effect adapter. It must honor proposal-id deduplication when talking to an external system. */
export interface ToolExecutor {
  /** Exact registered tool name; policy grants match this identifier without aliases. */
  readonly toolName: string;
  /** Required proposal-id deduplication promise; external adapters must substantiate it beyond the kernel's memory. */
  readonly idempotency: "proposal-id";
  /** Perform the trusted effect once per operationId. Output remains unknown until canonical output validation. */
  execute(input: JsonObject, context: ExecutorContext): Promise<unknown>;
}

/** Successfully constructed and evaluated proposal. Acceptance does not imply approval or execution. */
export interface ProposalAccepted {
  /** Discriminator separating the successful branch from a structured rejection; it is not an authorization grant. */
  readonly ok: true;
  /** Immutable validated action and exact context binding retained by the kernel. */
  readonly proposal: ActionProposal;
  /** Policy evaluation for the proposal; approval-required is not permission to execute. */
  readonly decision: PolicyDecision;
  /** Exact-proposal approval request, or null when policy does not require human approval. */
  readonly challenge: ApprovalChallenge | null;
}

/** Kernel failure result that carries no successful proposal, approval, or execution receipt. */
export interface OperationRejected {
  /** Discriminator separating the successful branch from a structured rejection; it is not an authorization grant. */
  readonly ok: false;
  /** Structured rejection reason. Unknown execution outcomes require host reconciliation, not blind retry. */
  readonly failure: KernelFailure;
}

/** Proposal creation result; a successful branch may still require exact human approval. */
export type ProposalResult = ProposalAccepted | OperationRejected;

/** Trusted approval submission matching one challenge, proposal identity, digest, and revision. */
export interface ApproveActionRequest {
  /** Identifier of the kernel-issued challenge that the trusted approver must answer. */
  readonly challengeId: string;
  /** Identity of one submitted proposal, distinct even from an identical independent submission. */
  readonly proposalId: string;
  /** SHA-256 digest of the exact proposal, including its unique identity; approvals must match it. */
  readonly proposalDigest: string;
  /** Revision captured by the approval binding; editing requires a new proposal. */
  readonly proposalRevision: number;
  /** Exact configured approver object supplied by the trusted host, never reconstructed from model fields. */
  readonly authority: HumanApprovalAuthority;
}

/** Exact approval creation result or a structured authority, mismatch, or expiry rejection. */
export type ApprovalResult =
  | {
      /** Discriminator separating the successful branch from a structured rejection; it is not an authorization grant. */
      readonly ok: true;
      /** Immutable exact-proposal approval recorded by the kernel; it cannot authorize a separate submission. */
      readonly approval: HumanApproval;
    }
  | OperationRejected;

/** Validated completion evidence or rejection; replay returns existing evidence without redispatch. */
export type ExecutionResult =
  | {
      /** Discriminator separating the successful branch from a structured rejection; it is not an authorization grant. */
      readonly ok: true;
      /** Validated execution evidence retained for idempotent replay within this kernel instance. */
      readonly receipt: ExecutionReceipt;
      /** True when returning a previously completed receipt without redispatching the executor. */
      readonly replayed: boolean;
    }
  | OperationRejected;

/** Current in-memory lifecycle projection, including uncertain terminal failures and invalidated authority. */
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

/** Sanitized lifecycle view that omits arguments, context content, and executor results. */
export interface SafeProposalStatus extends JsonObject {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.proposal-status/v1";
  /** Identity of one submitted proposal, distinct even from an identical independent submission. */
  readonly proposalId: string;
  /** SHA-256 digest of the exact proposal, including its unique identity; approvals must match it. */
  readonly proposalDigest: string;
  /** Exact registered tool name; policy grants match this identifier without aliases. */
  readonly toolName: string;
  /** Trusted host effect classification checked against the lease ceiling; model arguments cannot select or downgrade it. */
  readonly effect: string;
  /** Most recently projected policy result; execution reevaluates live lease state. */
  readonly policyOutcome: string;
  /** State interaction or lifecycle state, as defined by the containing contract. */
  readonly state: ProposalState;
  /** Whether the contract requires approval of this exact proposal before execution. */
  readonly approvalRequired: boolean;
  /** Identifier of the kernel-issued challenge that the trusted approver must answer. */
  readonly challengeId: string | null;
  /** UTC ISO 8601 challenge expiry, or null when no approval challenge exists. */
  readonly challengeExpiresAt: string | null;
  /** Completed execution receipt identifier, or null before successful completion. */
  readonly receiptId: string | null;
  /** Terminal or current status failure category, or null when no failure applies. */
  readonly failureCode: string | null;
}

/** Principal-scoped status result, rejecting unknown or differently owned proposal identifiers. */
export type ProposalStatusResult =
  | {
      /** Discriminator separating the successful branch from a structured rejection; it is not an authorization grant. */
      readonly ok: true;
      /** Sanitized state for the owning principal, excluding proposal arguments and execution output. */
      readonly status: SafeProposalStatus;
    }
  | OperationRejected;

/** Private sealed proposal with its initial policy decision and optional exact-approval challenge. */
interface ProposalRecord {
  /** Immutable validated action and exact context binding retained by the kernel. */
  readonly proposal: ActionProposal;
  /** Policy evaluation for the proposal; approval-required is not permission to execute. */
  readonly decision: PolicyDecision;
  /** Exact-proposal approval request, or null when policy does not require human approval. */
  readonly challenge: ApprovalChallenge | null;
}

/** Trusted kernel configuration. All state, authority objects, and replay records are process-local. */
export interface KernelOptions {
  /** Host-selected namespace for deterministic tests; defaults to a fresh UUID per kernel. Reusing it across kernels does not provide global uniqueness or durable replay. */
  readonly proposalNamespace?: string;
  /** Positive safe-integer approval lifetime in milliseconds; defaults to 900000 (15 minutes). */
  readonly approvalTtlMs?: number;
  /** Exact host authority objects allowed to approve; defaults to an empty set, denying all approvers. */
  readonly approvalAuthorities?: readonly HumanApprovalAuthority[];
  /** Exact host authority objects allowed to register and revoke leases; defaults to none. */
  readonly leaseIssuerAuthorities?: readonly LeaseIssuerAuthority[];
  /** Exact host authority objects allowed to register context manifests; defaults to none. */
  readonly contextRegistrationAuthorities?: readonly ContextRegistrationAuthority[];
  /** Positive safe-integer cap on active proposals per principal; defaults to 128. */
  readonly maxPendingProposalsPerPrincipal?: number;
}

/** Object-identity capability configured by the host. Matching approverId text alone grants nothing. */
export class HumanApprovalAuthority {
  /** Nonempty label for the trusted approver; authorization also requires the same configured object identity. */
  readonly approverId: string;

  /** Create a frozen capability with a nonempty label; the host must explicitly configure this object in the kernel. */
  constructor(approverId: string) {
    if (approverId.trim().length === 0) {
      throw new TypeError("approverId must not be empty");
    }
    this.approverId = approverId;
    Object.freeze(this);
  }
}

/** Object-identity capability allowing the configured issuer to register and revoke its leases. */
export class LeaseIssuerAuthority {
  /** Nonempty issuer label; matching this string alone does not establish issuer authority. */
  readonly issuerId: string;

  /** Create a frozen issuer capability with a nonempty label; a separate object with the same label is not equivalent. */
  constructor(issuerId: string) {
    if (issuerId.trim().length === 0) {
      throw new TypeError("issuerId must not be empty");
    }
    this.issuerId = issuerId;
    Object.freeze(this);
  }
}

/** Object-identity capability permitting explicit context registration by a configured host registrar. */
export class ContextRegistrationAuthority {
  /** Nonempty registrar label recorded in audit events; the configured object supplies authority. */
  readonly registrarId: string;

  /** Create a frozen registrar capability; only configured object identity authorizes registration. */
  constructor(registrarId: string) {
    if (registrarId.trim().length === 0) {
      throw new TypeError("registrarId must not be empty");
    }
    this.registrarId = registrarId;
    Object.freeze(this);
  }
}

/** Project parser diagnostics into JSON-safe kernel failure details without including invalid argument values. */
function validationDetails(
  issues: readonly {
    /** Slash-delimited location of the invalid contract or value; this is not a filesystem path. */
    readonly path: string;
    /** Stable diagnostic category used for programmatic handling instead of parsing display text. */
    readonly code: string;
    /** Human-readable diagnostic explaining the violated expectation; do not use it as an authority signal. */
    readonly message: string;
  }[],
): JsonObject {
  return {
    issues: issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message,
    })),
  };
}

/** Retain bounded ASCII references or hash other strings so audit fields do not expose arbitrary user text. */
function safeAuditReference(value: string): string {
  return /^[A-Za-z0-9._:/-]{1,128}$/.test(value) ? value : `sha256:${sha256(value)}`;
}

/** Render all approval-bound fields including unique submission identity for canonical proposal hashing. */
function proposalBody(
  id: string,
  request: ActionRequest,
  contract: RegisteredToolContract,
  input: JsonObject,
  resource: string,
  manifest: ContextManifest,
  createdAt: string,
): JsonObject {
  return {
    protocol: "totally-tubular.proposal/v1",
    id,
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

/** Render successful output and its exact proposal, approval, and audit bindings for canonical receipt hashing. */
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

/** In-process policy, approval, execution, and audit boundary. State is ephemeral and offers no cross-process recovery. */
export class TotallyTubularKernel {
  /** Host test namespace or fresh random UUID separating default kernel instances; not a durable node identity. */
  readonly #proposalNamespace: string;
  /** Monotonic bigint submission counter, incremented synchronously so same-tick requests cannot collide. */
  #proposalSequence = 0n;
  /** Canonical tool definitions shared by validation and policy. */
  readonly #registry: ContractRegistry;
  /** Injected time source shared by this component's timestamp and expiry decisions. */
  readonly #clock: Clock;
  /** Evaluator using current lease usage, revocation, effect, context, and approval requirements. */
  readonly #policy: PolicyEngine;
  /** Private append capability for the process-local hash-linked event history. */
  readonly #audit: AuditLog;
  /** Frozen read-only audit view exposed to trusted callers. */
  readonly #auditReader: AuditReader;
  /** Configured challenge lifetime in milliseconds, bounded by lease expiry. */
  readonly #approvalTtlMs: number;
  /** Maximum active proposals counted for one principal before new submissions are rejected. */
  readonly #maxPendingProposalsPerPrincipal: number;
  /** Configured object identities accepted for approval and revocation. */
  readonly #approvalAuthorities: ReadonlySet<HumanApprovalAuthority>;
  /** Configured object identities accepted for lease registration and revocation. */
  readonly #leaseIssuerAuthorities: ReadonlySet<LeaseIssuerAuthority>;
  /** Configured object identities accepted for manifest registration. */
  readonly #contextRegistrationAuthorities: ReadonlySet<ContextRegistrationAuthority>;
  /** Sealed registered leases indexed by content-derived identifier. */
  readonly #leases = new Map<string, AuthorityLease>();
  /** Dispatch reservations per lease, consumed before any awaited executor work. */
  readonly #leaseUses = new Map<string, number>();
  /** Lease revocations retained for the lifetime of this kernel. */
  readonly #revokedLeaseIds = new Set<string>();
  /** Sealed explicit context selections registered by trusted host authorities. */
  readonly #manifests = new Map<string, ContextManifest>();
  /** Host-installed effect adapters indexed by registered tool name. */
  readonly #executors = new Map<string, ToolExecutor>();
  /** Unique submission records retained for status, approval binding, and execution. */
  readonly #proposals = new Map<string, ProposalRecord>();
  /** Exact-proposal approval challenges indexed by challenge identity. */
  readonly #challenges = new Map<string, ApprovalChallenge>();
  /** Accepted human approvals indexed by proposal identity for dispatch-time checks. */
  readonly #approvals = new Map<string, HumanApproval>();
  /** Proposal identities whose accepted approvals have been revoked. */
  readonly #revokedProposalApprovals = new Set<string>();
  /** Successful receipts retained by proposal identity for non-dispatching replay. */
  readonly #receipts = new Map<string, ExecutionReceipt>();
  /** Post-dispatch failures retained to prevent blind retries of potentially completed effects. */
  readonly #terminalExecutionFailures = new Map<string, OperationRejected>();
  /** Shared execution promises reserved before executor entry to coalesce concurrent calls for one proposal. */
  readonly #inFlightExecutions = new Map<string, Promise<ExecutionResult>>();

  /** Create an empty in-process kernel with validated limits and explicit host authority objects; no persistent state is loaded. */
  constructor(registry: ContractRegistry, clock: Clock, options: KernelOptions = {}) {
    this.#proposalNamespace = options.proposalNamespace ?? randomUUID();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(this.#proposalNamespace)) {
      throw new TypeError(
        "proposalNamespace must contain 1 to 64 ASCII letters, digits, underscores, or hyphens",
      );
    }
    this.#registry = registry;
    this.#clock = clock;
    this.#policy = new PolicyEngine(clock);
    this.#audit = new AuditLog(clock);
    this.#auditReader = Object.freeze({
      entries: () => this.#audit.entries(),
      verify: () => this.#audit.verify(),
    });
    this.#approvalTtlMs = options.approvalTtlMs ?? 15 * 60 * 1_000;
    this.#maxPendingProposalsPerPrincipal = options.maxPendingProposalsPerPrincipal ?? 128;
    this.#approvalAuthorities = new Set(options.approvalAuthorities ?? []);
    this.#leaseIssuerAuthorities = new Set(options.leaseIssuerAuthorities ?? []);
    this.#contextRegistrationAuthorities = new Set(options.contextRegistrationAuthorities ?? []);
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

  /** Expose immutable event snapshots and verification without exposing the append capability. */
  get audit(): AuditReader {
    return this.#auditReader;
  }

  /** Require a configured registrar, verify and seal context, reject duplicate registration, and append audit evidence. */
  registerManifest(manifest: ContextManifest, authority: ContextRegistrationAuthority): void {
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

  /** Require the matching configured issuer, verify and seal the lease, and record registration in audit. */
  registerLease(lease: AuthorityLease, authority: LeaseIssuerAuthority): void {
    if (!this.#leaseIssuerAuthorities.has(authority) || authority.issuerId !== lease.issuedBy) {
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

  /** Require the matching issuer capability and record revocation; return false for missing or already revoked leases. */
  revokeLease(leaseId: string, authority: LeaseIssuerAuthority): boolean {
    const lease = this.#leases.get(leaseId);
    if (lease === undefined) {
      return false;
    }
    if (!this.#leaseIssuerAuthorities.has(authority) || authority.issuerId !== lease.issuedBy) {
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

  /** Require a configured approver and revoke the proposal's approval with audit evidence. */
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

  /** Install one trusted adapter for a known contract, requiring proposal-id idempotency and rejecting duplicate adapters. */
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

  /** Validate arguments and host bindings, allocate a unique submission identity, evaluate policy, and audit the result. */
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
        kernelFailure(
          "MANIFEST_NOT_FOUND",
          "The requested context manifest does not exist.",
          false,
        ),
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
    // Reserve identity synchronously. Equal content and clock readings are
    // independent submissions; only executing the same ID is a replay.
    const id = `proposal_${this.#proposalNamespace}_${++this.#proposalSequence}`;
    const body = proposalBody(id, request, contract, input, resource, manifest, createdAt);
    const digest = sha256(stableStringify(body));
    const proposal: ActionProposal = Object.freeze({
      protocol: "totally-tubular.proposal/v1",
      id,
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
        failure: kernelFailure("POLICY_DENIED", decision.explanation, false, {
          policyReasonCode: decision.reasonCode,
          decisionId: decision.id,
        }),
      };
    }

    const challenge =
      decision.outcome === "approval-required" ? this.#createApprovalChallenge(proposal) : null;
    this.#proposals.set(proposal.id, { proposal, decision, challenge });
    return { ok: true, proposal, decision, challenge };
  }

  /** Require exact challenge, proposal identity, digest, revision, unexpired authority, and a configured approver object. */
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

  /** Replay a completed receipt, coalesce in-flight calls, or reserve one dispatch. Unknown outcomes remain terminal until host reconciliation outside this kernel. */
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
    // Publish the in-flight reservation before any trusted executor can run or
    // synchronously re-enter execute. Policy and lease uses are checked inside.
    const execution = Promise.resolve().then(() => this.#executeOnce(proposalId, signal));
    this.#inFlightExecutions.set(proposalId, execution);
    try {
      return await execution;
    } finally {
      this.#inFlightExecutions.delete(proposalId);
    }
  }

  /** Return sanitized lifecycle state only to the owning principal; do not expose arguments, context, or output. */
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

  /** Count only active proposals, excluding completed, failed, expired, or invalidated work. */
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
      return parseInstant(approval.expiresAt, "approval expiry") > this.#clock.now().getTime();
    }
    return (
      record.challenge === null ||
      parseInstant(record.challenge.expiresAt, "approval challenge expiry") >
        this.#clock.now().getTime()
    );
  }

  /** Recheck policy and approval, reserve lease usage synchronously, then dispatch once and audit success or terminal uncertainty. */
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
        failure: kernelFailure("POLICY_DENIED", decision.explanation, false, {
          policyReasonCode: decision.reasonCode,
          decisionId: decision.id,
        }),
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
      if (parseInstant(approval.expiresAt, "approval expiry") <= this.#clock.now().getTime()) {
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

  /** Record a sanitized proposal rejection and return its structured failure without allocating executable work. */
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

  /** Create a challenge bound to identity, digest, and revision with expiry capped by the lease. */
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

  /** Export trusted-host diagnostic state including sensitive proposal data; no import, durable persistence, or recovery protocol is implemented. */
  exportState(): JsonObject {
    return {
      leases: [...this.#leases.values()].map((lease) => authorityLeaseToJson(lease)),
      decisions: [...this.#proposals.values()].map((record) =>
        policyDecisionToJson(record.decision),
      ),
      challenges: [...this.#challenges.values()].map((challenge) =>
        approvalChallengeToJson(challenge),
      ),
      approvals: [...this.#approvals.values()].map((approval) => humanApprovalToJson(approval)),
      receipts: [...this.#receipts.values()].map((receipt) => executionReceiptToJson(receipt)),
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
