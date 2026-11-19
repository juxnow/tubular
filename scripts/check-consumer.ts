import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const directory = mkdtempSync(path.join(tmpdir(), "tubular-consumer-"));
/** Execute a consumer verification command and surface nonzero exit output as a failed check. */
function run(command: string, args: string[], cwd = directory): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
/** Link a required package into the isolated consumer fixture without changing the repository package graph. */
function linkPackage(name: string): void {
  const destination = path.join(directory, "node_modules", name);
  mkdirSync(path.dirname(destination), { recursive: true });
  symlinkSync(path.join(root, "node_modules", name), destination, "dir");
}

try {
  const packed: unknown = JSON.parse(
    run(
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        directory,
        "--cache",
        path.join(directory, "cache"),
      ],
      root,
    ),
  );
  if (!Array.isArray(packed)) throw new Error("Expected npm pack metadata");
  const entry: unknown = packed[0];
  if (
    typeof entry !== "object" ||
    entry === null ||
    !("filename" in entry) ||
    typeof entry.filename !== "string"
  )
    throw new Error("Missing package filename");
  const installed = path.join(directory, "node_modules/@juxnow/tubular");
  mkdirSync(installed, { recursive: true });
  run("tar", [
    "-xzf",
    path.join(directory, entry.filename),
    "--strip-components=1",
    "-C",
    installed,
  ]);
  // Exercise the packed artifact using the lockfile-installed dependencies.
  // This is deliberately offline and is not a clean dependency-resolution test.
  linkPackage("typescript");
  linkPackage("@modelcontextprotocol/server");
  linkPackage("@types/node");
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(
    path.join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        skipLibCheck: true,
        outDir: "build",
        types: ["node"],
      },
      files: ["tools.ts"],
    }),
  );
  writeFileSync(
    path.join(directory, "tools.ts"),
    `/** @tubular */
export function echo(input: { value: string }, context: { prefix: string }): { value: string } {
  return { value: context.prefix + input.value };
}
`,
  );
  const cli = path.join(installed, "dist/cli.js");
  const generate = [
    cli,
    "generate",
    "--project",
    "tsconfig.json",
    "--entry",
    "tools.ts",
    "--out",
    "schemas.json",
    "--bindings",
    "bindings.ts",
  ];
  run(process.execPath, generate);
  run(process.execPath, [...generate, "--check"]);
  const source = `import assert from "node:assert/strict";
import { createToolRuntime } from "@juxnow/tubular";
import { compileToolBindings, compileToolSchemas } from "@juxnow/tubular/compiler";
import { createTypedMcpServer } from "@juxnow/tubular/mcp";
import { echo } from "./bindings.js";
const runtime = createToolRuntime({ definitions: [echo({ description: "Echo", effect: "read" })], authorize: () => "ALLOW" });
assert.deepEqual(await runtime.invoke("echo", { value: "hello" }, { prefix: "host: " }), { status: "success", output: { value: "host: hello" } });
assert.equal((await runtime.invoke("echo", { value: 42 }, { prefix: "" })).status, "invalid_input");
assert.equal(typeof compileToolSchemas, "function");
assert.equal(typeof createTypedMcpServer, "function");
const bound = compileToolBindings({ tsconfigPath: "tsconfig.json", entryFile: "tools.ts", functionNames: ["echo"], outputFile: "bindings.ts" });
const initialDirectory = process.cwd();
try {
  process.chdir("build");
  const fromBuild = compileToolBindings({ tsconfigPath: "../tsconfig.json", entryFile: "tools.ts", functionNames: ["echo"], outputFile: "../bindings.ts" });
  assert.equal(fromBuild, bound);
} finally {
  process.chdir(initialDirectory);
}
`;
  const consumer = path.join(directory, "consumer.ts");
  writeFileSync(consumer, source);
  writeFileSync(
    path.join(directory, "tsconfig.build.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      files: ["tools.ts", "bindings.ts", "consumer.ts"],
    }),
  );
  const compiler = path.join(root, "node_modules/typescript/bin/tsc");
  run(process.execPath, [compiler, "-p", "tsconfig.build.json"]);
  run(process.execPath, ["build/consumer.js"]);
  writeFileSync(
    consumer,
    `${source}\necho({ description: "Wrong", effect: "read", handler: () => ({ value: "replacement" }) });\n`,
  );
  const wrongHandler = spawnSync(
    process.execPath,
    [compiler, "-p", "tsconfig.build.json", "--noEmit"],
    { cwd: directory, encoding: "utf8" },
  );
  if (wrongHandler.status === 0 || !wrongHandler.stdout.includes("'handler' does not exist"))
    throw new Error("Consumer could override the bound handler");
  const before = readFileSync(path.join(directory, "bindings.ts"), "utf8");
  writeFileSync(
    path.join(directory, "tools.ts"),
    readFileSync(path.join(directory, "tools.ts"), "utf8").replace(
      "context.prefix + input.value",
      "input.value + context.prefix",
    ),
  );
  const drift = spawnSync(process.execPath, [...generate, "--check"], {
    cwd: directory,
    encoding: "utf8",
  });
  if (
    drift.status === 0 ||
    !drift.stderr.includes("out of date") ||
    readFileSync(path.join(directory, "bindings.ts"), "utf8") !== before
  )
    throw new Error("Binding drift check failed");
  process.stdout.write(
    "Packed consumer verified: exports, CLI generation, TypeScript binding, runtime validation, handler protection, drift detection, cwd changes.\n",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
