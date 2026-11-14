import { isCanonicalWorkspaceResource } from "../authority/resource.js";
import type { AuthorityLease } from "../authority/types.js";
import { sealAuthorityLease } from "../authority/types.js";
import { CONTEXT_LIMITS, type ContextManifest, sealContextManifest } from "../context/manifest.js";
import { ContractRegistry } from "../contracts/registry.js";
import { invalid } from "../contracts/schema.js";
import { defineToolContract } from "../contracts/tool-contract.js";
import { kernelFailure } from "../core/errors.js";
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
  sha256,
  stableStringify,
} from "../core/json.js";
import type { Clock } from "../core/time.js";
import {
  type ContextRegistrationAuthority,
  type ExecutionResult,
  type ExecutorContext,
  type KernelOptions,
  type LeaseIssuerAuthority,
  type ProposalResult,
  type ToolExecutor,
  TotallyTubularKernel,
} from "../runtime/kernel.js";
import { validateSchema } from "../type-validation/index.js";
import {
  type BoundToolDefinition,
  executeTool,
  snapshotSchema,
  type ToolDescriptor,
  type ToolInvocationResult,
  type ToolRuntime,
} from "../typed-tools/index.js";

/** Only the sealed, selected manifest is attached to an executing handler. */
export interface GovernedToolContext extends ExecutorContext {
  /** Explicit immutable context snapshot used for this action; registration and lease binding remain required. */
  readonly manifest: ContextManifest;
}

const sessionBrand = Symbol("host-created governed session");
/** Opaque process-local host session, recognized by object identity; serialized lookalikes confer no authority. */
export interface GovernedSession {
  /** Private compile-time brand; runtime authority additionally requires membership in the session WeakMap. */
  readonly [sessionBrand]: true;
}

/** Host-established lease and selected context plus the exact registration authorities required by the kernel. */
export interface OpenGovernedSessionOptions {
  /** Host-issued scoped authority data, verified and sealed before registration. */
  readonly lease: AuthorityLease;
  /** Explicit immutable context snapshot used for this action; registration and lease binding remain required. */
  readonly manifest: ContextManifest;
  /** Exact host issuer capability configured in this runtime's kernel. */
  readonly leaseIssuer: LeaseIssuerAuthority;
  /** Exact host registrar capability configured in this runtime's kernel. */
  readonly contextRegistrar: ContextRegistrationAuthority;
}

/** Bound tool definitions and trusted kernel dependencies for an in-process governed runtime. */
export interface GovernedToolRuntimeOptions {
  /** Generated bindings with canonical workspace resource resolvers; bare legacy definitions are rejected. */
  readonly definitions: readonly BoundToolDefinition<GovernedToolContext>[];
  /** Injected time source for deterministic expiry, audit, and lifecycle behavior. */
  readonly clock: Clock;
  /** Host-selected authority objects, limits, and test identity namespace; defaults are kernel defaults. */
  readonly kernelOptions?: KernelOptions;
}

/** Host control surface. Give adapters only list/invoke plus one session token. */
export interface GovernedToolRuntime extends ToolRuntime<GovernedSession> {
  /** In-process trusted execution boundary; possession exposes host operations and must not be given to a model. */
  readonly kernel: TotallyTubularKernel;
  /** Register the host's lease and context and return an opaque session bound to their principal and digests. */
  openSession(options: OpenGovernedSessionOptions): GovernedSession;
  /** Create a fresh proposal using the session's fixed host identity, lease, and selected context. */
  propose(name: string, input: unknown, session: GovernedSession): ProposalResult;
  /** Execute only a proposal created by this session, subject to live kernel policy and exact approval. */
  execute(
    proposalId: string,
    session: GovernedSession,
    signal?: AbortSignal,
  ): Promise<ExecutionResult>;
}

/** Private session binding that limits execution to proposals created through that session. */
interface SessionRecord {
  /** Host-established principal identifier. Tool arguments must not supply or override this identity. */
  readonly principalId: string;
  /** Identifier of the host-registered authority lease evaluated for this action. */
  readonly leaseId: string;
  /** Registered context manifest fixed for the lifetime of the opaque session. */
  readonly manifestId: string;
  /** Proposal identifiers created through this exact session, checked before execution or replay. */
  readonly proposals: Set<string>;
}

/**
 * In-memory integration with the existing kernel. No authorization is inferred
 * from arguments. A host creates sessions using registered authority objects.
 */
export function createGovernedToolRuntime(
  options: GovernedToolRuntimeOptions,
): GovernedToolRuntime {
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
    if (
      !isJsonObject(inputSchema) ||
      inputSchema["type"] !== "object" ||
      !isJsonObject(outputSchema)
    ) {
      throw new TypeError(
        `Governed tool ${definition.name} requires an object input schema and a JSON output schema`,
      );
    }
    const resolveResource = definition.resolveResource;
    if (resolveResource === undefined)
      throw new TypeError(`Governed tool ${definition.name} requires a resource resolver`);
    const descriptor: ToolDescriptor = Object.freeze({
      ...definition.documentation,
      name: definition.name,
      description: definition.description,
      effect: definition.effect,
      approval: definition.approval,
      execution: "governed",
      provenance: Object.freeze({ ...definition.provenance }),
      inputSchema,
      outputSchema,
    });
    const version = sha256(
      stableStringify({
        name: definition.name,
        description: definition.description,
        effect: definition.effect,
        approval: definition.approval,
        provenance: { ...definition.provenance },
        inputSchema,
        outputSchema,
      }),
    );
    registry.register(
      defineToolContract<JsonObject, JsonValue>({
        name: definition.name,
        version,
        title: definition.name,
        description: definition.description,
        effect: definition.effect,
        approval: definition.approval,
        input: {
          jsonSchema: inputSchema,
          /** Apply the captured generated schema and return detached JSON input for kernel validation. */
          parse(input) {
            const parsed = validateSchema(inputSchema, input);
            if (!parsed.ok) return parsed;
            return isJsonObject(parsed.value)
              ? { ok: true, value: parsed.value }
              : invalid("", "type", "Expected an object");
          },
        },
        output: {
          jsonSchema: outputSchema,
          parse: (output) => validateSchema(outputSchema, output),
        },
        errors: [
          {
            code: "POLICY_DENIED",
            description: "The current lease does not authorize this proposal.",
            retryable: false,
          },
          {
            code: "APPROVAL_REQUIRED",
            description: "The exact proposal requires human approval.",
            retryable: true,
          },
          {
            code: "EXECUTION_OUTCOME_UNKNOWN",
            description: "Dispatch failed; reconciliation is required before another proposal.",
            retryable: false,
          },
          {
            code: "OUTPUT_INVALID",
            description:
              "The handler ran but returned an invalid result; automatic replay will not dispatch again.",
            retryable: false,
          },
        ],
        semantics: {
          targets: [],
          contexts: [
            {
              name: "selected-context",
              acceptsKindRefs: ["exact-manifest"],
              required: true,
              minItems: 0,
              maxItems: CONTEXT_LIMITS.maxSelectedSources,
              maxBytes: CONTEXT_LIMITS.maxManifestBytes,
            },
          ],
          authority: {
            kind: "all-of",
            requirements: [
              {
                kind: "scheme",
                schemeRef: "capability-lease",
                claims: { exactContextBinding: true },
              },
              ...(definition.approval === "exact-human"
                ? [
                    {
                      kind: "scheme" as const,
                      schemeRef: "exact-human-approval",
                      claims: { binds: "proposal-digest" },
                    },
                  ]
                : []),
            ],
          },
          effects: [
            {
              kindRef: definition.effect,
              occurrence: "possible",
              targetRef: null,
              disclosures: [],
            },
          ],
          execution: {
            completion: "synchronous",
            idempotency: "invocation-id",
            outcomeEvidence: "receipt-required",
            unknownOutcome: "terminal-reconciliation-required",
          },
          lifecycleRef: "proposal-execution",
        },
        /** Resolve only validated input to a canonical workspace URI before policy evaluation. */
        resolveResource(input) {
          const resource = resolveResource(input);
          if (typeof resource !== "string" || !isCanonicalWorkspaceResource(resource)) {
            throw new TypeError("The current policy requires a canonical workspace resource");
          }
          return resource;
        },
      }),
    );
    descriptors.push(descriptor);
    const handler = definition[executeTool];
    executors.push({
      toolName: definition.name,
      idempotency: "proposal-id" as const,
      /** Invoke the bound handler with the kernel-selected manifest and sealed proposal context. */
      async execute(input: unknown, context: ExecutorContext): Promise<unknown> {
        const manifest = manifests.get(context.proposal.contextManifestId);
        if (manifest === undefined || manifest.digest !== context.proposal.contextManifestDigest)
          throw new Error("Selected context unavailable");
        const parsed = validateSchema(inputSchema, input);
        if (!parsed.ok) throw new Error("Canonical input failed validation before dispatch");
        return handler(parsed.value, Object.freeze({ ...context, manifest }));
      },
    });
  }
  const kernel = new TotallyTubularKernel(registry, options.clock, options.kernelOptions);
  for (const executor of executors) kernel.registerExecutor(executor);
  const catalog = Object.freeze(descriptors);

  /** Resolve a recognized session and submit validated arguments with its host-controlled authority binding. */
  function propose(name: string, input: unknown, session: GovernedSession): ProposalResult {
    const record = sessions.get(session);
    if (record === undefined)
      return {
        ok: false,
        failure: kernelFailure("PRINCIPAL_MISMATCH", "A host-created session is required.", false),
      };
    const result = kernel.propose({
      principalId: record.principalId,
      leaseId: record.leaseId,
      contextManifestId: record.manifestId,
      toolName: name,
      input,
    });
    if (result.ok) record.proposals.add(result.proposal.id);
    return result;
  }

  /** Reject proposal identifiers outside the recognized session before delegating to kernel execution. */
  async function execute(
    proposalId: string,
    session: GovernedSession,
    signal?: AbortSignal,
  ): Promise<ExecutionResult> {
    if (!sessions.get(session)?.proposals.has(proposalId)) {
      return {
        ok: false,
        failure: kernelFailure(
          "PROPOSAL_NOT_FOUND",
          "The proposal does not belong to this session.",
          false,
        ),
      };
    }
    return kernel.execute(proposalId, signal);
  }

  return Object.freeze({
    kernel,
    list: () => catalog,
    /** Register exact lease and context snapshots using configured host capabilities, then retain an opaque session binding. */
    openSession(request: OpenGovernedSessionOptions): GovernedSession {
      const manifest = sealContextManifest(request.manifest);
      const lease = sealAuthorityLease(request.lease);
      if (
        lease.subjectId !== manifest.principalId ||
        !lease.contextManifestDigests.includes(manifest.digest)
      ) {
        throw new TypeError("Session principal and selected context must be bound by the lease");
      }
      // Check registered authority identities even when reusing an existing lease.
      if (
        !issuers.has(request.leaseIssuer) ||
        !registrars.has(request.contextRegistrar) ||
        lease.issuedBy !== request.leaseIssuer.issuerId
      )
        throw new TypeError("Session registration requires host authority");
      if (!manifests.has(manifest.id)) {
        kernel.registerManifest(manifest, request.contextRegistrar);
        manifests.set(manifest.id, manifest);
      }
      if (!leases.has(lease.id)) {
        kernel.registerLease(lease, request.leaseIssuer);
        leases.set(lease.id, lease);
      }
      const session: GovernedSession = Object.freeze({ [sessionBrand]: true as const });
      sessions.set(session, {
        principalId: lease.subjectId,
        leaseId: lease.id,
        manifestId: manifest.id,
        proposals: new Set(),
      });
      return session;
    },
    propose,
    execute,
    /** Propose a fresh action and dispatch only when kernel policy and approval allow; otherwise return a structured pause or failure. */
    async invoke(
      name: string,
      input: unknown,
      session: GovernedSession,
    ): Promise<ToolInvocationResult> {
      const proposed = propose(name, input, session);
      if (!proposed.ok) return { status: "deny", failure: proposed.failure };
      if (proposed.challenge !== null)
        return {
          status: "ask",
          proposalId: proposed.proposal.id,
          proposalDigest: proposed.proposal.digest,
        };
      const result = await execute(proposed.proposal.id, session);
      if (!result.ok) return { status: "execution_error", failure: result.failure };
      return {
        status: "success",
        output: result.receipt.result,
        receipt: result.receipt,
        replayed: result.replayed,
      };
    },
  });
}
