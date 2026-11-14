import type { ContextManifest } from "../context/manifest.js";
import { effectAtMost, type RegisteredToolContract } from "../contracts/tool-contract.js";
import { type JsonObject, sha256, stableStringify } from "../core/json.js";
import { type Clock, parseInstant } from "../core/time.js";
import { workspaceResourceMatches } from "./resource.js";
import type { ActionProposal, AuthorityLease, PolicyDecision } from "./types.js";

/** Sealed proposal, contract, context, and current lease state supplied by the trusted kernel. */
export interface PolicyEvaluationRequest {
  /** Immutable validated action and exact context binding retained by the kernel. */
  readonly proposal: ActionProposal;
  /** Canonical registered contract supplying effect, validation, and approval semantics for this proposal. */
  readonly contract: RegisteredToolContract;
  /** Host-issued scoped authority data, verified and sealed before registration. */
  readonly lease: AuthorityLease;
  /** Explicit immutable context snapshot used for this action; registration and lease binding remain required. */
  readonly manifest: ContextManifest;
  /** Number of dispatches already reserved against this lease in the current kernel. */
  readonly leaseUses: number;
  /** Whether the kernel has revoked this lease before the current policy evaluation. */
  readonly leaseRevoked: boolean;
}

/** Bind a policy outcome and explanation to the proposal digest and evaluation time. */
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

/** Deterministic lease policy evaluator. It never executes effects or grants human approval. */
export class PolicyEngine {
  /** Injected time source shared by this component's timestamp and expiry decisions. */
  readonly #clock: Clock;

  /** Capture the trusted clock; evaluation does not mutate lease state. */
  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** Evaluate identity, revocation, expiry, budget, effect, resource, context, and approval requirements in order. */
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

    const localOnlySource = request.manifest.items.find((item) => item.disclosure === "local-only");
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
