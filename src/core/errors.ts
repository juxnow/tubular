import type { JsonObject } from "./json.js";

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

export interface KernelFailure {
  readonly code: KernelErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: JsonObject;
}

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
