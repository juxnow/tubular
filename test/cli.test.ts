import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("tubular generate", () => {
  it("discovers annotated tools, generates contracts and detects drift without overwriting", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tubular-cli-"));
    directories.push(directory);
    writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [], skipLibCheck: true }, files: ["tools.ts"] }));
    const source = (property: string): string => `/** @tubular */\nexport function search(input: { ${property}: string }): { result: string } { return { result: input.${property} } }\n`;
    writeFileSync(path.join(directory, "tools.ts"), source("query"));
    const output = path.join(directory, "schemas.json");
    const cli = path.resolve("src/cli.ts");
    const bindings = path.join(directory, "bindings.ts");
    const args = ["--import", "tsx", cli, "generate", "--project", path.join(directory, "tsconfig.json"), "--entry", "tools.ts", "--out", output, "--bindings", bindings];
    const generate = spawnSync(process.execPath, args, { encoding: "utf8" });
    expect(generate.status, generate.stderr).toBe(0);
    const original = readFileSync(output, "utf8");
    const originalBindings = readFileSync(bindings, "utf8");
    expect(originalBindings).toContain("bindTool(handler0");
    expect(original).toContain('"query"');
    const checked = spawnSync(process.execPath, [...args, "--check"], { encoding: "utf8" });
    expect(checked.status, checked.stderr).toBe(0);
    writeFileSync(path.join(directory, "tools.ts"), source("term"));
    const stale = spawnSync(process.execPath, [...args, "--check"], { encoding: "utf8" });
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain("out of date");
    expect(readFileSync(output, "utf8")).toBe(original);
    expect(readFileSync(bindings, "utf8")).toBe(originalBindings);
    const unsafeBindingArgs = args.map(value => value === bindings ? path.join(directory, "tools.ts") : value);
    const beforeSource = readFileSync(path.join(directory, "tools.ts"), "utf8");
    const unsafeBinding = spawnSync(process.execPath, unsafeBindingArgs, { encoding: "utf8" });
    expect(unsafeBinding.status).not.toBe(0);
    expect(unsafeBinding.stderr).toContain("Refusing to overwrite");
    expect(readFileSync(path.join(directory, "tools.ts"), "utf8")).toBe(beforeSource);
    const unsafeOutput = spawnSync(process.execPath, args.map(value => value === output ? path.join(directory, "tsconfig.json") : value), { encoding: "utf8" });
    expect(unsafeOutput.status).not.toBe(0);
    expect(unsafeOutput.stderr).toContain("separate from the source and project configuration");
  });
});
