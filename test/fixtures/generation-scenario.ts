import { readFileSync } from "node:fs";
import { compilerProject } from "./compiler-project.js";

/** Load the same authored handler that runtime tests execute into a fresh virtual project. */
export function generationScenario() {
  const source = readFileSync(new URL("./greeting-tools.ts", import.meta.url), "utf8");
  const project = compilerProject(source);
  return {
    project,
    source,
    args: [
      "generate",
      "--project",
      "tsconfig.json",
      "--entry",
      "models.ts",
      "--out",
      "schemas.json",
      "--bindings",
      "bindings.ts",
    ],
    /** Advance the greeting input and its implementation together, refusing a stale predecessor. */
    renameExcitement() {
      project.migrate("models.ts", source, source.replaceAll("excited", "enthusiastic"));
    },
    /** Change only the handler body so schema equality cannot hide implementation drift. */
    reviseGreeting() {
      project.migrate("models.ts", source, source.replace("Hello,", "Welcome,"));
    },
  };
}
