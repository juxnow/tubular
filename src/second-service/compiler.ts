import {
  projectContractCatalog,
  projectMcpTools,
  projectOpenApi,
} from "../contracts/projections.js";
import { deepFreezeJsonObject, type JsonObject, sha256, stableStringify } from "../core/json.js";
import {
  type PortAuthorityDefinition,
  type PortAuthorityReference,
  referencePortAuthority,
  verifyPortAuthorityIntegrity,
} from "../port-authority/definition.js";

/** Experimental deterministic projection bundle derived from one validated portable contract. */
export interface SecondServiceCompilation extends JsonObject {
  /** Wire discriminator for this version of the envelope; it does not authenticate the sender. */
  readonly protocol: "second-service.compilation/v0";
  /** Exact portable contract reference from which every bundled projection was derived. */
  readonly sourcePortAuthority: PortAuthorityReference;
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
export function compileSecondService(
  portAuthority: PortAuthorityDefinition,
): SecondServiceCompilation {
  if (!verifyPortAuthorityIntegrity(portAuthority)) {
    throw new TypeError("Second Service refused a non-conforming or tampered Port Authority");
  }
  const sourcePortAuthority = referencePortAuthority(portAuthority);
  const contractCatalog = projectContractCatalog(portAuthority);
  const mcpTools = projectMcpTools(portAuthority);
  const openApi = projectOpenApi(portAuthority);
  const body = {
    protocol: "second-service.compilation/v0" as const,
    sourcePortAuthority,
    contractCatalog,
    mcpTools,
    openApi,
  };
  return deepFreezeJsonObject({
    ...body,
    digest: sha256(stableStringify(body)),
  });
}
