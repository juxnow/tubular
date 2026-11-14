import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compileTypeSchemas } from "../src/typegen/index.js";

const schemas = compileTypeSchemas({
  tsconfigPath: "scripts/tsconfig.contracts.json",
  entryFile: "../src/contracts/tool-results.ts",
  typeNames: ["ToolInputValidationFailure"],
});
const output = "src/generated/runtime-contracts.ts";
const content = `// Generated from authored runtime boundary types. Do not edit.\nexport const runtimeContractSchemas = ${JSON.stringify(schemas, null, 2)} as const;\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== content)
    throw new Error(`Generated runtime contracts are out of date: ${output}`);
} else {
  mkdirSync("src/generated", { recursive: true });
  writeFileSync(output, content);
}
