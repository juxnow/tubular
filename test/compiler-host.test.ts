import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeCompilerFileSystem } from "../src/typegen/file-system.js";
import { createSchemaCompiler } from "../src/typegen/index.js";
import { compilerProject } from "./fixtures/compiler-project.js";
import { generationScenario } from "./fixtures/generation-scenario.js";
import { greet } from "./fixtures/greeting-tools.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("typescript");
  vi.resetModules();
});

describe("compiler host boundaries", () => {
  it("loads the root entry and compiles with an explicit host when TypeScript has no system", async () => {
    const { project } = generationScenario();
    vi.resetModules();
    vi.doMock("typescript", () => ({
      default: new Proxy(ts, {
        get: (target, key, receiver) =>
          key === "sys" ? undefined : Reflect.get(target, key, receiver),
      }),
    }));
    const library = await import("../src/index.js");
    expect(typeof library.bindTool).toBe("function");
    const compiler = library.createSchemaCompiler(project);
    const schemas = compiler.compileTools(["greet"])["greet"];
    if (!schemas) throw new Error("Missing greeting fixture");
    const runtime = library.createToolRuntime({
      definitions: [
        library.defineTool({
          name: "greet",
          description: "Host-scoped greeting",
          effect: "read",
          handler: greet,
        }),
      ],
      schemas: { greet: schemas },
      authorize: () => "ALLOW",
    });
    expect(await runtime.invoke("greet", { name: "Alex" }, { tenant: "Design" })).toMatchObject({
      status: "success",
      output: { greeting: "Design: Hello, Alex." },
    });
    expect(() =>
      library.createSchemaCompiler({ tsconfigPath: "unused.json", entryFile: "unused.ts" }),
    ).toThrow(/provide fileSystem explicitly/);
  });

  it("resolves diagnostics and standard libraries through the supplied host", () => {
    const fixture = compilerProject("export interface Input { value: MissingType }");
    const read = vi.fn(fixture.fileSystem.readFile);
    const files = { ...fixture.fileSystem, readFile: read };
    let message: string | undefined;
    try {
      createSchemaCompiler({ ...fixture, fileSystem: files });
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      message = error.message;
    }
    expect(message).toMatch(/models\.ts.*Cannot find name/s);
    expect(message).not.toContain("test/virtual-project/models.ts");
    expect(
      read.mock.calls.some(([file]) =>
        file.includes(`${path.sep}stdlib${path.sep}lib.es2022.d.ts`),
      ),
    ).toBe(true);
  });

  it("reads the live process cwd instead of retaining TypeScript's cached directory", () => {
    const files = createNodeCompilerFileSystem();
    const first = path.resolve("test/fixtures");
    const second = path.resolve("examples/hello");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(first);
    expect(files.getCurrentDirectory()).toBe(first);
    cwd.mockReturnValue(second);
    expect(files.getCurrentDirectory()).toBe(second);
  });
});
