import type { AuthorityLease } from "../authority/types.js";
import { sealAuthorityLease } from "../authority/types.js";
import { isCanonicalWorkspaceResource } from "../authority/resource.js";
import { CONTEXT_LIMITS, sealContextManifest, type ContextManifest } from "../context/manifest.js";
import { ContractRegistry } from "../contracts/registry.js";
import { defineToolContract } from "../contracts/tool-contract.js";
import { invalid } from "../contracts/schema.js";
import { kernelFailure } from "../core/errors.js";
import { isJsonObject, sha256, stableStringify, type JsonObject, type JsonValue } from "../core/json.js";
import type { Clock } from "../core/time.js";
import {
  TotallyTubularKernel,
  type ContextRegistrationAuthority,
  type ExecutorContext,
  type ExecutionResult,
  type KernelOptions,
  type LeaseIssuerAuthority,
  type ProposalResult,
  type ToolExecutor,
} from "../runtime/kernel.js";
import { validateSchema } from "../type-validation/index.js";
import {
  executeTool,
  snapshotSchema,
  type BoundToolDefinition,
  type ToolDescriptor,
  type ToolInvocationResult,
  type ToolRuntime,
} from "../typed-tools/index.js";

/** Only the sealed, selected manifest is attached to an executing handler. */
export interface GovernedToolContext extends ExecutorContext {
  readonly manifest: ContextManifest;
}

const sessionBrand = Symbol("host-created governed session");
export interface GovernedSession {
  readonly [sessionBrand]: true;
}

export interface OpenGovernedSessionOptions {
  readonly lease: AuthorityLease;
  readonly manifest: ContextManifest;
  readonly leaseIssuer: LeaseIssuerAuthority;
  readonly contextRegistrar: ContextRegistrationAuthority;
}

export interface GovernedToolRuntimeOptions {
  readonly definitions: readonly BoundToolDefinition<GovernedToolContext>[];
  readonly clock: Clock;
  readonly kernelOptions?: KernelOptions;
}

/** Host control surface. Give adapters only list/invoke plus one session token. */
export interface GovernedToolRuntime extends ToolRuntime<GovernedSession> {
  readonly kernel: TotallyTubularKernel;
  openSession(options: OpenGovernedSessionOptions): GovernedSession;
  propose(name: string, input: unknown, session: GovernedSession): ProposalResult;
  execute(proposalId: string, session: GovernedSession, signal?: AbortSignal): Promise<ExecutionResult>;
}

interface SessionRecord {
  readonly principalId: string;
  readonly leaseId: string;
  readonly manifestId: string;
  readonly proposals: Set<string>;
}

/**
 * In-memory integration with the existing kernel. No authorization is inferred
 * from arguments. A host creates sessions using registered authority objects.
 */
export function createGovernedToolRuntime(options: GovernedToolRuntimeOptions): GovernedToolRuntime {
  const registry = new ContractRegistry();
  const manifests = new Map<string, ContextManifest>();
  const leases = new Map<string, AuthorityLease>();
  const sessions = new WeakMap<GovernedSession, SessionRecord>();
  const issuers = new Set(options.kernelOptions?.leaseIssuerAuthorities ?? []);
  const registrars = new Set(options.kernelOptions?.contextRegistrationAuthorities ?? []);
  const descriptors: ToolDescriptor[] = [];
  const executors: ToolExecutor[] = [];

  for (const definition of options.definitions) {
    const inputSchema = snapshotSchema(definition.schemas.inputSchema, definition.name);
    const outputSchema = snapshotSchema(definition.schemas.outputSchema, definition.name);
    if (!isJsonObject(inputSchema) || inputSchema["type"] !== "object" || !isJsonObject(outputSchema)) {
      throw new TypeError(`Governed tool ${definition.name} requires an object input schema and a JSON output schema`);
    }
    const resolveResource = definition.resolveResource;
    if (resolveResource === undefined) throw new TypeError(`Governed tool ${definition.name} requires a resource resolver`);
    const descriptor: ToolDescriptor = Object.freeze({
      name: definition.name,
      description: definition.description,
      effect: definition.effect,
      approval: definition.approval,
      execution: "governed",
      provenance: Object.freeze({ ...definition.provenance }),
      inputSchema,
      outputSchema,
    });
    const version = sha256(stableStringify({
      name: definition.name, description: definition.description, effect: definition.effect,
      approval: definition.approval, provenance: { ...definition.provenance }, inputSchema, outputSchema,
    }));
    registry.register(defineToolContract<JsonObject, JsonValue>({
      name: definition.name,
      version,
      title: definition.name,
      description: definition.description,
      effect: definition.effect,
      approval: definition.approval,
      input: {
        jsonSchema: inputSchema,
        parse(input) {
          const parsed = validateSchema(inputSchema, input);
          if (!parsed.ok) return parsed;
          return isJsonObject(parsed.value) ? { ok: true, value: parsed.value } : invalid("", "type", "Expected an object");
        },
      },
      output: { jsonSchema: outputSchema, parse: output => validateSchema(outputSchema, output) },
      errors: [
        { code: "POLICY_DENIED", description: "The current lease does not authorize this proposal.", retryable: false },
        { code: "APPROVAL_REQUIRED", description: "The exact proposal requires human approval.", retryable: true },
        { code: "EXECUTION_OUTCOME_UNKNOWN", description: "Dispatch failed; reconciliation is required before another proposal.", retryable: false },
        { code: "OUTPUT_INVALID", description: "The handler ran but returned an invalid result; automatic replay will not dispatch again.", retryable: false },
      ],
      semantics: {
        targets: [],
        contexts: [{ name: "selected-context", acceptsKindRefs: ["exact-manifest"], required: true, minItems: 0, maxItems: CONTEXT_LIMITS.maxSelectedSources, maxBytes: CONTEXT_LIMITS.maxManifestBytes }],
        authority: { kind: "all-of", requirements: [
          { kind: "scheme", schemeRef: "capability-lease", claims: { exactContextBinding: true } },
          ...(definition.approval === "exact-human" ? [{ kind: "scheme" as const, schemeRef: "exact-human-approval", claims: { binds: "proposal-digest" } }] : []),
        ] },
        effects: [{ kindRef: definition.effect, occurrence: "possible", targetRef: null, disclosures: [] }],
        execution: { completion: "synchronous", idempotency: "invocation-id", outcomeEvidence: "receipt-required", unknownOutcome: "terminal-reconciliation-required" },
        lifecycleRef: "proposal-execution",
      },
      resolveResource(input) {
        const resource = resolveResource(input);
        if (typeof resource !== "string" || !isCanonicalWorkspaceResource(resource)) {
          throw new TypeError("The current policy requires a canonical workspace resource");
        }
        return resource;
      },
    }));
    descriptors.push(descriptor);
    const handler = definition[executeTool];
    executors.push({
      toolName: definition.name,
      idempotency: "proposal-id" as const,
      async execute(input: unknown, context: ExecutorContext): Promise<unknown> {
        const manifest = manifests.get(context.proposal.contextManifestId);
        if (manifest === undefined || manifest.digest !== context.proposal.contextManifestDigest) throw new Error("Selected context unavailable");
        const parsed = validateSchema(inputSchema, input);
        if (!parsed.ok) throw new Error("Canonical input failed validation before dispatch");
        return handler(parsed.value, Object.freeze({ ...context, manifest }));
      },
    });
  }
  const kernel = new TotallyTubularKernel(registry, options.clock, options.kernelOptions);
  for (const executor of executors) kernel.registerExecutor(executor);
  const catalog = Object.freeze(descriptors);

  function propose(name: string, input: unknown, session: GovernedSession): ProposalResult {
    const record = sessions.get(session);
    if (record === undefined) return { ok: false, failure: kernelFailure("PRINCIPAL_MISMATCH", "A host-created session is required.", false) };
    const result = kernel.propose({ principalId: record.principalId, leaseId: record.leaseId, contextManifestId: record.manifestId, toolName: name, input });
    if (result.ok) record.proposals.add(result.proposal.id);
    return result;
  }

  async function execute(proposalId: string, session: GovernedSession, signal?: AbortSignal): Promise<ExecutionResult> {
    if (!sessions.get(session)?.proposals.has(proposalId)) {
      return { ok: false, failure: kernelFailure("PROPOSAL_NOT_FOUND", "The proposal does not belong to this session.", false) };
    }
    return kernel.execute(proposalId, signal);
  }

  return Object.freeze({
    kernel,
    list: () => catalog,
    openSession(request: OpenGovernedSessionOptions): GovernedSession {
      const manifest = sealContextManifest(request.manifest);
      const lease = sealAuthorityLease(request.lease);
      if (lease.subjectId !== manifest.principalId || !lease.contextManifestDigests.includes(manifest.digest)) {
        throw new TypeError("Session principal and selected context must be bound by the lease");
      }
      // Check registered authority identities even when reusing an existing lease.
      if (!issuers.has(request.leaseIssuer) || !registrars.has(request.contextRegistrar) ||
          lease.issuedBy !== request.leaseIssuer.issuerId) throw new TypeError("Session registration requires host authority");
      if (!manifests.has(manifest.id)) {
        kernel.registerManifest(manifest, request.contextRegistrar);
        manifests.set(manifest.id, manifest);
      }
      if (!leases.has(lease.id)) {
        kernel.registerLease(lease, request.leaseIssuer);
        leases.set(lease.id, lease);
      }
      const session: GovernedSession = Object.freeze({ [sessionBrand]: true as const });
      sessions.set(session, { principalId: lease.subjectId, leaseId: lease.id, manifestId: manifest.id, proposals: new Set() });
      return session;
    },
    propose,
    execute,
    async invoke(name: string, input: unknown, session: GovernedSession): Promise<ToolInvocationResult> {
      const proposed = propose(name, input, session);
      if (!proposed.ok) return { status: "deny", failure: proposed.failure };
      if (proposed.challenge !== null) return { status: "ask", proposalId: proposed.proposal.id, proposalDigest: proposed.proposal.digest };
      const result = await execute(proposed.proposal.id, session);
      if (!result.ok) return { status: "execution_error", failure: result.failure };
      return { status: "success", output: result.receipt.result, receipt: result.receipt, replayed: result.replayed };
    },
  });
}
