# Test scenarios and boundaries

Run the complete delivery gate with:

```sh
npm run check
```

The suite keeps focused contract and security regressions alongside integration tests. It does not yet implement the future migration-driven, fully end-to-end scenario system. There is no database migration runner, provider authentication, durable execution store, or crash-recovery harness in these fixtures.

## Authored contracts, independent expectations

The small project in `test/fixtures/tsconfig.json` contains the actual handlers exercised by the typed runtime and MCP tests. Their schemas come from those TypeScript declarations. Tests must not maintain a parallel handwritten schema for the same handler. Literal expected values and intentionally malformed schemas remain appropriate assertions and negative cases; they are independent checks of the compiler and validator.

Compile a project once per fixture revision. The compiler API exposes an explicitly scoped snapshot:

```ts
import { createSchemaCompiler } from "@juxnow/tubular/compiler";

const compiler = createSchemaCompiler({
  tsconfigPath: "tsconfig.tools.json",
  entryFile: "tools.ts",
});
const schemas = compiler.compileTools(["search"]);
const bindings = compiler.compileBindings(["search"], "generated/bindings.ts");
```

Creation performs TypeScript diagnostics with checking enabled and requires strict nullability. Reusing the snapshot avoids rebuilding the program for each projection. Changes to source files require a new snapshot. There is no global cache or automatic invalidation. A caller may provide a read-only `CompilerFileSystem`; paths resolve against that host's current directory, and the compiler returns artifacts without emitting files. This host is trusted build infrastructure, not an authority source for runtime tool calls.

## In-memory generation and explicit revisions

`compilerProject` creates a private virtual workspace for each scenario. Source, configuration, and generated artifacts live in memory. Only installed TypeScript standard-library declarations are read from disk. Its configurations require an explicit file list; the fixture adapter does not implement glob expansion or a package manager. The default production filesystem retains TypeScript's normal project discovery.

`generationScenario` loads the authored greeting handler and supplies named revisions for input renaming and implementation-only changes. A migration requires the complete expected predecessor text, so applying a revision twice or to the wrong source fails. Tests assert successful generation, drift detection, source protection, missing artifacts, and the absence of writes during check mode. They do not spawn processes, create temporary directories, or mutate physical files.

These source revisions are a foundation for controlled fixture evolution, not a claim that application data migrations have been designed. Add domain-specific migration preconditions when that architecture exists; do not silently accept arbitrary fixture overwrites.

## Seeded domain data

`scenarios.ts` samples synthetic display names, workspace labels, allowed query terms, category filters, correlation UUIDs, and decimal provider identifiers. Provider records preserve message-to-channel-to-guild relationships. Perspective references are sealed through the actual catalog implementation, rather than invented digest strings. Compatibility tests exercise envelope translation; they do not establish authentication, execute legacy capabilities, or validate their membership in the referenced catalog.

Regression seeds are explicit and appear in test names. Runtime and MCP scenarios use the same source-derived constraints, and negative cases change one field or authority claim at a time. Optional fields stay omitted when testing handler defaults. Each factory call returns new mutable request data; authorization comes from separately supplied host context.

Replay a seeded integration case with:

```sh
npm test -- test/documentation.test.ts -t 'seed 42'
```

This is bounded, repeatable sampling of meaningful values, not unconstrained fuzzing or exhaustive property coverage. Add a failing seed to the regression corpus when expanding scenario coverage. Keep schema expectations independent of the data factory so a factory mistake cannot define its own success criteria.

## Real package boundary

`npm run consumer:check` packs the library into a temporary consumer workspace, invokes the built CLI, compiles generated bindings, executes the runtime, and verifies handler protection and drift failure. Filesystem writes are intrinsic to that package-installation boundary. This separate check exercises the Node adapter that in-memory pipeline tests cannot verify. It uses lockfile-installed dependencies offline, not a fresh dependency resolution or an external provider.

The default Vitest timeout remains unchanged. Diagnose unnecessary project compilation, subprocesses, and shared resources before considering a larger timeout. Use the same worker count when comparing local runs:

```sh
npm test -- --maxWorkers=2 --reporter=verbose
```

Local timing does not certify the remote runner. The GitHub job still needs to run against the changed revision.
