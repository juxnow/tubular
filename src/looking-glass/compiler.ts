import {
  projectContractCatalog,
  projectMcpTools,
  projectOpenApi,
} from "../contracts/projections.js";
import { deepFreezeJsonObject, type JsonObject, sha256, stableStringify } from "../core/json.js";
import {
  type PerspectiveDefinition,
  type PerspectiveReference,
  referencePerspective,
  verifyPerspectiveIntegrity,
} from "../perspective/definition.js";

/** Experimental deterministic projection bundle derived from one validated portable contract. */
export interface LookingGlassCompilation extends JsonObject {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "looking-glass.compilation/v0";
  /** Exact portable contract reference from which every bundled projection was derived. */
  readonly sourcePerspective: PerspectiveReference;
  /** Deterministic provider-neutral discovery projection of the verified source contract. */
  readonly contractCatalog: JsonObject;
  /** Native proposal-only MCP discovery definitions wrapped for documentation. */
  readonly mcpTools: JsonObject;
  /** OpenAPI 3.1 documentation projection marked as having no actual HTTP endpoints. */
  readonly openApi: JsonObject;
  /** SHA-256 digest of the source reference and every bundled projection, excluding this digest field. */
  readonly digest: string;
}

/** Verify a portable definition and seal its deterministic catalog, MCP, and OpenAPI projections into one digest-bound bundle. */
export function compileLookingGlass(perspective: PerspectiveDefinition): LookingGlassCompilation {
  if (!verifyPerspectiveIntegrity(perspective)) {
    throw new TypeError("Looking Glass refused a non-conforming or tampered Perspective");
  }
  const sourcePerspective = referencePerspective(perspective);
  const contractCatalog = projectContractCatalog(perspective);
  const mcpTools = projectMcpTools(perspective);
  const openApi = projectOpenApi(perspective);
  const body = {
    protocol: "looking-glass.compilation/v0" as const,
    sourcePerspective,
    contractCatalog,
    mcpTools,
    openApi,
  };
  return deepFreezeJsonObject({
    ...body,
    digest: sha256(stableStringify(body)),
  });
}
