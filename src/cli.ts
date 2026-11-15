#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { runGenerateCommand } from "./typegen/command.js";
import { nodeCompilerFileSystem } from "./typegen/file-system.js";

try {
  process.stdout.write(
    runGenerateCommand(process.argv.slice(2), {
      ...nodeCompilerFileSystem,
      writeFile: (file, content) => writeFileSync(file, content, "utf8"),
    }),
  );
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
