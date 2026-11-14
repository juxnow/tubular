import { sha256, stableStringify, type JsonObject } from "../core/json.js";
import { parseInstant, type Clock } from "../core/time.js";
import type { ContextManifest } from "../context/manifest.js";
import { effectAtMost, type RegisteredToolContract } from "../contracts/tool-contract.js";
import { workspaceResourceMatches } from "./resource.js";
import type { ActionProposal, AuthorityLease, PolicyDecision } from "./types.js";

export interface PolicyEvaluationRequest {
  readonly proposal: ActionProposal;
  readonly contract: RegisteredToolContract;
  readonly lease: AuthorityLease;
  readonly manifest: ContextManifest;
  readonly leaseUses: number;
  readonly leaseRevoked: boolean;
}

function makeDecision(
  proposal: ActionProposal,
  outcome: PolicyDecision["outcome"],
  reasonCode: string,
  explanation: string,
  evaluatedAt: string,
): PolicyDecision {
  const body: JsonObject = {
    protocol: "totally-tubular.policy-decision/v1",
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    leaseId: proposal.leaseId,
    outcome,
    reasonCode,
    explanation,
    evaluatedAt,
  };
  const digest = sha256(stableStringify(body));
  return {
    protocol: "totally-tubular.policy-decision/v1",
    id: `decision_${digest.slice(0, 24)}`,
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    leaseId: proposal.leaseId,
    outcome,
    reasonCode,
    explanation,
    evaluatedAt,
    digest,
  };
}

export class PolicyEngine {
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  evaluate(request: PolicyEvaluationRequest): PolicyDecision {
    const evaluatedAt = this.#clock.now().toISOString();
    const now = parseInstant(evaluatedAt, "policy evaluation time");

    if (request.lease.subjectId !== request.proposal.principalId) {
      return makeDecision(
        request.proposal,
        "deny",
        "PRINCIPAL_MISMATCH",
        "The lease belongs to a different principal.",
        evaluatedAt,
      );
    }
    if (request.leaseRevoked) {
      return makeDecision(
        request.proposal,
        "deny",
        "LEASE_REVOKED",
        "The authority lease has been revoked.",
        evaluatedAt,
      );
    }
    if (parseInstant(request.lease.expiresAt, "lease expiry") <= now) {
      return makeDecision(
        request.proposal,
        "deny",
        "LEASE_EXPIRED",
        "The authority lease has expired.",
        evaluatedAt,
      );
    }
    if (request.leaseUses >= request.lease.maxUses) {
      return makeDecision(
        request.proposal,
        "deny",
        "LEASE_EXHAUSTED",
        "The authority lease has no remaining uses.",
        evaluatedAt,
      );
    }
    if (!effectAtMost(request.proposal.effect, request.lease.effectCeiling)) {
      return makeDecision(
        request.proposal,
        "deny",
        "EFFECT_EXCEEDS_LEASE",
        "The tool effect exceeds the lease effect ceiling.",
        evaluatedAt,
      );
    }

    const grants = request.lease.grants.filter(
      (grant) => grant.toolName === request.proposal.toolName,
    );
    if (grants.length === 0) {
      return makeDecision(
        request.proposal,
        "deny",
        "CAPABILITY_NOT_GRANTED",
        "The lease does not grant this tool.",
        evaluatedAt,
      );
    }
    const resourceAllowed = grants.some((grant) =>
      grant.resourcePatterns.some((pattern) =>
        workspaceResourceMatches(pattern, request.proposal.resource),
      ),
    );
    if (!resourceAllowed) {
      return makeDecision(
        request.proposal,
        "deny",
        "RESOURCE_NOT_GRANTED",
        "The requested resource is outside the granted scope.",
        evaluatedAt,
      );
    }

    const localOnlySource = request.manifest.items.find(
      (item) => item.disclosure === "local-only",
    );
    if (localOnlySource !== undefined) {
      return makeDecision(
        request.proposal,
        "deny",
        "DISCLOSURE_NOT_ALLOWED",
        "Local-only context cannot be attached to an agent action.",
        evaluatedAt,
      );
    }
    if (!request.lease.contextManifestDigests.includes(request.manifest.digest)) {
      return makeDecision(
        request.proposal,
        "deny",
        "CONTEXT_NOT_GRANTED",
        "The proposal context manifest is not bound by the lease.",
        evaluatedAt,
      );
    }

    if (request.contract.approval === "exact-human") {
      return makeDecision(
        request.proposal,
        "approval-required",
        "EXACT_HUMAN_APPROVAL",
        "A human must approve this exact proposal digest before execution.",
        evaluatedAt,
      );
    }

    return makeDecision(
      request.proposal,
      "allow",
      "POLICY_SATISFIED",
      "The proposal satisfies the active authority lease.",
      evaluatedAt,
    );
  }
}
