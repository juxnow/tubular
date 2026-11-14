import { describe, expect, it } from "vitest";
import { auditRepository, auditSourceText } from "../scripts/check-source.js";

describe("TypeScript source contract checker", () => {
  it("verifies the current repository has zero source contract offenses", () => {
    const result = auditRepository();
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });

  it("rejects explicit any annotations and assertions", () => {
    const violations = auditSourceText(
      `export function parse(value: any): unknown { return value; }\n`,
    );
    expect(violations).toEqual([
      expect.objectContaining({
        rule: "no-any",
        line: 1,
      }),
    ]);
  });

  it("rejects compiler and linter suppression comments without flagging string literals", () => {
    const clean = auditSourceText(`export const text = "// @ts-ignore in a literal";\n`);
    expect(clean).toEqual([]);

    const suppressed = auditSourceText(
      `// @ts-expect-error suppressing type error\nexport const value: number = "bad";\n`,
    );
    expect(suppressed).toEqual([
      expect.objectContaining({
        rule: "no-suppression",
        line: 1,
      }),
    ]);
  });

  it("enforces interfaces for object-shaped models while allowing union type aliases", () => {
    const valid = auditSourceText(
      `export type Mode = "read" | "write";\nexport interface Config { readonly mode: Mode; }\n`,
    );
    expect(valid).toEqual([]);

    const invalid = auditSourceText(`export type Config = { readonly mode: string };\n`);
    expect(invalid).toEqual([
      expect.objectContaining({
        rule: "interface-for-objects",
        line: 1,
      }),
    ]);
  });

  it("rejects angle-bracket, double, and blanket unknown assertions while allowing as const", () => {
    const validConst = auditSourceText(`export const roles = ["admin", "viewer"] as const;\n`);
    expect(validConst).toEqual([]);

    const angle = auditSourceText(`export const x = <string>("hello");\n`);
    expect(angle).toEqual([
      expect.objectContaining({
        rule: "no-angle-assertion",
        line: 1,
      }),
    ]);

    const doubleAssertion = auditSourceText(
      `export function coerce(x: string): number { return (x as unknown) as number; }\n`,
    );
    expect(doubleAssertion).toEqual([
      expect.objectContaining({
        rule: "no-double-assertion",
        line: 1,
      }),
    ]);

    const blanketUnknown = auditSourceText(
      `export interface Item { readonly id: string; }\nexport function coerce(x: unknown): Item { return x as Item; }\n`,
    );
    expect(blanketUnknown).toEqual([
      expect.objectContaining({
        rule: "no-blanket-assertion",
        line: 2,
      }),
    ]);
  });

  it("enforces architectural layer boundaries between domain, projections, and adapters", () => {
    const domainImportingAdapter = auditSourceText(
      `import { createMcpServer } from "../mcp/server.js";\nexport const ref = createMcpServer;\n`,
      "src/core/bad-import.ts",
    );
    expect(domainImportingAdapter).toEqual([
      expect.objectContaining({
        rule: "layer-boundary",
        line: 1,
      }),
    ]);

    const projectionImportingKernel = auditSourceText(
      `import { TotallyTubularKernel } from "../runtime/kernel.js";\nexport const ref = TotallyTubularKernel;\n`,
      "src/typed-projections/bad-import.ts",
    );
    expect(projectionImportingKernel).toEqual([
      expect.objectContaining({
        rule: "layer-boundary",
        line: 1,
      }),
    ]);
  });

  it("forbids uninjected wall-clock calls and network primitives in src/", () => {
    const wallClock = auditSourceText(
      `export const timestamp = Date.now();\nexport const date = new Date();\n`,
      "src/runtime/bad-clock.ts",
    );
    expect(wallClock).toHaveLength(2);
    expect(wallClock.map((v) => v.rule)).toEqual(["no-wall-clock", "no-wall-clock"]);

    const allowedClockModule = auditSourceText(
      `export const date = new Date();\n`,
      "src/core/time.ts",
    );
    expect(allowedClockModule).toEqual([]);

    const networkCall = auditSourceText(
      `import http from "node:http";\nexport const ref = http;\n`,
      "src/core/bad-net.ts",
    );
    expect(networkCall).toEqual([
      expect.objectContaining({
        rule: "no-network",
        line: 1,
      }),
    ]);
  });
});
