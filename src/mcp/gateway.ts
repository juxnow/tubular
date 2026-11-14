import type { JsonObject } from "../core/json.js";
import type { Clock } from "../core/time.js";
import type {
  ProposalStatusResult,
  SafeProposalStatus,
  TotallyTubularKernel,
} from "../runtime/kernel.js";

/** Frozen host-established principal, lease, and context selection for one proposal-only gateway. */
export interface AgentBinding {
  /** Host-established principal identifier. Tool arguments must not supply or override this identity. */
  readonly principalId: string;
  /** Identifier of the host-registered authority lease evaluated for this action. */
  readonly leaseId: string;
  /** Identifier of the explicit context manifest registered by the trusted host. */
  readonly contextManifestId: string;
}

/** Sanitized gateway failure without raw arguments, context contents, or execution output. */
export interface GatewayError extends JsonObject {
  /** Stable diagnostic category used for programmatic handling instead of parsing display text. */
  readonly code: string;
  /** Whether this failure may be retried after its stated condition changes; not permission to repeat an uncertain effect. */
  readonly retryable: boolean;
}

/** Native gateway rejection envelope; no effect is dispatched by this response. */
export interface GatewayRejected extends JsonObject {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.mcp-result/v1";
  /** Discriminator separating the successful branch from a structured rejection; it is not an authorization grant. */
  readonly ok: false;
  /** Sanitized failure code and retry guidance without raw input, context, or executor details. */
  readonly error: GatewayError;
}

/** Gateway status envelope exposing proposal lifecycle without sensitive proposal contents. */
export interface GatewayAccepted extends JsonObject {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "totally-tubular.mcp-result/v1";
  /** Discriminator separating the successful branch from a structured rejection; it is not an authorization grant. */
  readonly ok: true;
  /** Principal-scoped proposal state with sensitive arguments and context omitted. */
  readonly status: SafeProposalStatus;
}

/** Discriminated proposal-only gateway response, suitable for serialization to an untrusted client. */
export type GatewayResult = GatewayAccepted | GatewayRejected;

/** Host-selected local request limits; these do not replace transport byte limits or authentication. */
export interface ProposalOnlyGatewayOptions {
  /** Positive safe-integer gateway call budget for one rate-limit window; defaults to 60. */
  readonly maxCallsPerWindow?: number;
  /** Positive safe-integer rate-limit window duration in milliseconds; defaults to 60000. */
  readonly windowMs?: number;
}

/** Reject empty or oversized host binding identifiers before exposing a model-facing gateway. */
function validateBinding(binding: AgentBinding): void {
  for (const [name, value] of Object.entries(binding)) {
    if (value.trim().length === 0 || value.length > 128) {
      throw new TypeError(`${name} must contain 1 to 128 characters`);
    }
  }
}

/** Construct a sanitized immutable gateway rejection without leaking raw kernel details. */
function reject(code: string, retryable: boolean): GatewayRejected {
  return Object.freeze({
    protocol: "totally-tubular.mcp-result/v1",
    ok: false,
    error: Object.freeze({ code, retryable }),
  });
}

/** Convert a principal-scoped kernel status into a safe native gateway result. */
function projectStatus(result: ProposalStatusResult): GatewayResult {
  if (!result.ok) {
    return reject(result.failure.code, result.failure.retryable);
  }
  return Object.freeze({
    protocol: "totally-tubular.mcp-result/v1",
    ok: true,
    status: result.status,
  });
}

/**
 * The complete model-facing authority surface.
 *
 * The binding is supplied by a trusted launcher. Model arguments can never
 * select a principal, lease, context manifest, approver, or executor.
 */
export class ProposalOnlyGateway {
  /** Trusted kernel reachable only through proposal creation and sanitized status operations in this gateway. */
  readonly #kernel: TotallyTubularKernel;
  /** Injected time source shared by this component's timestamp and expiry decisions. */
  readonly #clock: Clock;
  /** Frozen host identity, lease, and context selection that model input cannot replace. */
  readonly #binding: Readonly<AgentBinding>;
  /** Maximum accepted proposal and status calls in the configured sliding window. */
  readonly #maxCallsPerWindow: number;
  /** Sliding-window duration in milliseconds, measured using the injected clock. */
  readonly #windowMs: number;
  /** Accepted call times in epoch milliseconds retained until their rate-limit window expires. */
  readonly #callTimes: number[] = [];

  /** Capture the host binding and validate local rate limits; no model-callable approval or execution methods are created. */
  constructor(
    kernel: TotallyTubularKernel,
    clock: Clock,
    binding: AgentBinding,
    options: ProposalOnlyGatewayOptions = {},
  ) {
    validateBinding(binding);
    this.#kernel = kernel;
    this.#clock = clock;
    this.#binding = Object.freeze({ ...binding });
    this.#maxCallsPerWindow = options.maxCallsPerWindow ?? 60;
    this.#windowMs = options.windowMs ?? 60_000;
    if (
      !Number.isSafeInteger(this.#maxCallsPerWindow) ||
      this.#maxCallsPerWindow < 1 ||
      !Number.isSafeInteger(this.#windowMs) ||
      this.#windowMs < 1
    ) {
      throw new TypeError("Gateway rate limits must be positive safe integers");
    }
  }

  /** Rate-limit and create a fresh proposal under the fixed host binding, returning sanitized status only. */
  propose(toolName: string, input: unknown): GatewayResult {
    if (!this.#reserveCall()) {
      return reject("RATE_LIMITED", true);
    }
    const result = this.#kernel.propose({
      principalId: this.#binding.principalId,
      leaseId: this.#binding.leaseId,
      contextManifestId: this.#binding.contextManifestId,
      toolName,
      input,
    });
    if (!result.ok) {
      return reject(result.failure.code, result.failure.retryable);
    }
    return projectStatus(
      this.#kernel.getProposalStatus(this.#binding.principalId, result.proposal.id),
    );
  }

  /** Rate-limit and return status only for proposals owned by the bound principal. */
  status(proposalId: string): GatewayResult {
    if (!this.#reserveCall()) {
      return reject("RATE_LIMITED", true);
    }
    return projectStatus(this.#kernel.getProposalStatus(this.#binding.principalId, proposalId));
  }

  /** Expire old timestamps and reserve one call slot before handling a request. */
  #reserveCall(): boolean {
    const now = this.#clock.now().getTime();
    const start = now - this.#windowMs;
    let discard = 0;
    while (
      discard < this.#callTimes.length &&
      (this.#callTimes[discard] ?? Number.POSITIVE_INFINITY) <= start
    ) {
      discard += 1;
    }
    if (discard > 0) {
      this.#callTimes.splice(0, discard);
    }
    if (this.#callTimes.length >= this.#maxCallsPerWindow) {
      return false;
    }
    this.#callTimes.push(now);
    return true;
  }
}
