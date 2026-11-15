<p align="center">
  <img src="assets/brand/logo/tubular-logo-960.png" alt="Tubular" width="480">
</p>
<h6 style="text-align: center;">√Travesty ?= <br>
...traversable && totally TRUCKIN' Tubular, dude ✌︎㋡</h6>

# Technology should meet you where you are.

Too many tools ask people to adapt to them: learn another interface, repeat the same story, remember where everything lives, and somehow make it all work together. What if your tools could meet you with the context you choose, so you could spend less energy translating yourself and more on what you actually want to do?

That is the direction I'm building toward. Your experiences, your preferences, your work, and your perspective matter. Some context belongs to you alone; some can be shared when you choose. Technology should help you navigate those boundaries, not erase them.

**Tubular is the TypeScript library I'm building underneath that vision.** Today it is a toolkit for developers building capabilities for software and AI assistants. It can generate machine-readable contracts, validate tool calls, and connect tools to MCP. It is an early implementation, not yet the personal assistant or context experience described above.

## The world we're building ∴

- **Tubular** is the developer library: the tubes and tools for building capabilities from TypeScript declarations.
- **Perspective** is the direction for expressing what a system can do, what context it needs, what authority it requires, and what an action can affect. Each person's perspective is more than a schema; the existing portable contract represents only part of this idea.
- **Through the Looking Glass** is the portal. The current prototype can project contracts into different forms; that is one piece of the direction, not a completed portal.
- **con text, sincopar:** **sincopar** is the context plane, the direction for selecting, organizing, and carrying context across perspectives.
- **Serenity** is the envisioned model-agnostic service for delivering a personal context experience. It remains future work.

**AAPI** means Agentic Application Programming Interface. **MCCP** means Model Context & Convergence Protocol. Both are technologies in this work; MCCP is not yet a finalized specification.

If you're here because a friend shared this, you don't need to know TypeScript to understand the reason behind it. If you do want to build with Tubular, the examples below are for you.

The internet is a series of tubes. Tubular is for the things we send through them: capabilities, contracts, and the context that helps an agent know what's what. Declare your TypeScript once; let the tooling connect the pieces.

It's flower power with a compiler. It's a little bit of skate-park radical, a little bit of software architecture, and a whole lot of care about what travels through the context-delivery lane.

**√(Tone²) = |Tone|.** For a nonnegative Tone, the radical takes you right back to Tone. The tone? Totally tubular.

And because the details matter: **13 ∈ ℙ**, where ℙ is the set of prime numbers. A favorite number and a little signature in the margins.

**TypeScript-first building blocks for agentic application programming interfaces.** Declare a tool's input, output and implementation in TypeScript. Tubular derives machine-readable schemas, validates calls against those schemas, and exposes the same capabilities to MCP clients. The schemas are contracts that software can consume, not just documentation.

∴ From [villagealchemist](https://github.com/villagealchemist), in the JUX universe.

The name nods to the internet's [series-of-tubes remix](https://www.youtube.com/watch?v=EtOoQFa5ug8): Paul Holcomb made the mix, and Gavin of 13tongimp made the video. Different tubes; excellent energy.

## Try the example

Requirements: Node.js 24 or newer and npm. In a source checkout with dependencies installed:

```sh
npm ci
npm run example
npm run example:governed
```

The hello example retains the original read-only API. The governed example generates a binding from `examples/governed/tools.ts`, denies an out-of-scope request, requires exact approval, executes an in-memory write, replays its receipt without repeating the write, and verifies the audit chain. Its human review is explicitly simulated. No model provider or network service is required.

## Working on Tubular ∴

| Command | What it does |
| --- | --- |
| `npm run build` | Build the library. |
| `npm test` | Run the tests. |
| `npm run docs:check` | Check source documentation and generated contracts. |
| `npm run docs` | Regenerate the contract artifacts. |
| `npm run check` | Run the full project check. |
| `npm run example` | Build and run the read-only example. |
| `npm run example:governed` | Build and run the governed example. |

`docs` regenerates checked-in documentation. The examples build and regenerate example files; `docs:check` checks documentation without rewriting it.

See [test scenarios and boundaries](docs/TESTING.md) for source-derived fixtures, seeded data, in-memory generation, and the separate packed-consumer check.

## Declare a capability

```ts
export interface ProjectQuery {
  /** Words to match in a project name. */
  query: string;
  limit?: number;
}

export interface ProjectMatches {
  projects: string[];
}

export interface WorkspaceContext {
  projects: readonly string[];
}

/** @tubular */
export function findProjects(input: ProjectQuery, context: WorkspaceContext): ProjectMatches {
  return {
    projects: context.projects
      .filter((name) => name.toLowerCase().includes(input.query.toLowerCase()))
      .slice(0, input.limit ?? 10),
  };
}
```

Generate a JSON schema map from the exported, annotated functions. Entry paths are relative to the directory containing the TypeScript project file; output paths are relative to the current directory. The output directory must exist.

```sh
npx tubular generate --project tsconfig.json --entry src/tools.ts --out generated/schemas.json --bindings generated/tools.ts
```

Use `--functions findProjects,otherTool` to select named exported functions explicitly instead of using `@tubular`. The first argument becomes the model-facing input schema; the return type, including an awaited `Promise`, becomes the output schema. An optional second argument belongs to the trusted host and is never part of the input schema.

The compiler supports closed objects, structural object intersections, required and optional properties, mutable and readonly arrays, JSON primitives, literal types, and unions of supported types. Unsupported constructs, such as recursive types, `any`, index signatures, tuples, primitive brands, and explicit function `this` parameters, fail compilation. Tool inputs must have a top-level object schema. MCP outputs may be objects or unions containing only object alternatives. The compiler checks the TypeScript project before generating and requires `strictNullChecks` (or `strict`). These are JSON contracts: optional properties may be omitted, but explicit JavaScript `undefined` is not JSON.

Use the same command with `--check` in CI to fail when checked-in generated schemas have drifted from the TypeScript source.

```sh
npx tubular generate --project tsconfig.json --entry src/tools.ts --out generated/schemas.json --bindings generated/tools.ts --check
```

## Run and expose it

The generated TypeScript module imports the intended handler directly and captures its schemas in a factory. Choose the public name and metadata at the host boundary. There is no handler or schema-map replacement option on that factory.

```ts
import { createToolRuntime } from "@juxnow/tubular";
import { findProjects } from "../generated/tools.js";

const runtime = createToolRuntime({
  definitions: [
    findProjects({
      name: "projects.find",
      description: "Find projects in the selected workspace.",
      effect: "read",
    }),
  ],
  authorize: ({ tool, context }) =>
    tool.effect === "read" && context.projects.length > 0 ? "ALLOW" : "DENY",
});

const context = { projects: ["Tony context plane", "Tubular"] };
const result = await runtime.invoke("projects.find", { query: "tony" }, context);
```

This lightweight runtime remains read-only, with a mandatory host authorization callback. Its `ASK` result alone is not an approval workflow and it has no kernel audit. Non-read effects return `kernel_required`. Use the governed runtime below for leases, exact approval, audit, and effectful execution. In either path, a `read` classification is a trusted developer declaration; TypeScript cannot prove purity. Output validation runs after the handler and cannot undo side effects.

Generated bindings include the entry path, export name, and a SHA-256 fingerprint of local project sources, generated schemas, and compiler version. `--check` detects implementation-only changes as well as schema drift. It also detects edited generated bindings without rewriting them. The fingerprint is build provenance, not authentication or runtime code attestation. Keep the generation project focused on capability sources, typecheck generated bindings with the application, and run the exact generation command with `--check` in CI. The original `defineTool` plus schema-map API remains available for compatibility; it still relies on manual name pairing.

## Governed execution

Use `createGovernedToolRuntime` with generated definitions whose handlers accept `GovernedToolContext`. Each definition supplies a trusted resource resolver. Non-read tools default to `exact-human` approval; an explicit `approval: "none"` still requires a valid lease and all kernel policy checks.

The host registers issuer, context-registration, and approval authority objects when constructing the runtime. It selects and classifies context with provenance, issues a scoped lease binding the manifest digest, and opens an opaque session. The model supplies only capability arguments. `propose` validates the input and returns an exact proposal and approval challenge. The host reviews that proposal, calls the kernel's approval method with its authority object, and calls `execute` with the original proposal ID and session. Execution rechecks policy and approval, validates the handler result, and produces a receipt and audit events. See the complete [host example](examples/governed/run.ts) and [governed runtime contract](docs/GOVERNED_RUNTIME.md).

`invoke` offers adapter convenience: an approval-required proposal returns `ask` with a proposal ID and digest, and an approval-free proposal executes through the same kernel. Only the host control surface can approve or resume. Keep the runtime's raw kernel and authority objects out of model access.

The current integration enforces canonical workspace resource scopes. State, deduplication, approvals, and audit are in memory. Restart recovery, authenticated human review, generalized resource policies, and durable effect reconciliation are unfinished. Do not infer those properties from a passing demo.

For MCP, bind the same runtime and a trusted session context:

```ts
import { createTypedMcpServer } from "@juxnow/tubular/mcp";

const server = createTypedMcpServer({ runtime, context });
// Connect the returned MCP SDK server to the transport your host controls.
```

The same catalog can drive other consumers:

```ts
import { projectCapabilityManifest, projectTypedOpenApi } from "@juxnow/tubular";

const catalog = projectCapabilityManifest(runtime, { name: "projects" });
const openapi = projectTypedOpenApi(runtime, { title: "Projects", version: "0.1.0" });
```

The OpenAPI projection describes a possible HTTP interface; it does not provide an HTTP server or policy enforcement for one.

For the governed runtime, pass an opaque session as the MCP context. The MCP adapter returns a proposal reference for `ask`, without exposing approval, execution, leases, or context contents as tools. An approval-free capability can execute through the kernel. HTTP authentication, input/request limits, bearer-token audience validation where applicable, and session lifecycle are host transport responsibilities; this package does not start an HTTP endpoint or configure those protections for you.

## What's included

- A TypeScript compiler API and `tubular` CLI for deriving a bounded JSON Schema subset from named functions and types.
- Direct generated handler bindings, source provenance, and a non-writing drift check.
- A schema validator, a read-only runtime, and an in-memory governed runtime connected to the existing kernel.
- An MCP SDK adapter with tool discovery and actual calls through that runtime.
- Capability manifest and OpenAPI 3.1 contract projections from the same runtime descriptors. The OpenAPI document does not itself run an HTTP server.
- The earlier experimental protocol vocabulary, proposal-only gateway and projections, plus the kernel now reused by the governed typed path. See [the prototype notes](docs/LEGACY_PROTOTYPE.md) and [trust model](docs/TRUST_MODEL.md).

`npm run check` verifies generated documentation without rewriting it, typechecks and builds the library, runs tests, checks generated example bindings, runs the governed example, and tests the packed package in an isolated consumer directory. That offline consumer uses the installed dependency versions; it is not a fresh dependency-resolution or cross-platform compatibility claim.

This is a first implementation, not a claim that every part of the broader AAPI, MCCP, context-plane and multi-provider vision is finished. The package is marked private pending a release and licensing decision. This build has not been published.
