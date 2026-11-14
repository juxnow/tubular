import {
  deepFreezeJsonObject,
  sha256,
  stableStringify,
  type JsonObject,
} from "../core/json.js";
import {
  projectContractCatalog,
  projectMcpTools,
  projectOpenApi,
} from "../contracts/projections.js";
import {
  referencePortAuthority,
  verifyPortAuthorityIntegrity,
  type PortAuthorityDefinition,
  type PortAuthorityReference,
} from "../port-authority/definition.js";

export interface SecondServiceCompilation extends JsonObject {
  readonly protocol: "second-service.compilation/v0";
  readonly sourcePortAuthority: PortAuthorityReference;
  readonly contractCatalog: JsonObject;
  readonly mcpTools: JsonObject;
  readonly openApi: JsonObject;
  readonly digest: string;
}

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
