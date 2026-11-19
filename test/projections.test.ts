import { describe, expect, it } from "vitest";
import { createDefaultPerspective } from "../src/catalog.js";
import {
  projectContractCatalog,
  projectMcpTools,
  projectOpenApi,
} from "../src/contracts/projections.js";
import { stableStringify } from "../src/core/json.js";
import { compileLookingGlass } from "../src/looking-glass/compiler.js";

describe("Looking Glass projections", () => {
  it("derives every projection from one Perspective", () => {
    const perspective = createDefaultPerspective();
    const sourceReference = stableStringify({
      id: perspective.id,
      digest: perspective.digest,
      version: perspective.version,
      specification: perspective.specification,
    });
    const artifacts = [
      projectContractCatalog(perspective),
      projectMcpTools(perspective),
      projectOpenApi(perspective),
    ];
    for (const artifact of artifacts) {
      const serialized = stableStringify(artifact);
      expect(serialized).toContain("workspace.note.append");
      expect(serialized).toContain("workspace-write");
      expect(serialized).toContain("exact-human-approval");
      expect(serialized).toContain(perspective.digest);
      expect(serialized).toContain(sourceReference.slice(1, -1));
    }
  });

  it("marks OpenAPI-shaped paths as documentation, never endpoints", () => {
    const artifact = projectOpenApi(createDefaultPerspective());
    expect(artifact["servers"]).toEqual([]);
    expect(artifact["x-documentation-projection"]).toBe(true);
    expect(artifact["x-network-endpoint"]).toBe(false);
    expect(stableStringify(artifact)).toContain('"x-network-endpoint":false');
  });

  it("compiles byte-deterministically from an unchanged Perspective", () => {
    const left = compileLookingGlass(createDefaultPerspective());
    const right = compileLookingGlass(createDefaultPerspective());
    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(left.digest).toBe(right.digest);
  });

  it("refuses to project a tampered Perspective", () => {
    const perspective = createDefaultPerspective();
    const tampered = { ...perspective, title: "Changed after sealing" };
    expect(() => projectContractCatalog(tampered)).toThrow("tampered");
    expect(() => projectMcpTools(tampered)).toThrow("tampered");
    expect(() => projectOpenApi(tampered)).toThrow("tampered");
    expect(() => compileLookingGlass(tampered)).toThrow("tampered");
  });

  it("keeps proposal wrapping outside the canonical Perspective", () => {
    const perspective = createDefaultPerspective();
    const before = stableStringify(perspective);
    const artifact = projectMcpTools(perspective);
    const serialized = stableStringify(artifact);
    expect(serialized).toContain("tt.propose.workspace.note.append");
    expect(serialized).toContain("tt.proposal.status");
    expect(serialized).toContain('"proposalOnly":true');
    expect(serialized).not.toContain('"name":"workspace.note.append"');
    expect(serialized).not.toContain("tt.approve");
    expect(serialized).not.toContain("tt.execute");
    expect(stableStringify(perspective)).toBe(before);
    expect(before).not.toContain("tt.propose");
    expect(before).not.toContain("proposalOnly");
  });

  it("publishes only Perspective lineage metadata", () => {
    const perspective = createDefaultPerspective();
    const catalog = stableStringify(projectContractCatalog(perspective));
    const mcp = stableStringify(projectMcpTools(perspective));
    const openApi = stableStringify(projectOpenApi(perspective));
    const retiredProtocolStem = ["second", "surface"].join("-");
    const retiredSourceKey = ["source", "Surface"].join("");
    const retiredExtensionStem = `x-${retiredProtocolStem}`;

    expect(catalog).toContain('"sourcePerspective"');
    expect(mcp).toContain('"x-perspective-capability"');
    expect(mcp).toContain('"x-perspective-source"');
    expect(openApi).toContain('"x-perspective-source"');
    for (const artifact of [catalog, mcp, openApi]) {
      expect(artifact).not.toContain(retiredProtocolStem);
      expect(artifact).not.toContain(retiredSourceKey);
      expect(artifact).not.toContain(retiredExtensionStem);
    }
  });
});
