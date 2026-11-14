import type { JsonObject, JsonValue } from "../core/json.js";
import type { ToolDescriptor } from "../typed-tools/index.js";

/** The minimum surface needed by a contract projection. */
export interface ToolCatalog {
  list(): readonly ToolDescriptor[];
}

export interface ManifestOptions {
  readonly name?: string;
  readonly version?: string;
}

export interface OpenApiOptions {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

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
  const tools = orderedTools(catalog).map((tool): JsonObject => ({
    name: tool.name,
    description: tool.description,
    effect: tool.effect,
    inputSchema: structuredClone(tool.inputSchema),
    outputSchema: structuredClone(tool.outputSchema),
    ...(tool.provenance === undefined ? {} : { provenance: { ...tool.provenance } }),
    ...(tool.approval === undefined ? {} : { approval: tool.approval }),
    ...(tool.execution === undefined ? {} : { execution: tool.execution }),
  }));
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
  const schemas: Record<string, JsonValue> = {};
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
            description: "Successful result",
            content: { "application/json": { schema: { $ref: `#/components/schemas/${outputKey}` } } },
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
