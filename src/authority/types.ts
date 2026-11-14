import type { EffectClass } from "../contracts/tool-contract.js";
import { type JsonObject, type JsonValue, sha256, stableStringify } from "../core/json.js";
import type { Clock } from "../core/time.js";

/** Kernel-local proposal identity: host namespace followed by a positive sequence. This syntax confers no authority. */
export const PROPOSAL_ID_PATTERN = "^proposal_[A-Za-z0-9_-]{1,64}_[1-9][0-9]*$";

/** One explicit tool permission bounded by canonical workspace resource patterns. */
export interface CapabilityGrant {
  /** Exact registered tool name; policy grants match this identifier without aliases. */
  readonly toolName: string;
  /** Canonical workspace URIs or supported terminal wildcards used to bound resource access. */
  readonly resourcePatterns: readonly string[];
}

/** Content-addressed, expiring authority data. Only registration by a configured issuer makes it usable by this kernel. */
export interface AuthorityLease {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.lease/v1";
  /** Content-derived identifier computed from this record's canonical digest; it is not a bearer credential. */
  readonly id: string;
  /** Principal to whom the host grants the lease; must match the proposing principal. */
  readonly subjectId: string;
  /** Issuer identifier matched against a configured host authority object, not a model assertion. */
  readonly issuedBy: string;
  /** Lease issuance instant serialized as UTC ISO 8601 by the injected clock. */
  readonly issuedAt: string;
  /** Expiry timestamp; authorization is invalid at or after this instant, not only after it. */
  readonly expiresAt: string;
  /** Explicit tool and resource permissions; omitted capabilities receive no implicit grant. */
  readonly grants: readonly CapabilityGrant[];
  /** Highest allowed effect in the kernel's ordered effect classes, from read through destructive. */
  readonly effectCeiling: EffectClass;
  /** Exact manifest digests this lease authorizes; no implicit access to other context. */
  readonly contextManifestDigests: readonly string[];
  /** Positive safe-integer dispatch budget. A dispatched attempt consumes a use even if its outcome becomes unknown. */
  readonly maxUses: number;
  /** Lowercase SHA-256 hex over the canonical record body, excluding the derived id and digest; this proves integrity, not authenticity. */
  readonly digest: string;
}

/** Trusted issuer inputs for a scoped lease; issuance creates data and does not register it automatically. */
export interface IssueAuthorityLeaseRequest {
  /** Principal to whom the host grants the lease; must match the proposing principal. */
  readonly subjectId: string;
  /** Issuer identifier matched against a configured host authority object, not a model assertion. */
  readonly issuedBy: string;
  /** Expiry timestamp; authorization is invalid at or after this instant, not only after it. */
  readonly expiresAt: string;
  /** Explicit tool and resource permissions; omitted capabilities receive no implicit grant. */
  readonly grants: readonly CapabilityGrant[];
  /** Highest allowed effect in the kernel's ordered effect classes, from read through destructive. */
  readonly effectCeiling: EffectClass;
  /** Exact manifest digests this lease authorizes; no implicit access to other context. */
  readonly contextManifestDigests: readonly string[];
  /** Positive safe-integer dispatch budget. A dispatched attempt consumes a use even if its outcome becomes unknown. */
  readonly maxUses: number;
}

/** Host-established identity and context plus untrusted tool arguments submitted for proposal creation. */
export interface ActionRequest {
  /** Host-established principal identifier. Tool arguments must not supply or override this identity. */
  readonly principalId: string;
  /** Identifier of the host-registered authority lease evaluated for this action. */
  readonly leaseId: string;
  /** Exact registered tool name; policy grants match this identifier without aliases. */
  readonly toolName: string;
  /** Untrusted capability input. Validate it before dispatch; its fields never establish host authority. */
  readonly input: unknown;
  /** Identifier of the explicit context manifest registered by the trusted host. */
  readonly contextManifestId: string;
}

/** Sealed action with a unique submission identity and a digest covering identity, arguments, resource, context, and timestamp. */
export interface ActionProposal {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.proposal/v1";
  /** Unique namespace plus monotonic per-kernel sequence. Identical independent submissions receive different identities. */
  readonly id: string;
  /** Host-established principal identifier. Tool arguments must not supply or override this identity. */
  readonly principalId: string;
  /** Identifier of the host-registered authority lease evaluated for this action. */
  readonly leaseId: string;
  /** Exact registered tool name; policy grants match this identifier without aliases. */
  readonly toolName: string;
  /** Contract version captured when the proposal was created. */
  readonly toolVersion: string;
  /** Untrusted capability input. Validate it before dispatch; its fields never establish host authority. */
  readonly input: JsonObject;
  /** Canonical logical workspace URI selected for the operation; it does not grant filesystem access. */
  readonly resource: string;
  /** Trusted host effect classification checked against the lease ceiling; model arguments cannot select or downgrade it. */
  readonly effect: EffectClass;
  /** Identifier of the explicit context manifest registered by the trusted host. */
  readonly contextManifestId: string;
  /** SHA-256 digest binding the selected context content and metadata. */
  readonly contextManifestDigest: string;
  /** Source identifiers included in the selected manifest, excluding omitted sources. */
  readonly contextSourceIds: readonly string[];
  /** Creation instant serialized as UTC ISO 8601 by the injected clock. */
  readonly createdAt: string;
  /** Currently always 1 because editing creates a new proposal identity rather than mutating an existing proposal. */
  readonly revision: number;
  /** SHA-256 of the entire sealed proposal body including id; approvals cannot transfer to another submission. */
  readonly digest: string;
}

/** Allow proceeds to other execution checks; approval-required pauses for an exact human grant; deny blocks dispatch. */
export type PolicyOutcome = "allow" | "approval-required" | "deny";

/** Content-addressed evidence of one policy evaluation, bound to one exact proposal. */
export interface PolicyDecision {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.policy-decision/v1";
  /** Content-derived identifier computed from this record's canonical digest; it is not a bearer credential. */
  readonly id: string;
  /** Identity of one submitted proposal, distinct even from an identical independent submission. */
  readonly proposalId: string;
  /** SHA-256 digest of the exact proposal, including its unique identity; approvals must match it. */
  readonly proposalDigest: string;
  /** Identifier of the host-registered authority lease evaluated for this action. */
  readonly leaseId: string;
  /** Allow, approval-required, or deny from the current evaluation; later execution reevaluates live authority. */
  readonly outcome: PolicyOutcome;
  /** Machine-readable reason for the policy result; explanations are display text only. */
  readonly reasonCode: string;
  /** Human-readable policy rationale without authority-bearing instructions. */
  readonly explanation: string;
  /** Instant of this policy evaluation, serialized as UTC ISO 8601. */
  readonly evaluatedAt: string;
  /** Lowercase SHA-256 hex over the canonical record body, excluding the derived id and digest; this proves integrity, not authenticity. */
  readonly digest: string;
}

/** Time-bounded request for approval of a proposal's identity, digest, and revision. */
export interface ApprovalChallenge {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.approval-challenge/v1";
  /** Content-derived identifier computed from this record's canonical digest; it is not a bearer credential. */
  readonly id: string;
  /** Identity of one submitted proposal, distinct even from an identical independent submission. */
  readonly proposalId: string;
  /** SHA-256 digest of the exact proposal, including its unique identity; approvals must match it. */
  readonly proposalDigest: string;
  /** Revision captured by the approval binding; editing requires a new proposal. */
  readonly proposalRevision: number;
  /** Challenge creation instant serialized as UTC ISO 8601 by the injected clock. */
  readonly requestedAt: string;
  /** Expiry timestamp; authorization is invalid at or after this instant, not only after it. */
  readonly expiresAt: string;
  /** Lowercase SHA-256 hex over the canonical record body, excluding the derived id and digest; this proves integrity, not authenticity. */
  readonly digest: string;
}

/** Kernel-recorded approval by a configured host authority, valid only for the challenge's exact proposal. */
export interface HumanApproval {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.human-approval/v1";
  /** Content-derived identifier computed from this record's canonical digest; it is not a bearer credential. */
  readonly id: string;
  /** Identifier of the kernel-issued challenge that the trusted approver must answer. */
  readonly challengeId: string;
  /** Identity of one submitted proposal, distinct even from an identical independent submission. */
  readonly proposalId: string;
  /** SHA-256 digest of the exact proposal, including its unique identity; approvals must match it. */
  readonly proposalDigest: string;
  /** Revision captured by the approval binding; editing requires a new proposal. */
  readonly proposalRevision: number;
  /** Identifier of the configured host authority that approved this exact proposal. */
  readonly approvedBy: string;
  /** Approval creation instant serialized as UTC ISO 8601 by the injected clock. */
  readonly approvedAt: string;
  /** Expiry timestamp; authorization is invalid at or after this instant, not only after it. */
  readonly expiresAt: string;
  /** Lowercase SHA-256 hex over the canonical record body, excluding the derived id and digest; this proves integrity, not authenticity. */
  readonly digest: string;
}

/** Immutable successful execution evidence. Replaying its proposal returns this receipt without redispatch. */
export interface ExecutionReceipt {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.execution-receipt/v1";
  /** Content-derived identifier computed from this record's canonical digest; it is not a bearer credential. */
  readonly id: string;
  /** Identity of one submitted proposal, distinct even from an identical independent submission. */
  readonly proposalId: string;
  /** SHA-256 digest of the exact proposal, including its unique identity; approvals must match it. */
  readonly proposalDigest: string;
  /** Identifier of the host-registered authority lease evaluated for this action. */
  readonly leaseId: string;
  /** Approval consumed by this execution, or null when the contract required no human approval. */
  readonly approvalId: string | null;
  /** Identifier of the explicit context manifest registered by the trusted host. */
  readonly contextManifestId: string;
  /** Exact registered tool name; policy grants match this identifier without aliases. */
  readonly toolName: string;
  /** Canonical logical workspace URI selected for the operation; it does not grant filesystem access. */
  readonly resource: string;
  /** Trusted host effect classification checked against the lease ceiling; model arguments cannot select or downgrade it. */
  readonly effect: EffectClass;
  /** Validated executor output frozen before audit and receipt construction. */
  readonly result: JsonValue;
  /** Identifier of the append-only event recording this completed effect. */
  readonly auditEventId: string;
  /** Instant recorded after output validation and effect completion, serialized as UTC ISO 8601. */
  readonly executedAt: string;
  /** Lowercase SHA-256 hex over the canonical record body, excluding the derived id and digest; this proves integrity, not authenticity. */
  readonly digest: string;
}

/** Render explicit tool and resource grant fields for canonical lease hashing. */
function grantToJson(grant: CapabilityGrant): JsonObject {
  return {
    toolName: grant.toolName,
    resourcePatterns: grant.resourcePatterns,
  };
}

const effectClasses = new Set<EffectClass>([
  "read",
  "draft",
  "workspace-write",
  "external-write",
  "destructive",
]);

/** Authority-bearing lease fields included in canonical hashing, excluding derived identifiers. */
interface LeaseDigestFields {
  /** Principal to whom the host grants the lease; must match the proposing principal. */
  readonly subjectId: string;
  /** Issuer identifier matched against a configured host authority object, not a model assertion. */
  readonly issuedBy: string;
  /** Lease issuance instant serialized as UTC ISO 8601 by the injected clock. */
  readonly issuedAt: string;
  /** Expiry timestamp; authorization is invalid at or after this instant, not only after it. */
  readonly expiresAt: string;
  /** Explicit tool and resource permissions; omitted capabilities receive no implicit grant. */
  readonly grants: readonly CapabilityGrant[];
  /** Highest allowed effect in the kernel's ordered effect classes, from read through destructive. */
  readonly effectCeiling: EffectClass;
  /** Exact manifest digests this lease authorizes; no implicit access to other context. */
  readonly contextManifestDigests: readonly string[];
  /** Positive safe-integer dispatch budget. A dispatched attempt consumes a use even if its outcome becomes unknown. */
  readonly maxUses: number;
}

/** Render only authority-bearing lease fields, excluding the derived identifier and digest. */
function leaseDigestBody(fields: LeaseDigestFields): JsonObject {
  return {
    protocol: "totally-tubular.lease/v1",
    subjectId: fields.subjectId,
    issuedBy: fields.issuedBy,
    issuedAt: fields.issuedAt,
    expiresAt: fields.expiresAt,
    grants: fields.grants.map((grant) => grantToJson(grant)),
    effectCeiling: fields.effectCeiling,
    contextManifestDigests: fields.contextManifestDigests,
    maxUses: fields.maxUses,
  };
}

/** Render the authority lease including explicit grants and exact context digest bindings as plain JSON for serialization and hashing. */
export function authorityLeaseToJson(lease: AuthorityLease): JsonObject {
  return {
    protocol: lease.protocol,
    id: lease.id,
    subjectId: lease.subjectId,
    issuedBy: lease.issuedBy,
    issuedAt: lease.issuedAt,
    expiresAt: lease.expiresAt,
    grants: lease.grants.map((grant) => grantToJson(grant)),
    effectCeiling: lease.effectCeiling,
    contextManifestDigests: lease.contextManifestDigests,
    maxUses: lease.maxUses,
    digest: lease.digest,
  };
}

/** Validate issuer-supplied lease bounds and produce content-addressed data; host registration is still required. */
export function issueAuthorityLease(
  request: IssueAuthorityLeaseRequest,
  clock: Clock,
): AuthorityLease {
  if (!Number.isSafeInteger(request.maxUses) || request.maxUses < 1) {
    throw new TypeError("maxUses must be a positive safe integer");
  }
  if (request.grants.length === 0) {
    throw new TypeError("An authority lease must grant at least one capability");
  }
  const issuedAt = clock.now().toISOString();
  const expiresAtEpoch = Date.parse(request.expiresAt);
  if (!Number.isFinite(expiresAtEpoch)) {
    throw new TypeError("expiresAt must be a valid ISO-8601 instant");
  }
  if (expiresAtEpoch <= Date.parse(issuedAt)) {
    throw new TypeError("expiresAt must be later than issuedAt");
  }
  const body = leaseDigestBody({
    subjectId: request.subjectId,
    issuedBy: request.issuedBy,
    issuedAt,
    expiresAt: request.expiresAt,
    grants: request.grants,
    effectCeiling: request.effectCeiling,
    contextManifestDigests: request.contextManifestDigests,
    maxUses: request.maxUses,
  });
  const digest = sha256(stableStringify(body));
  const grants = Object.freeze(
    request.grants.map((grant) =>
      Object.freeze({
        toolName: grant.toolName,
        resourcePatterns: Object.freeze([...grant.resourcePatterns]),
      }),
    ),
  );
  const contextManifestDigests = Object.freeze([...request.contextManifestDigests]);
  return Object.freeze({
    protocol: "totally-tubular.lease/v1",
    id: `lease_${digest.slice(0, 24)}`,
    subjectId: request.subjectId,
    issuedBy: request.issuedBy,
    issuedAt,
    expiresAt: request.expiresAt,
    grants,
    effectCeiling: request.effectCeiling,
    contextManifestDigests,
    maxUses: request.maxUses,
    digest,
  });
}

/** Check lease structure, lifetime, usage bounds, and canonical digest; this does not authenticate the issuer. */
export function verifyAuthorityLeaseIntegrity(lease: AuthorityLease): boolean {
  try {
    if (
      lease.protocol !== "totally-tubular.lease/v1" ||
      lease.subjectId.length === 0 ||
      lease.issuedBy.length === 0 ||
      !effectClasses.has(lease.effectCeiling) ||
      !Number.isSafeInteger(lease.maxUses) ||
      lease.maxUses < 1 ||
      lease.grants.length === 0
    ) {
      return false;
    }
    const issuedAt = Date.parse(lease.issuedAt);
    const expiresAt = Date.parse(lease.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
      return false;
    }
    if (
      lease.grants.some(
        (grant) =>
          grant.toolName.length === 0 ||
          grant.resourcePatterns.length === 0 ||
          grant.resourcePatterns.some((pattern) => pattern.length === 0),
      ) ||
      lease.contextManifestDigests.some((digest) => !/^[a-f0-9]{64}$/.test(digest))
    ) {
      return false;
    }
    const expectedDigest = sha256(
      stableStringify(
        leaseDigestBody({
          subjectId: lease.subjectId,
          issuedBy: lease.issuedBy,
          issuedAt: lease.issuedAt,
          expiresAt: lease.expiresAt,
          grants: lease.grants,
          effectCeiling: lease.effectCeiling,
          contextManifestDigests: lease.contextManifestDigests,
          maxUses: lease.maxUses,
        }),
      ),
    );
    return lease.digest === expectedDigest && lease.id === `lease_${expectedDigest.slice(0, 24)}`;
  } catch {
    return false;
  }
}

/** Verify then detach and freeze the lease's nested grants and digest bindings; throw on invalid integrity. */
export function sealAuthorityLease(lease: AuthorityLease): AuthorityLease {
  if (!verifyAuthorityLeaseIntegrity(lease)) {
    throw new TypeError("Authority lease failed its integrity check");
  }
  const grants = Object.freeze(
    lease.grants.map((grant) =>
      Object.freeze({
        toolName: grant.toolName,
        resourcePatterns: Object.freeze([...grant.resourcePatterns]),
      }),
    ),
  );
  return Object.freeze({
    ...lease,
    grants,
    contextManifestDigests: Object.freeze([...lease.contextManifestDigests]),
  });
}

/** Render the sealed proposal including unique submission identity and approval-bound digest as plain JSON for serialization and hashing. */
export function actionProposalToJson(proposal: ActionProposal): JsonObject {
  return {
    protocol: proposal.protocol,
    id: proposal.id,
    principalId: proposal.principalId,
    leaseId: proposal.leaseId,
    toolName: proposal.toolName,
    toolVersion: proposal.toolVersion,
    input: proposal.input,
    resource: proposal.resource,
    effect: proposal.effect,
    contextManifestId: proposal.contextManifestId,
    contextManifestDigest: proposal.contextManifestDigest,
    contextSourceIds: proposal.contextSourceIds,
    createdAt: proposal.createdAt,
    revision: proposal.revision,
    digest: proposal.digest,
  };
}

/** Render the proposal-bound policy result and rationale as plain JSON for serialization and hashing. */
export function policyDecisionToJson(decision: PolicyDecision): JsonObject {
  return {
    protocol: decision.protocol,
    id: decision.id,
    proposalId: decision.proposalId,
    proposalDigest: decision.proposalDigest,
    leaseId: decision.leaseId,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
    explanation: decision.explanation,
    evaluatedAt: decision.evaluatedAt,
    digest: decision.digest,
  };
}

/** Render the exact-proposal challenge including its expiry as plain JSON for serialization and hashing. */
export function approvalChallengeToJson(challenge: ApprovalChallenge): JsonObject {
  return {
    protocol: challenge.protocol,
    id: challenge.id,
    proposalId: challenge.proposalId,
    proposalDigest: challenge.proposalDigest,
    proposalRevision: challenge.proposalRevision,
    requestedAt: challenge.requestedAt,
    expiresAt: challenge.expiresAt,
    digest: challenge.digest,
  };
}

/** Render the accepted human approval and exact challenge binding as plain JSON for serialization and hashing. */
export function humanApprovalToJson(approval: HumanApproval): JsonObject {
  return {
    protocol: approval.protocol,
    id: approval.id,
    challengeId: approval.challengeId,
    proposalId: approval.proposalId,
    proposalDigest: approval.proposalDigest,
    proposalRevision: approval.proposalRevision,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
    digest: approval.digest,
  };
}

/** Render the validated receipt including proposal, approval, and audit references as plain JSON for serialization and hashing. */
export function executionReceiptToJson(receipt: ExecutionReceipt): JsonObject {
  return {
    protocol: receipt.protocol,
    id: receipt.id,
    proposalId: receipt.proposalId,
    proposalDigest: receipt.proposalDigest,
    leaseId: receipt.leaseId,
    approvalId: receipt.approvalId,
    contextManifestId: receipt.contextManifestId,
    toolName: receipt.toolName,
    resource: receipt.resource,
    effect: receipt.effect,
    result: receipt.result,
    auditEventId: receipt.auditEventId,
    executedAt: receipt.executedAt,
    digest: receipt.digest,
  };
}

/** Recompute receipt identity and digest; this integrity check does not prove an external effect occurred. */
export function verifyExecutionReceiptIntegrity(receipt: ExecutionReceipt): boolean {
  try {
    if (
      receipt.protocol !== "totally-tubular.execution-receipt/v1" ||
      !effectClasses.has(receipt.effect) ||
      !Number.isFinite(Date.parse(receipt.executedAt)) ||
      receipt.proposalId.length === 0 ||
      !/^[a-f0-9]{64}$/.test(receipt.proposalDigest) ||
      receipt.leaseId.length === 0 ||
      receipt.contextManifestId.length === 0 ||
      receipt.toolName.length === 0 ||
      receipt.resource.length === 0 ||
      receipt.auditEventId.length === 0
    ) {
      return false;
    }
    const body: JsonObject = {
      protocol: receipt.protocol,
      proposalId: receipt.proposalId,
      proposalDigest: receipt.proposalDigest,
      leaseId: receipt.leaseId,
      approvalId: receipt.approvalId,
      contextManifestId: receipt.contextManifestId,
      toolName: receipt.toolName,
      resource: receipt.resource,
      effect: receipt.effect,
      result: receipt.result,
      auditEventId: receipt.auditEventId,
      executedAt: receipt.executedAt,
    };
    const digest = sha256(stableStringify(body));
    return receipt.digest === digest && receipt.id === `receipt_${digest.slice(0, 24)}`;
  } catch {
    return false;
  }
}
