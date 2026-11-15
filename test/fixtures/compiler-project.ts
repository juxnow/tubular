import path from "node:path";
import ts from "typescript";
import type { GenerationHost } from "../../src/typegen/command.js";
import { nodeCompilerFileSystem } from "../../src/typegen/file-system.js";
import type { SchemaProjectOptions } from "../../src/typegen/index.js";
import configuration from "./tsconfig.json" with { type: "json" };

/** Isolated virtual project with explicit source revisions and observable artifact writes. */
export interface CompilerProject extends SchemaProjectOptions {
  /** In-memory project adapter; only installed TypeScript standard libraries are read from disk. */
  fileSystem: GenerationHost;
  /** Ordered artifact destinations written by generation, excluding fixture setup and migrations. */
  writes: readonly string[];
  /** Advance a file only when its current text matches the expected predecessor. No implicit upserts. */
  migrate(file: string, previous: string, next: string): void;
}

/** Build a fresh strict project without temporary directories, subprocesses, or disk mutations. */
export function compilerProject(
  source: string,
  options: ts.CompilerOptions = {},
  dependencies: Readonly<Record<string, string>> = {},
): CompilerProject {
  const root = path.resolve("test/virtual-project");
  const resolve = (file: string): string => path.resolve(root, file);
  const libraryRoot = path.dirname(ts.getDefaultLibFilePath({}));
  const isLibrary = (file: string): boolean =>
    path.dirname(file) === libraryRoot && /^lib\..*\.d\.ts$/.test(path.basename(file));
  const files = new Map<string, string>([
    [
      resolve("tsconfig.json"),
      JSON.stringify({
        ...configuration,
        compilerOptions: { ...configuration.compilerOptions, ...options },
        files: ["models.ts"],
      }),
    ],
    [resolve("models.ts"), source],
  ]);
  for (const [file, text] of Object.entries(dependencies)) {
    const destination = resolve(file);
    if (files.has(destination) || !destination.startsWith(`${root}${path.sep}`))
      throw new Error(`Invalid fixture dependency: ${file}`);
    files.set(destination, text);
  }
  const writes: string[] = [];
  const host: GenerationHost = {
    useCaseSensitiveFileNames: true,
    getCurrentDirectory: () => root,
    readFile: (file) =>
      files.get(resolve(file)) ??
      (isLibrary(file) ? nodeCompilerFileSystem.readFile(file) : undefined),
    fileExists: (file) =>
      files.has(resolve(file)) || (isLibrary(file) && nodeCompilerFileSystem.fileExists(file)),
    directoryExists: (directory) =>
      directory === libraryRoot ||
      [...files.keys()].some((file) => file.startsWith(`${resolve(directory)}${path.sep}`)),
    getDirectories: () => [],
    // Fixture configs use explicit files, so accepting glob expansion would hide an unsupported setup.
    readDirectory: () => {
      throw new Error("Compiler fixtures require an explicit files list");
    },
    realpath: (file) => resolve(file),
    writeFile: (file, content) => {
      const destination = resolve(file);
      if (!destination.startsWith(`${root}${path.sep}`))
        throw new Error("Artifact escapes fixture workspace");
      files.set(destination, content);
      writes.push(destination);
    },
  };
  return {
    tsconfigPath: resolve("tsconfig.json"),
    entryFile: "models.ts",
    fileSystem: host,
    writes,
    migrate: (file, previous, next) => {
      const destination = resolve(file);
      if (!files.has(destination) || files.get(destination) !== previous)
        throw new Error(`Fixture migration predecessor mismatch: ${file}`);
      files.set(destination, next);
    },
  };
}
