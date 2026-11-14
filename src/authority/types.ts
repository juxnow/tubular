import {
  sha256,
  stableStringify,
  type JsonObject,
  type JsonValue,
} from "../core/json.js";
import type { Clock } from "../core/time.js";
import type { EffectClass } from "../contracts/tool-contract.js";

export interface CapabilityGrant {
  readonly toolName: string;
  readonly resourcePatterns: readonly string[];
}

export interface AuthorityLease {
  readonly protocol: "totally-tubular.lease/v1";
  readonly id: string;
  readonly subjectId: string;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly grants: readonly CapabilityGrant[];
  readonly effectCeiling: EffectClass;
  readonly contextManifestDigests: readonly string[];
  readonly maxUses: number;
  readonly digest: string;
}

export interface IssueAuthorityLeaseRequest {
  readonly subjectId: string;
  readonly issuedBy: string;
  readonly expiresAt: string;
  readonly grants: readonly CapabilityGrant[];
  readonly effectCeiling: EffectClass;
  readonly contextManifestDigests: readonly string[];
  readonly maxUses: number;
}

export interface ActionRequest {
  readonly principalId: string;
  readonly leaseId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly contextManifestId: string;
}

export interface ActionProposal {
  readonly protocol: "totally-tubular.proposal/v1";
  readonly id: string;
  readonly principalId: string;
  readonly leaseId: string;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly input: JsonObject;
  readonly resource: string;
  readonly effect: EffectClass;
  readonly contextManifestId: string;
  readonly contextManifestDigest: string;
  readonly contextSourceIds: readonly string[];
  readonly createdAt: string;
  readonly revision: number;
  readonly digest: string;
}

export type PolicyOutcome = "allow" | "approval-required" | "deny";

export interface PolicyDecision {
  readonly protocol: "totally-tubular.policy-decision/v1";
  readonly id: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly leaseId: string;
  readonly outcome: PolicyOutcome;
  readonly reasonCode: string;
  readonly explanation: string;
  readonly evaluatedAt: string;
  readonly digest: string;
}

export interface ApprovalChallenge {
  readonly protocol: "totally-tubular.approval-challenge/v1";
  readonly id: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly proposalRevision: number;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly digest: string;
}

export interface HumanApproval {
  readonly protocol: "totally-tubular.human-approval/v1";
  readonly id: string;
  readonly challengeId: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly proposalRevision: number;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly digest: string;
}

export interface ExecutionReceipt {
  readonly protocol: "totally-tubular.execution-receipt/v1";
  readonly id: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly leaseId: string;
  readonly approvalId: string | null;
  readonly contextManifestId: string;
  readonly toolName: string;
  readonly resource: string;
  readonly effect: EffectClass;
  readonly result: JsonValue;
  readonly auditEventId: string;
  readonly executedAt: string;
  readonly digest: string;
}

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

interface LeaseDigestFields {
  readonly subjectId: string;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly grants: readonly CapabilityGrant[];
  readonly effectCeiling: EffectClass;
  readonly contextManifestDigests: readonly string[];
  readonly maxUses: number;
}

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
    return (
      receipt.digest === digest &&
      receipt.id === `receipt_${digest.slice(0, 24)}`
    );
  } catch {
    return false;
  }
}
