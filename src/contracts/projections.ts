import { PROPOSAL_ID_PATTERN } from "../authority/types.js";
import { deepFreezeJsonObject, type JsonObject, type JsonValue } from "../core/json.js";
import {
  type AuthorityRequirement,
  type CapabilityDefinition,
  type PortAuthorityDefinition,
  referencePortAuthority,
  verifyPortAuthorityIntegrity,
} from "../port-authority/definition.js";

/** Project a portable capability into discovery metadata without creating an execution surface. */
function capabilityProjection(capability: CapabilityDefinition): JsonObject {
  return {
    id: capability.id,
    version: capability.version,
    title: capability.title,
    description: capability.description,
    inputSchema: capability.inputSchema,
    outputSchema: capability.outputSchema,
    errors: capability.errors,
    targets: capability.targets,
    contexts: capability.contexts,
    authority: capability.authority,
    effects: capability.effects,
    execution: capability.execution,
    lifecycleRef: capability.lifecycleRef,
  };
}

/** Render declared effect kinds into explanatory discovery text. */
function effectSummary(capability: CapabilityDefinition): string {
  return capability.effects.map((effect) => effect.kindRef).join(",");
}

/** Recursively inspect a portable authority expression for a named scheme; this is not authorization. */
function authorityUsesScheme(requirement: AuthorityRequirement, schemeId: string): boolean {
  if (requirement.kind === "none") {
    return false;
  }
  if (requirement.kind === "scheme") {
    return requirement.schemeRef === schemeId;
  }
  return requirement.requirements.some((child) => authorityUsesScheme(child, schemeId));
}

/** Describe whether portable authority metadata calls for exact human approval. */
function approvalSummary(capability: CapabilityDefinition): string {
  return authorityUsesScheme(capability.authority, "exact-human-approval") ? "exact-human" : "none";
}

/** Reject nonconforming or tampered portable definitions before generating downstream projections. */
function assertProjectable(portAuthority: PortAuthorityDefinition): void {
  if (!verifyPortAuthorityIntegrity(portAuthority)) {
    throw new TypeError("Cannot project a non-conforming or tampered Port Authority");
  }
}

/** Reject projected name collisions so distinct capabilities cannot silently overwrite one another. */
function ensureUnique(seen: Set<string>, value: string, projection: string): void {
  if (seen.has(value)) {
    throw new TypeError(`${projection} projection collision: ${value}`);
  }
  seen.add(value);
}

/** MCP discovery hints derived from portable semantics. Clients must not treat these hints as authorization. */
export interface McpToolAnnotations extends JsonObject {
  /** MCP discovery hint that the tool does not mutate state; it is not a security boundary. */
  readonly readOnlyHint: boolean;
  /** MCP discovery hint that the declared operation can be destructive; host authorization remains required. */
  readonly destructiveHint: boolean;
  /** MCP hint about repeated identical tool calls; proposal creation must not be advertised as idempotent execution. */
  readonly idempotentHint: boolean;
  /** MCP hint about interaction beyond the local system; it does not grant network access. */
  readonly openWorldHint: boolean;
}

/** Native legacy gateway tool description with JSON Schema input and derived MCP hints. */
export interface McpToolDescriptor extends JsonObject {
  /** Native MCP tool identifier derived from a portable capability or gateway status operation. */
  readonly name: string;
  /** Short human-readable display title; identifiers remain the stable integration keys. */
  readonly title: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description: string;
  /** Canonical JSON Schema describing accepted input; consumers must also respect host policy and runtime validation. */
  readonly inputSchema: JsonObject;
  /** Native MCP discovery hints derived from the canonical contract, not enforcement rules. */
  readonly annotations: McpToolAnnotations;
}

/** Mapping from a native MCP tool to a portable capability or the gateway status operation. */
export interface McpToolBinding {
  /** Native MCP definition used consistently for registration and documentation projection. */
  readonly descriptor: McpToolDescriptor;
  /** Portable capability represented by the tool, or null for a gateway-only status operation. */
  readonly canonicalCapabilityId: string | null;
}

/** Derive proposal-only native MCP definitions and a safe status tool from the portable contract. */
export function createMcpToolBindings(
  portAuthority: PortAuthorityDefinition,
): readonly McpToolBinding[] {
  assertProjectable(portAuthority);
  const names = new Set<string>();
  const bindings: McpToolBinding[] = portAuthority.capabilities.map((capability) => {
    const name = `tt.propose.${capability.id}`;
    ensureUnique(names, name, "MCP name");
    const descriptor = deepFreezeJsonObject({
      name,
      title: `Propose: ${capability.title}`,
      description: `${capability.description} This records a proposal only; it never performs the effect.`,
      inputSchema: capability.inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      "x-port-authority-capability": capabilityProjection(capability),
      "x-port-authority-source": referencePortAuthority(portAuthority),
      "x-totally-tubular-canonical-tool": capability.id,
      "x-totally-tubular-version": capability.version,
      "x-totally-tubular-effect": effectSummary(capability),
      "x-totally-tubular-approval": approvalSummary(capability),
    });
    return Object.freeze({
      descriptor,
      canonicalCapabilityId: capability.id,
    });
  });

  const statusName = "tt.proposal.status";
  ensureUnique(names, statusName, "MCP name");
  bindings.push(
    Object.freeze({
      descriptor: deepFreezeJsonObject({
        name: statusName,
        title: "Check proposal status",
        description: "Return a principal-scoped, redacted proposal status.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["proposalId"],
          properties: {
            proposalId: {
              type: "string",
              pattern: PROPOSAL_ID_PATTERN,
              description: "Proposal identifier returned by a tt.propose.* tool",
            },
          },
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      }),
      canonicalCapabilityId: null,
    }),
  );
  return Object.freeze(bindings);
}

/** Create deterministic discovery metadata from a verified portable definition. */
export function projectContractCatalog(portAuthority: PortAuthorityDefinition): JsonObject {
  assertProjectable(portAuthority);
  return {
    protocol: "second-service.contract-catalog/v0",
    sourcePortAuthority: referencePortAuthority(portAuthority),
    capabilities: portAuthority.capabilities.map((capability) => capabilityProjection(capability)),
  };
}

/** Wrap the legacy proposal-only MCP definitions for deterministic documentation output. */
export function projectMcpTools(portAuthority: PortAuthorityDefinition): JsonObject {
  const bindings = createMcpToolBindings(portAuthority);

  return {
    protocol: "second-service.mcp-tools/v0",
    sourcePortAuthority: referencePortAuthority(portAuthority),
    documentationOnly: true,
    proposalOnly: true,
    tools: bindings.map((binding) => binding.descriptor),
  };
}

/** Produce OpenAPI 3.1 documentation for hypothetical HTTP paths; no HTTP adapter or authorization middleware is installed. */
export function projectOpenApi(portAuthority: PortAuthorityDefinition): JsonObject {
  assertProjectable(portAuthority);
  const paths: Record<string, JsonValue> = {};
  const pathNames = new Set<string>();
  const operationIds = new Set<string>();

  for (const capability of portAuthority.capabilities) {
    const path = `/tools/${capability.id.replaceAll(".", "/")}`;
    const operationId = capability.id.replaceAll(".", "_").replaceAll("-", "_");
    ensureUnique(pathNames, path, "OpenAPI path");
    ensureUnique(operationIds, operationId, "OpenAPI operation id");
    paths[path] = {
      post: {
        operationId,
        summary: capability.title,
        description: capability.description,
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: capability.inputSchema },
          },
        },
        responses: {
          "200": {
            description: "Documentation projection of the successful capability result",
            content: {
              "application/json": { schema: capability.outputSchema },
            },
          },
        },
        "x-port-authority-capability": capabilityProjection(capability),
        "x-port-authority-source": referencePortAuthority(portAuthority),
        "x-totally-tubular-tool": true,
        "x-totally-tubular-tool-name": capability.id,
        "x-totally-tubular-effect": effectSummary(capability),
        "x-totally-tubular-approval": approvalSummary(capability),
        "x-documentation-projection": true,
        "x-network-endpoint": false,
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: `${portAuthority.title} capability documentation`,
      version: portAuthority.version,
      description:
        "Documentation-only projection of a Port Authority. These paths are not HTTP endpoints.",
    },
    servers: [],
    paths,
    "x-port-authority-source": referencePortAuthority(portAuthority),
    "x-documentation-projection": true,
    "x-network-endpoint": false,
  };
}
