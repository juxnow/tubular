import type { JsonObject, JsonValue } from "../core/json.js";
import { runtimeContractSchemas } from "../generated/runtime-contracts.js";
import type { ToolDescriptor } from "../typed-tools/index.js";

/** The minimum surface needed by a contract projection. */
export interface ToolCatalog {
  /** Return canonical descriptors for discovery; projections copy them rather than mutating runtime state. */
  list(): readonly ToolDescriptor[];
}

/** Optional capability-manifest display identity; defaults are tubular and 0.1.0. */
export interface ManifestOptions {
  /** Capability-manifest display name; defaults to tubular. */
  readonly name?: string;
  /** Explicit contract or component version; callers should not infer compatibility from matching names alone. */
  readonly version?: string;
}

/** Required OpenAPI information metadata for documentation-only HTTP-shaped paths. */
export interface OpenApiOptions {
  /** Short human-readable display title; identifiers remain the stable integration keys. */
  readonly title: string;
  /** Explicit contract or component version; callers should not infer compatibility from matching names alone. */
  readonly version: string;
  /** Human-readable semantics exposed in discovery; descriptive text does not enforce runtime policy. */
  readonly description?: string;
}

/** Sort descriptors by name and reject empty or duplicate names before generating deterministic projections. */
function orderedTools(catalog: ToolCatalog): readonly ToolDescriptor[] {
  const tools = [...catalog.list()].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (let index = 0; index < tools.length; index += 1) {
    const current = tools[index];
    if (current === undefined || current.name.length === 0) {
      throw new TypeError("A projected tool requires a non-empty name");
    }
    if (index > 0 && tools[index - 1]?.name === current.name) {
      throw new TypeError(`Duplicate projected tool: ${current.name}`);
    }
  }
  return tools;
}

/**
 * Project discoverable, provider-neutral capability metadata. A new independent
 * JSON snapshot is returned on each call so consumers cannot mutate the runtime.
 */
export function projectCapabilityManifest(
  catalog: ToolCatalog,
  options: ManifestOptions = {},
): JsonObject {
  const tools = orderedTools(catalog).map(
    (tool): JsonObject => ({
      name: tool.name,
      description: tool.description,
      effect: tool.effect,
      inputSchema: structuredClone(tool.inputSchema),
      outputSchema: structuredClone(tool.outputSchema),
      ...(tool.title === undefined ? {} : { title: tool.title }),
      ...(tool.deprecated === undefined ? {} : { deprecated: tool.deprecated }),
      ...(tool.resultDescription === undefined
        ? {}
        : { resultDescription: tool.resultDescription }),
      ...(tool.provenance === undefined ? {} : { provenance: { ...tool.provenance } }),
      ...(tool.approval === undefined ? {} : { approval: tool.approval }),
      ...(tool.execution === undefined ? {} : { execution: tool.execution }),
    }),
  );
  return {
    formatVersion: "0.1.0",
    name: options.name ?? "tubular",
    version: options.version ?? "0.1.0",
    tools,
  };
}

/**
 * Project a contract into OpenAPI 3.1. This does not start or implement an HTTP
 * server; a host must supply an HTTP transport and enforce its runtime policy.
 */
export function projectTypedOpenApi(catalog: ToolCatalog, options: OpenApiOptions): JsonObject {
  if (!options.title || !options.version) {
    throw new TypeError("OpenAPI title and version are required");
  }
  const paths: Record<string, JsonValue> = {};
  const schemas: Record<string, JsonValue> = {
    ToolInputValidationFailure: structuredClone(runtimeContractSchemas.ToolInputValidationFailure),
  };
  orderedTools(catalog).forEach((tool, index) => {
    const inputKey = `Tool${index}Input`;
    const outputKey = `Tool${index}Output`;
    schemas[inputKey] = structuredClone(tool.inputSchema);
    schemas[outputKey] = structuredClone(tool.outputSchema);
    // Prefixing prevents dot-segment names such as '..' from becoming URL traversal.
    // encodeURIComponent keeps slashes, percent signs, and reserved characters in
    // the name from being interpreted as path delimiters in the advertised URL.
    let segment: string;
    try {
      segment = encodeURIComponent(tool.name);
    } catch {
      throw new TypeError("Tool name must contain valid Unicode");
    }
    paths[`/tools/tool-${segment}`] = {
      post: {
        "x-documentation-projection": true,
        "x-network-endpoint": false,
        operationId: tool.name,
        description: tool.description,
        ...(tool.title === undefined ? {} : { summary: tool.title }),
        ...(tool.deprecated === undefined ? {} : { deprecated: tool.deprecated }),
        "x-tubular-effect": tool.effect,
        ...(tool.approval === undefined ? {} : { "x-tubular-approval": tool.approval }),
        ...(tool.execution === undefined ? {} : { "x-tubular-execution": tool.execution }),
        ...(tool.provenance === undefined ? {} : { "x-tubular-source": { ...tool.provenance } }),
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: `#/components/schemas/${inputKey}` } } },
        },
        responses: {
          "200": {
            description: tool.resultDescription ?? "Successful result",
            content: {
              "application/json": { schema: { $ref: `#/components/schemas/${outputKey}` } },
            },
          },
          "422": {
            description:
              "Projection of input validation failure before dispatch. A future HTTP host must implement this mapping.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ToolInputValidationFailure" },
              },
            },
          },
          default: {
            description:
              "Approval, policy, and execution failures require a host-defined HTTP mapping. No HTTP error endpoint or automatic retry behavior is implemented.",
          },
        },
      },
    };
  });
  return {
    openapi: "3.1.0",
    "x-documentation-projection": true,
    "x-network-endpoint": false,
    info: {
      title: options.title,
      version: options.version,
      ...(options.description === undefined ? {} : { description: options.description }),
    },
    paths,
    components: { schemas },
  };
}
