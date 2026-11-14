import { readFile } from "node:fs/promises";
import { createToolRuntime, defineTool } from "../../dist/index.js";
import { findProjects } from "./build/tools.js";

const schemas = JSON.parse(await readFile(new URL("./schemas.json", import.meta.url), "utf8"));
const runtime = createToolRuntime({
  definitions: [
    defineTool({
      name: "findProjects",
      description: "Find projects in the selected workspace.",
      effect: "read",
      handler: findProjects,
    }),
  ],
  schemas,
  authorize: ({ tool }) => (tool.effect === "read" ? "ALLOW" : "DENY"),
});

const context = { projects: ["Tony context plane", "Tubular", "Serenity"] };
console.log("Descriptor:", JSON.stringify(runtime.list(), null, 2));
console.log(
  "Invocation:",
  JSON.stringify(await runtime.invoke("findProjects", { query: "tony" }, context), null, 2),
);
