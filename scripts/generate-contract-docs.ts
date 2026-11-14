import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createDefaultPortAuthority } from "../src/catalog.js";
import { stablePrettyStringify } from "../src/core/json.js";
import { compileSecondService } from "../src/second-service/compiler.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "../docs/generated");
const portAuthority = createDefaultPortAuthority();
const compilation = compileSecondService(portAuthority);

const check = process.argv.includes("--check");
if (!check) await mkdir(outputDirectory, { recursive: true });

const artifacts = [
  ["port-authority-manifest.json", portAuthority],
  ["contracts.json", compilation.contractCatalog],
  ["mcp-tools.json", compilation.mcpTools],
  ["openapi.json", compilation.openApi],
] as const;

for (const [name, content] of artifacts) {
  const serialized = `${stablePrettyStringify(content)}\n`;
  if (check) {
    if (await readFile(resolve(outputDirectory, name), "utf8") !== serialized) throw new Error(`Generated documentation is out of date: ${name}`);
    continue;
  }
  await writeFile(resolve(outputDirectory, name), serialized, {
    encoding: "utf8",
    mode: 0o644,
  });
}

process.stdout.write(`${check ? "Verified" : "Generated"} ${artifacts.length} contract artifacts in ${outputDirectory}\n`);
