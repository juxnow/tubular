import { Validator } from "@seriousme/openapi-schema-validator";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { isJsonObject, type JsonObject, type JsonValue } from "../src/core/json.js";

/** Validate OAS 3.1 structure/references and each embedded schema using JSON Schema 2020-12. Runs offline. */
export async function assertOpenApi31(document: JsonObject): Promise<void> {
  if (typeof document["openapi"] !== "string" || !document["openapi"].startsWith("3.1."))
    throw new Error("Expected OpenAPI 3.1");
  const result = await new Validator().validate(structuredClone(document));
  if (!result.valid) throw new Error(`Invalid OpenAPI document: ${JSON.stringify(result.errors)}`);
  const validator = new Ajv2020({ strict: false, allErrors: true });
  formats.default(validator);
  // Register the whole document so local component references resolve when
  // compiling each embedded schema through its JSON Pointer.
  validator.addSchema(document, "urn:tubular:openapi-check");
  /** Visit Schema Objects in the OpenAPI document and validate their dialect and local references with Ajv. */
  function visit(value: JsonValue, pointer: string): void {
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const next = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (key === "schema" || pointer === "/components/schemas") {
        if (typeof child !== "boolean" && !isJsonObject(child))
          throw new Error(`Expected a schema at ${next}`);
        if (!validator.validateSchema(child))
          throw new Error(`Invalid JSON Schema at ${next}: ${validator.errorsText()}`);
        validator.compile({ $ref: `urn:tubular:openapi-check#${next}` });
      } else if (isJsonObject(child) || Array.isArray(child)) visit(child, next);
    }
  }
  visit(document, "");
}
