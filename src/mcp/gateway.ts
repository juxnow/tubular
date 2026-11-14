import type { Clock } from "../core/time.js";
import type { JsonObject } from "../core/json.js";
import type {
  ProposalStatusResult,
  SafeProposalStatus,
} from "../runtime/kernel.js";
import type { TotallyTubularKernel } from "../runtime/kernel.js";

export interface AgentBinding {
  readonly principalId: string;
  readonly leaseId: string;
  readonly contextManifestId: string;
}

export interface GatewayError extends JsonObject {
  readonly code: string;
  readonly retryable: boolean;
}

export interface GatewayRejected extends JsonObject {
  readonly protocol: "totally-tubular.mcp-result/v1";
  readonly ok: false;
  readonly error: GatewayError;
}

export interface GatewayAccepted extends JsonObject {
  readonly protocol: "totally-tubular.mcp-result/v1";
  readonly ok: true;
  readonly status: SafeProposalStatus;
}

export type GatewayResult = GatewayAccepted | GatewayRejected;

export interface ProposalOnlyGatewayOptions {
  readonly maxCallsPerWindow?: number;
  readonly windowMs?: number;
}

function validateBinding(binding: AgentBinding): void {
  for (const [name, value] of Object.entries(binding)) {
    if (value.trim().length === 0 || value.length > 128) {
      throw new TypeError(`${name} must contain 1 to 128 characters`);
    }
  }
}

function reject(code: string, retryable: boolean): GatewayRejected {
  return Object.freeze({
    protocol: "totally-tubular.mcp-result/v1",
    ok: false,
    error: Object.freeze({ code, retryable }),
  });
}

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
  readonly #kernel: TotallyTubularKernel;
  readonly #clock: Clock;
  readonly #binding: Readonly<AgentBinding>;
  readonly #maxCallsPerWindow: number;
  readonly #windowMs: number;
  readonly #callTimes: number[] = [];

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
      this.#kernel.getProposalStatus(
        this.#binding.principalId,
        result.proposal.id,
      ),
    );
  }

  status(proposalId: string): GatewayResult {
    if (!this.#reserveCall()) {
      return reject("RATE_LIMITED", true);
    }
    return projectStatus(
      this.#kernel.getProposalStatus(this.#binding.principalId, proposalId),
    );
  }

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
