import { deepFreezeJsonObject, type JsonObject, type JsonValue } from "../core/json.js";
import {
  referencePortAuthority,
  verifyPortAuthorityIntegrity,
  type AuthorityRequirement,
  type CapabilityDefinition,
  type PortAuthorityDefinition,
} from "../port-authority/definition.js";

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

function effectSummary(capability: CapabilityDefinition): string {
  return capability.effects.map((effect) => effect.kindRef).join(",");
}

function authorityUsesScheme(
  requirement: AuthorityRequirement,
  schemeId: string,
): boolean {
  if (requirement.kind === "none") {
    return false;
  }
  if (requirement.kind === "scheme") {
    return requirement.schemeRef === schemeId;
  }
  return requirement.requirements.some((child) =>
    authorityUsesScheme(child, schemeId),
  );
}

function approvalSummary(capability: CapabilityDefinition): string {
  return authorityUsesScheme(capability.authority, "exact-human-approval")
    ? "exact-human"
    : "none";
}

function assertProjectable(portAuthority: PortAuthorityDefinition): void {
  if (!verifyPortAuthorityIntegrity(portAuthority)) {
    throw new TypeError("Cannot project a non-conforming or tampered Port Authority");
  }
}

function ensureUnique(
  seen: Set<string>,
  value: string,
  projection: string,
): void {
  if (seen.has(value)) {
    throw new TypeError(`${projection} projection collision: ${value}`);
  }
  seen.add(value);
}

export interface McpToolAnnotations extends JsonObject {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface McpToolDescriptor extends JsonObject {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly annotations: McpToolAnnotations;
}

export interface McpToolBinding {
  readonly descriptor: McpToolDescriptor;
  readonly canonicalCapabilityId: string | null;
}

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
      description:
        `${capability.description} This records a proposal only; it never performs the effect.`,
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
              pattern: "^proposal_[a-f0-9]{24}$",
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

export function projectContractCatalog(
  portAuthority: PortAuthorityDefinition,
): JsonObject {
  assertProjectable(portAuthority);
  return {
    protocol: "second-service.contract-catalog/v0",
    sourcePortAuthority: referencePortAuthority(portAuthority),
    capabilities: portAuthority.capabilities.map((capability) =>
      capabilityProjection(capability),
    ),
  };
}

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
