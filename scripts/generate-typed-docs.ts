import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { projectTypedMcpTools } from "../src/typed-mcp/index.js";
import { projectCapabilityManifest, projectTypedOpenApi } from "../src/typed-projections/index.js";
import { snapshotSchema, type ToolDescriptor } from "../src/typed-tools/index.js";
import { compileToolSchemas } from "../src/typegen/index.js";

const schemas = compileToolSchemas({
  tsconfigPath: "examples/hello/tsconfig.json",
  entryFile: "tools.ts",
  functionNames: ["findProjects"],
});
const tools: ToolDescriptor[] = Object.entries(schemas).map(([name, schema]) => {
  const description = schema.documentation?.description;
  if (!description) throw new Error(`Missing source description: ${name}`);
  return {
    ...schema.documentation,
    name,
    description,
    effect: "read",
    inputSchema: snapshotSchema(schema.inputSchema, name),
    outputSchema: snapshotSchema(schema.outputSchema, name),
  };
});
const catalog = { list: () => tools };
const artifacts = [
  ["typed-capabilities.json", projectCapabilityManifest(catalog, { name: "hello" })],
  [
    "typed-openapi.json",
    projectTypedOpenApi(catalog, { title: "Tubular typed capabilities", version: "0.1.0" }),
  ],
  ["typed-mcp-tools.json", { documentationOnly: true, tools: projectTypedMcpTools(catalog) }],
] as const;
mkdirSync("docs/generated", { recursive: true });
for (const [name, artifact] of artifacts) {
  const file = `docs/generated/${name}`;
  const content = `${JSON.stringify(artifact, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(file, "utf8") !== content)
      throw new Error(`Generated typed documentation is out of date: ${name}`);
  } else writeFileSync(file, content);
}
