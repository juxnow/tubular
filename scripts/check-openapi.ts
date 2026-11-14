import { readFileSync } from "node:fs";
import { isJsonObject } from "../src/core/json.js";
import { assertOpenApi31 } from "./openapi-validation.js";

for (const file of ["docs/generated/openapi.json", "docs/generated/typed-openapi.json"]) {
  const document: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isJsonObject(document)) throw new Error(`Expected an OpenAPI object in ${file}`);
  await assertOpenApi31(document);
}
process.stdout.write(
  "OpenAPI 3.1 documents and embedded JSON Schema 2020-12 contracts verified.\n",
);
