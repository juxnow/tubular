import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  type AuthorizationDecision,
  bindTool,
  createToolRuntime,
  defineTool,
} from "../src/typed-tools/index.js";
import { compileToolSchemas, type ToolSchemas } from "../src/typegen/index.js";
import {
  type GreetingInput,
  type GreetingOutput,
  greet,
  type HostContext,
} from "./fixtures/greeting-tools.js";
import { greetingScenario, scenarioSeeds } from "./fixtures/scenarios.js";

let schemaMap: {
  /** Contracts compiled from the real fixture handler before this suite runs. */
  greet: ToolSchemas;
};
beforeAll(() => {
  const schemas = compileToolSchemas({
    tsconfigPath: "test/fixtures/tsconfig.json",
    entryFile: "greeting-tools.ts",
    functionNames: ["greet"],
  });
  const greet = schemas["greet"];
  if (!greet) throw new Error("Missing greeting fixture schema");
  schemaMap = { greet };
});

describe("typed tool runtime", () => {
  it("uses captured schemas for renamed bindings and refuses a replacement schema map", async () => {
    const factory = bindTool(greet, schemaMap.greet, {
      entry: "tools.ts",
      exportName: "greet",
      sourceDigest: "a".repeat(64),
    });
    const definition = factory({ name: "hello", description: "Say hello", effect: "read" });
    const runtime = createToolRuntime({ definitions: [definition], authorize: () => "ALLOW" });
    expect(await runtime.invoke("hello", { name: "Tony" }, { tenant: "JUX" })).toMatchObject({
      status: "success",
    });
    expect(() =>
      createToolRuntime({
        definitions: [definition],
        schemas: schemaMap,
        authorize: () => "ALLOW",
      }),
    ).toThrow(/separate schema map/);
  });
  it.each(scenarioSeeds)(
    "executes the actual compiled handler against trusted context (seed %i)",
    async (seed) => {
      const { input, context } = greetingScenario(seed);
      const schemas = schemaMap;
      const authorize = vi.fn(() => "ALLOW" as const);
      const runtime = createToolRuntime({
        definitions: [
          defineTool({
            name: "greet",
            description: "Greet someone",
            effect: "read",
            handler: greet,
          }),
        ],
        schemas,
        authorize,
      });
      expect(runtime.list()[0]?.inputSchema).toEqual(schemas["greet"]?.inputSchema);
      expect(await runtime.invoke("greet", input, context)).toEqual({
        status: "success",
        output: { greeting: `${context.tenant}: Hello, ${input.name}${input.excited ? "!" : "."}` },
      });
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          input,
        }),
      );
      expect(
        await runtime.invoke("greet", { ...input, tenant: "imposter" }, context),
      ).toMatchObject({ status: "invalid_input" });
    },
  );

  it.each<AuthorizationDecision>(["ASK", "DENY"])(
    "does not run a handler on %s",
    async (decision) => {
      const handler = vi.fn(greet);
      const runtime = createToolRuntime({
        definitions: [defineTool({ name: "greet", description: "Greet", effect: "read", handler })],
        schemas: schemaMap,
        authorize: () => decision,
      });
      expect(await runtime.invoke("greet", { name: "Tony" }, { tenant: "JUX" })).toEqual({
        status: decision.toLowerCase(),
      });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each(["draft", "workspace-write", "external-write", "destructive"] as const)(
    "requires the trusted kernel for %s even after host authorization",
    async (effect) => {
      const handler = vi.fn(greet);
      const authorize = vi.fn(() => "ALLOW" as const);
      const runtime = createToolRuntime({
        definitions: [defineTool({ name: "greet", description: "Greet", effect, handler })],
        schemas: schemaMap,
        authorize,
      });
      expect(await runtime.invoke("greet", { name: "Tony" }, { tenant: "JUX" })).toEqual({
        status: "kernel_required",
      });
      expect(authorize).toHaveBeenCalledOnce();
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed input before authorizing or running, and rejects malformed output", async () => {
    const authorize = vi.fn(() => "ALLOW" as const);
    const handler = vi.fn(
      (
        _input: GreetingInput,
        _context: HostContext,
      ): {
        /** Deliberately invalid numeric output used to prove the string contract fails closed. */
        greeting: number;
      } => ({ greeting: 123 }),
    );
    const runtime = createToolRuntime({
      definitions: [defineTool({ name: "greet", description: "Greet", effect: "read", handler })],
      schemas: schemaMap,
      authorize,
    });
    expect(await runtime.invoke("greet", { name: 42 }, { tenant: "JUX" })).toMatchObject({
      status: "invalid_input",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(await runtime.invoke("greet", { name: "Tony" }, { tenant: "JUX" })).toMatchObject({
      status: "invalid_output",
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("fails closed when authorization throws", async () => {
    const handler = vi.fn(greet);
    const definition = defineTool({ name: "greet", description: "Greet", effect: "read", handler });
    const throwing = createToolRuntime({
      definitions: [definition],
      schemas: schemaMap,
      authorize: () => {
        throw new Error("offline");
      },
    });
    expect(await throwing.invoke("greet", { name: "Tony" }, { tenant: "JUX" })).toEqual({
      status: "authorization_error",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("holds the validated input stable while awaiting authorization", async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = createToolRuntime({
      definitions: [
        defineTool({ name: "greet", description: "Greet", effect: "read", handler: greet }),
      ],
      schemas: schemaMap,
      authorize: async (): Promise<AuthorizationDecision> => {
        await wait;
        return "ALLOW";
      },
    });
    const input = { name: "Tony" };
    const pending = runtime.invoke("greet", input, { tenant: "JUX" });
    input.name = "Changed";
    release?.();
    expect(await pending).toEqual({ status: "success", output: { greeting: "JUX: Hello, Tony." } });
  });

  it("gives handlers a separate mutable input while preserving the authorized snapshot", async () => {
    const authorize = vi.fn(() => "ALLOW" as const);
    const mutate = (input: GreetingInput, context: HostContext): GreetingOutput => {
      input.name = "friend";
      return greet(input, context);
    };
    const runtime = createToolRuntime({
      definitions: [
        defineTool({ name: "greet", description: "Greet", effect: "read", handler: mutate }),
      ],
      schemas: schemaMap,
      authorize,
    });
    expect(await runtime.invoke("greet", { name: "Tony" }, { tenant: "JUX" })).toEqual({
      status: "success",
      output: { greeting: "JUX: Hello, friend." },
    });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ input: { name: "Tony" } }));
  });

  it("rejects duplicate or absent schemas and isolates immutable registry snapshots", async () => {
    const definition = defineTool({
      name: "greet",
      description: "Greet",
      effect: "read",
      handler: greet,
    });
    expect(() =>
      createToolRuntime({
        definitions: [definition, definition],
        schemas: schemaMap,
        authorize: () => "ALLOW",
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      createToolRuntime({ definitions: [definition], schemas: {}, authorize: () => "ALLOW" }),
    ).toThrow(/Missing schemas/);
    expect(() =>
      Reflect.apply(createToolRuntime, undefined, [{ definitions: [], schemas: {} }]),
    ).toThrow(/authorization/);
    expect(() =>
      createToolRuntime({
        definitions: [definition],
        schemas: { greet: { inputSchema: { type: "string", format: "email" }, outputSchema: {} } },
        authorize: () => "ALLOW",
      }),
    ).toThrow(/unsupported/);
    const getter = vi.fn(() => "object");
    const unsafeSchema = Object.defineProperty({}, "type", { enumerable: true, get: getter });
    expect(() =>
      createToolRuntime({
        definitions: [definition],
        schemas: { greet: { inputSchema: unsafeSchema, outputSchema: {} } },
        authorize: () => "ALLOW",
      }),
    ).toThrow(/plain JSON/);
    expect(getter).not.toHaveBeenCalled();
    const schemas = structuredClone(schemaMap);
    const runtime = createToolRuntime({
      definitions: [definition],
      schemas,
      authorize: () => "ALLOW",
    });
    const required = schemas.greet.inputSchema.required;
    if (!required) throw new Error("Greeting fixture must require a name");
    required.splice(0);
    expect(Object.isFrozen(runtime.list())).toBe(true);
    expect(Object.isFrozen(runtime.list()[0]?.inputSchema)).toBe(true);
    expect(await runtime.invoke("greet", {}, { tenant: "JUX" })).toMatchObject({
      status: "invalid_input",
    });
    expect(await runtime.invoke("absent", {}, { tenant: "JUX" })).toEqual({ status: "not_found" });
  });
});
