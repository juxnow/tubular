import path from "node:path";
import ts from "typescript";

/** Read-only project access used by the compiler; hosts may supply a virtual workspace. */
export interface CompilerFileSystem {
  /** Whether distinct filename casing identifies distinct project files. */
  readonly useCaseSensitiveFileNames: boolean;
  /** Resolve relative project paths against this directory. */
  getCurrentDirectory(): string;
  /** Read TypeScript source or config text, allowing BOM/encoding normalization; undefined denotes unavailable input. */
  readFile(file: string): string | undefined;
  /** Check file existence without reading or changing its contents. */
  fileExists(file: string): boolean;
  /** Check whether a project or module-resolution directory exists. */
  directoryExists(directory: string): boolean;
  /** Enumerate immediate child directories for TypeScript module resolution. */
  getDirectories(directory: string): string[];
  /** Expand TypeScript configuration includes and excludes without writing files. */
  readDirectory(
    directory: string,
    extensions?: readonly string[],
    excludes?: readonly string[],
    includes?: readonly string[],
    depth?: number,
  ): string[];
  /** Absolute standard-library entry path in this filesystem; referenced lib files resolve beside it. */
  getDefaultLibFileName(options: ts.CompilerOptions): string;
  /** Resolve aliases or symlinks consistently with fileExists and readFile. */
  realpath(file: string): string;
}

/** Create Node project access on demand; importing the compiler does not require a TypeScript system. */
export function createNodeCompilerFileSystem(): CompilerFileSystem {
  const system = ts.sys;
  if (!system)
    throw new Error("No Node compiler filesystem is available; provide fileSystem explicitly");
  return {
    useCaseSensitiveFileNames: system.useCaseSensitiveFileNames,
    getCurrentDirectory: () => process.cwd(),
    readFile: (file) => system.readFile(file),
    fileExists: (file) => system.fileExists(file),
    directoryExists: (directory) => system.directoryExists(directory),
    getDirectories: (directory) => system.getDirectories(directory),
    readDirectory: (...args) => system.readDirectory(...args),
    getDefaultLibFileName: (options) =>
      path.join(path.dirname(system.getExecutingFilePath()), ts.getDefaultLibFileName(options)),
    realpath: (file) => system.realpath?.(file) ?? file,
  };
}

/** Build TypeScript's host around one read-only filesystem, including source and dependency loading. */
export function compilerHost(
  options: ts.CompilerOptions,
  files: CompilerFileSystem,
  currentDirectory = files.getCurrentDirectory(),
): ts.CompilerHost {
  return {
    getDefaultLibFileName: (libraryOptions) => files.getDefaultLibFileName(libraryOptions),
    getDefaultLibLocation: () => path.dirname(files.getDefaultLibFileName(options)),
    getNewLine: () => "\n",
    getCurrentDirectory: () => currentDirectory,
    readFile: (file) => files.readFile(file),
    fileExists: (file) => files.fileExists(file),
    directoryExists: (directory) => files.directoryExists(directory),
    getDirectories: (directory) => files.getDirectories(directory),
    realpath: (file) => files.realpath(file),
    readDirectory: (...args) => files.readDirectory(...args),
    useCaseSensitiveFileNames: () => files.useCaseSensitiveFileNames,
    getCanonicalFileName: (file) => (files.useCaseSensitiveFileNames ? file : file.toLowerCase()),
    getSourceFile: (file, languageVersion) => {
      const content = files.readFile(file);
      return content === undefined
        ? undefined
        : ts.createSourceFile(file, content, languageVersion, true);
    },
    writeFile: () => {
      throw new Error("Schema compilation cannot write project files");
    },
  };
}
