import { describe, expect, it } from "vitest";
import { runGenerateCommand } from "../src/typegen/command.js";
import { generationScenario } from "./fixtures/generation-scenario.js";

describe("tubular generation pipeline", () => {
  it("discovers authored annotations and writes schemas plus direct bindings", () => {
    const { project, args } = generationScenario();
    expect(runGenerateCommand(args, project.fileSystem)).toBe(
      "Generated 2 artifact(s) for 1 tool(s)\n",
    );
    expect(project.writes).toHaveLength(2);
    expect(project.fileSystem.readFile("schemas.json")).toContain('"excited"');
    expect(project.fileSystem.readFile("bindings.ts")).toContain(
      'import { "greet" as handler0 } from "./models.js"',
    );
    expect(runGenerateCommand([...args, "--check"], project.fileSystem)).toBe(
      "Verified 2 artifact(s) for 1 tool(s)\n",
    );
    expect(project.writes).toHaveLength(2);
  });

  it.each(["renameExcitement", "reviseGreeting"] as const)(
    "detects %s without changing any artifacts",
    (migration) => {
      const scenario = generationScenario();
      const { project, args } = scenario;
      runGenerateCommand(args, project.fileSystem);
      const original = project.writes.map((file) => project.fileSystem.readFile(file));
      scenario[migration]();
      expect(() => runGenerateCommand([...args, "--check"], project.fileSystem)).toThrow(
        /out of date/,
      );
      expect(project.writes).toHaveLength(2);
      expect(project.writes.map((file) => project.fileSystem.readFile(file))).toEqual(original);
      expect(() => scenario[migration]()).toThrow(/predecessor mismatch/);
    },
  );

  it.each([
    ["bindings.ts", "models.ts", /Refusing to overwrite/],
    ["schemas.json", "tsconfig.json", /separate from the source/],
  ] as const)("protects the project when replacing %s with %s", (from, to, error) => {
    const { project, args } = generationScenario();
    const original = project.fileSystem.readFile(to);
    expect(() =>
      runGenerateCommand(
        args.map((arg) => (arg === from ? to : arg)),
        project.fileSystem,
      ),
    ).toThrow(error);
    expect(project.fileSystem.readFile(to)).toBe(original);
    expect(project.writes).toEqual([]);
  });

  it("fails a missing-artifact check without generating output", () => {
    const { project, args } = generationScenario();
    expect(() => runGenerateCommand([...args, "--check"], project.fileSystem)).toThrow(
      /out of date/,
    );
    expect(project.writes).toEqual([]);
  });

  it("supports explicit exports and rejects invalid flags without writing", () => {
    const { project, args } = generationScenario();
    expect(
      runGenerateCommand([...args, "--functions", "generatedGreet"], project.fileSystem),
    ).toContain("Generated 2 artifact(s) for 1 tool(s)");
    expect(project.fileSystem.readFile("schemas.json")).toContain('"text"');
    for (const extra of [
      ["--unknown", "x"],
      ["--check", "--check"],
      ["--functions", "greet,greet"],
    ]) {
      expect(() => runGenerateCommand([...args, ...extra], project.fileSystem)).toThrow();
    }
    expect(project.writes).toHaveLength(2);
  });
});
