import type { JsonObject } from "./json.js";

/** Stable categories emitted by the in-memory kernel for validation, authority, approval, and execution failures. */
export type KernelErrorCode =
  | "APPROVAL_EXPIRED"
  | "APPROVAL_MISMATCH"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_REVOKED"
  | "APPROVER_NOT_AUTHORIZED"
  | "CHALLENGE_NOT_FOUND"
  | "CAPABILITY_NOT_GRANTED"
  | "CONTEXT_NOT_GRANTED"
  | "EFFECT_EXCEEDS_LEASE"
  | "EXECUTION_OUTCOME_UNKNOWN"
  | "EXECUTOR_NOT_FOUND"
  | "INPUT_INVALID"
  | "LEASE_EXHAUSTED"
  | "LEASE_EXPIRED"
  | "LEASE_NOT_FOUND"
  | "LEASE_REVOKED"
  | "MANIFEST_NOT_FOUND"
  | "OUTPUT_INVALID"
  | "POLICY_DENIED"
  | "PRINCIPAL_MISMATCH"
  | "PROPOSAL_LIMIT_REACHED"
  | "PROPOSAL_NOT_FOUND"
  | "RESOURCE_NOT_GRANTED"
  | "TOOL_NOT_FOUND";

/** Structured kernel rejection. Details are optional diagnostics and must not be interpreted as authority. */
export interface KernelFailure {
  /** Stable kernel error category for programmatic handling; do not branch on display messages. */
  readonly code: KernelErrorCode;
  /** Human-readable failure explanation with no raw executor exception details. */
  readonly message: string;
  /** Whether this failure may be retried after its stated condition changes; not permission to repeat an uncertain effect. */
  readonly retryable: boolean;
  /** Optional JSON diagnostics intended for trusted hosts; transport adapters should sanitize disclosure. */
  readonly details?: JsonObject;
}

/** Construct a structured kernel failure, omitting details when none were supplied. */
export function kernelFailure(
  code: KernelErrorCode,
  message: string,
  retryable: boolean,
  details?: JsonObject,
): KernelFailure {
  const failure: KernelFailure = { code, message, retryable };
  if (details === undefined) {
    return failure;
  }
  return { ...failure, details };
}
