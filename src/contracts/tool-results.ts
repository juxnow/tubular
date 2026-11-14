import type { ExecutionReceipt } from "../authority/types.js";
import type { KernelFailure } from "../core/errors.js";
import type { JsonValue } from "../core/json.js";
import type { SchemaIssue } from "./schema.js";

/** Validated handler output. Receipt fields exist only for governed execution. */
export interface ToolSuccess {
  /** Success means output validation passed; it is not a claim of durable storage. */
  readonly status: "success";
  /** Defensive JSON snapshot of the handler's validated return. */
  readonly output: JsonValue;
  /** Governed completion evidence; absent on the lightweight read-only path. */
  readonly receipt?: ExecutionReceipt;
  /** True when the governed kernel returned an existing receipt without redispatch. */
  readonly replayed?: boolean;
}

/** Input rejected before authorization or handler execution by the lightweight runtime. */
export interface ToolInputValidationFailure {
  /** Stable discriminator used by adapters to distinguish pre-dispatch validation failure. */
  readonly status: "invalid_input";
  /** Field paths and reasons, without echoing the rejected values or host context. */
  readonly issues: readonly SchemaIssue[];
}

/** The handler returned data that violated its output contract; effects cannot be rolled back here. */
export interface ToolOutputValidationFailure {
  /** Invalid output is a post-dispatch failure, not permission to retry an effect. */
  readonly status: "invalid_output";
  /** Output paths and validation reasons; the raw result is not included. */
  readonly issues: readonly SchemaIssue[];
}

/** Execution paused for host approval. This result never approves or resumes itself. */
export interface ToolApprovalPending {
  /** Signals that the host must perform its separate review workflow. */
  readonly status: "ask";
  /** Exact governed proposal to review; absent for a lightweight authorization callback. */
  readonly proposalId?: string;
  /** Digest binding the governed proposal identity and content; absent on the lightweight path. */
  readonly proposalDigest?: string;
}

/** Rejected invocation. The status alone does not establish whether a dispatch began. */
export interface ToolInvocationRejected {
  /** Denial, absent tool, authorization/dispatch failure, or a non-read call needing the governed kernel. */
  readonly status:
    | "deny"
    | "not_found"
    | "authorization_error"
    | "execution_error"
    | "kernel_required";
  /** Host-only kernel detail when available; MCP emits only a sanitized status. */
  readonly failure?: KernelFailure;
}

/** Complete invocation lifecycle result; branch on status before reading branch-specific data. */
export type ToolInvocationResult =
  | ToolSuccess
  | ToolInputValidationFailure
  | ToolOutputValidationFailure
  | ToolApprovalPending
  | ToolInvocationRejected;
