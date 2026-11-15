import ts from "typescript";

/** Read-only project access used by the compiler; hosts may supply a virtual workspace. */
export interface CompilerFileSystem {
  /** Whether distinct filename casing identifies distinct project files. */
  readonly useCaseSensitiveFileNames: boolean;
  /** Resolve relative project paths against this directory. */
  getCurrentDirectory(): string;
  /** Read source or configuration text; undefined means the file does not exist. */
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
  /** Resolve aliases or symlinks consistently with fileExists and readFile. */
  realpath(file: string): string;
}

/** Default Node-backed project reader. Compilation itself never emits files. */
export const nodeCompilerFileSystem: CompilerFileSystem = {
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  readFile: ts.sys.readFile,
  fileExists: ts.sys.fileExists,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
  readDirectory: ts.sys.readDirectory,
  realpath: ts.sys.realpath ?? ((file) => file),
};

/** Build TypeScript's host around one read-only filesystem, including source and dependency loading. */
export function compilerHost(
  options: ts.CompilerOptions,
  files: CompilerFileSystem,
): ts.CompilerHost {
  return {
    ...ts.createCompilerHost(options, true),
    getCurrentDirectory: () => files.getCurrentDirectory(),
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
