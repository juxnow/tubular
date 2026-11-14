import { describe, expect, it } from "vitest";
import { createDefaultPortAuthority } from "../src/catalog.js";
import {
  projectContractCatalog,
  projectMcpTools,
  projectOpenApi,
} from "../src/contracts/projections.js";
import { stableStringify } from "../src/core/json.js";
import { compileSecondService } from "../src/second-service/compiler.js";

describe("Second Service projections", () => {
  it("derives every projection from one Port Authority", () => {
    const portAuthority = createDefaultPortAuthority();
    const sourceReference = stableStringify({
      id: portAuthority.id,
      digest: portAuthority.digest,
      version: portAuthority.version,
      specification: portAuthority.specification,
    });
    const artifacts = [
      projectContractCatalog(portAuthority),
      projectMcpTools(portAuthority),
      projectOpenApi(portAuthority),
    ];
    for (const artifact of artifacts) {
      const serialized = stableStringify(artifact);
      expect(serialized).toContain("workspace.note.append");
      expect(serialized).toContain("workspace-write");
      expect(serialized).toContain("exact-human-approval");
      expect(serialized).toContain(portAuthority.digest);
      expect(serialized).toContain(sourceReference.slice(1, -1));
    }
  });

  it("marks OpenAPI-shaped paths as documentation, never endpoints", () => {
    const artifact = projectOpenApi(createDefaultPortAuthority());
    expect(artifact["servers"]).toEqual([]);
    expect(artifact["x-documentation-projection"]).toBe(true);
    expect(artifact["x-network-endpoint"]).toBe(false);
    expect(stableStringify(artifact)).toContain('"x-network-endpoint":false');
  });

  it("compiles byte-deterministically from an unchanged Port Authority", () => {
    const left = compileSecondService(createDefaultPortAuthority());
    const right = compileSecondService(createDefaultPortAuthority());
    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(left.digest).toBe(right.digest);
  });

  it("refuses to project a tampered Port Authority", () => {
    const portAuthority = createDefaultPortAuthority();
    const tampered = { ...portAuthority, title: "Changed after sealing" };
    expect(() => projectContractCatalog(tampered)).toThrow("tampered");
    expect(() => projectMcpTools(tampered)).toThrow("tampered");
    expect(() => projectOpenApi(tampered)).toThrow("tampered");
    expect(() => compileSecondService(tampered)).toThrow("tampered");
  });

  it("keeps proposal wrapping outside the canonical Port Authority", () => {
    const portAuthority = createDefaultPortAuthority();
    const before = stableStringify(portAuthority);
    const artifact = projectMcpTools(portAuthority);
    const serialized = stableStringify(artifact);
    expect(serialized).toContain("tt.propose.workspace.note.append");
    expect(serialized).toContain("tt.proposal.status");
    expect(serialized).toContain('"proposalOnly":true');
    expect(serialized).not.toContain('"name":"workspace.note.append"');
    expect(serialized).not.toContain("tt.approve");
    expect(serialized).not.toContain("tt.execute");
    expect(stableStringify(portAuthority)).toBe(before);
    expect(before).not.toContain("tt.propose");
    expect(before).not.toContain("proposalOnly");
  });

  it("publishes only Port Authority lineage metadata", () => {
    const portAuthority = createDefaultPortAuthority();
    const catalog = stableStringify(projectContractCatalog(portAuthority));
    const mcp = stableStringify(projectMcpTools(portAuthority));
    const openApi = stableStringify(projectOpenApi(portAuthority));
    const retiredProtocolStem = ["second", "surface"].join("-");
    const retiredSourceKey = ["source", "Surface"].join("");
    const retiredExtensionStem = `x-${retiredProtocolStem}`;

    expect(catalog).toContain('"sourcePortAuthority"');
    expect(mcp).toContain('"x-port-authority-capability"');
    expect(mcp).toContain('"x-port-authority-source"');
    expect(openApi).toContain('"x-port-authority-source"');
    for (const artifact of [catalog, mcp, openApi]) {
      expect(artifact).not.toContain(retiredProtocolStem);
      expect(artifact).not.toContain(retiredSourceKey);
      expect(artifact).not.toContain(retiredExtensionStem);
    }
  });
});
