#!/usr/bin/env node
import { runGenerateCommand } from "./typegen/command.js";
import { createNodeGenerationHost } from "./typegen/node-generation-host.js";

try {
  process.stdout.write(runGenerateCommand(process.argv.slice(2), createNodeGenerationHost()));
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
