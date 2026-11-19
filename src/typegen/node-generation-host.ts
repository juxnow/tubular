import { readFileSync, writeFileSync } from "node:fs";
import type { GenerationHost } from "./command.js";
import { createNodeCompilerFileSystem } from "./file-system.js";

/** Connect CLI artifact access to Node without applying TypeScript's source-text normalization. */
export function createNodeGenerationHost(): GenerationHost {
  return {
    ...createNodeCompilerFileSystem(),
    readArtifact: (file) => {
      try {
        return readFileSync(file);
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      }
    },
    writeFile: (file, content) => writeFileSync(file, content, "utf8"),
  };
}
