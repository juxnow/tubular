# Source documentation and generated contracts

Tubular derives typed tool contracts from an exported function, its first parameter, and its awaited return type. A second parameter is trusted host context and is excluded from model input. Generated bindings import that exact handler and capture its schemas and discovery metadata together. Prefer these bindings for new applications; the legacy `defineTool` API still depends on manually pairing names and schemas.

Leading JSDoc on interfaces and properties becomes JSON Schema descriptions. Function prose becomes the capability description. `@remarks` is appended to that prose. Put documentation on its own line immediately before the declaration or property so TypeScript attaches it to the intended symbol. Comments describe semantics but do not create authority.

The [read example](../examples/hello/tools.ts) and [governed append example](../examples/governed/tools.ts) document their models and functions. The [governed host](../examples/governed/run.ts) uses the source function description without repeating it in runtime configuration. Its approval is simulated and its effects are in memory.

## Supported model annotations

| Source declaration | Generated meaning and runtime behavior |
| --- | --- |
| Interface/property prose and `@remarks` | Schema description; explanatory only |
| `@title` | Schema title; display only |
| `@example` followed by JSON | Schema examples array; each example must satisfy the schema |
| `@default` followed by JSON | Validated documentation default; never inserted and never makes a required property optional |
| `@deprecated` | Schema deprecation annotation; does not block calls |
| Numeric `@minimum`, `@maximum` | Enforced inclusive numeric bounds |
| Numeric `@exclusiveMinimum`, `@exclusiveMaximum` | Enforced exclusive numeric bounds, expressed as numbers |
| Numeric `@isInt` | Enforced integer type; add bounds when JavaScript safe-integer limits matter |
| String `@minLength`, `@maxLength` | Enforced length in Unicode code points, not bytes or UTF-16 code units |
| Array `@minItems`, `@maxItems` | Enforced array length bounds, expressed as nonnegative safe integers |
| String `@pattern` | Enforced ECMAScript regular expression in Unicode mode; no implicit anchoring, delimiters, or flags |
| String `@format uuid` | Asserted plain hyphenated UUID format, case-insensitive; UUID URNs are not plain UUIDs |
| TypeScript literal unions | Enforced allowed values |
| Optional property and explicit null union | Omission and null remain distinct; undefined is not JSON |

Examples and defaults use JSON syntax, including double quotes for strings. Repeated example tags append examples. Repeated validation tags, malformed JSON, incompatible types, invalid examples/defaults, contradictory bounds, and literal types that cannot satisfy their annotations fail compilation with a location. Numeric and string constraints may apply to homogeneous unions with explicit null; null remains unaffected. Constraints on mixed string/number unions are rejected.

```ts
/** Search inside the host-selected workspace. */
export interface SearchInput {
  /**
   * Substring to match without case sensitivity.
   * @minLength 1
   * @maxLength 100
   * @example "tubular"
   */
  query: string;

  /**
   * Maximum matches. The handler uses 10 when omitted.
   * @isInt
   * @minimum 1
   * @maximum 100
   * @default 10
   */
  limit?: number;
}
```

## Function metadata and projections

| Function source | Capability metadata | Native projection |
| --- | --- | --- |
| Prose and `@remarks` | Description | MCP description; OpenAPI operation description |
| `@summary` | Title | MCP title; OpenAPI summary |
| `@returns` or `@return` | Result description | OpenAPI success response description |
| `@deprecated` | Deprecation annotation | OpenAPI operation deprecation; no corresponding native MCP field here |
| `@example` followed by JSON | Input schema example | Shared input schema in MCP and OpenAPI |
| `@tubular` | CLI discovery marker | No authorization or validation meaning |

The host may deliberately override a bound tool's description. Otherwise the source function supplies it. Source schemas travel through runtime descriptors, capability manifests, OpenAPI components, and native MCP definitions. Object-only output unions acquire their implied object root when projected to MCP. Metadata never changes the identity, lease, selected context, or approval supplied by the trusted host.

## Unsupported features and limits

Only UUID is an asserted format. Date/time, URI, email, and other format tags fail rather than advertise unimplemented validation. Multiple-of constraints, unique items, dictionary/property-count constraints, custom validators, and TSOA-specific tags such as `isLong`, `isDate`, and `nullable` are unsupported. Use TypeScript for nullability and allowed values. Unknown contract tags fail clearly.

Explanatory tags such as `@param`, `@throws`, `@see`, and visibility tags remain source documentation. They do not generate assertions, error schemas, authorization, or HTTP status codes. `@inheritDoc` is accepted as tooling metadata but Tubular does not resolve it. Put authoritative property descriptions on the actual property declaration.

Contract annotations on type aliases are rejected because TypeScript can erase their identity when resolving primitives and unions. Put assertions on interface properties. Alias prose is preserved where TypeScript retains the symbol; document the consuming property rather than relying on alias prose. Inherited property annotations are retained. Overriding an annotated property or combining overlapping annotated properties is rejected to avoid silently weakening constraints. Disjoint structural object intersections remain supported; annotated intersection components require one authoritative interface instead.

Recursive models, tuples, open index signatures, class instances, callable properties, generic or overloaded tool handlers, and non-JSON types remain unsupported. Tool input must have an object root. The runtime accepts the compiler's bounded schema vocabulary, not arbitrary JSON Schema, and rejects unsupported keywords before inspecting input. It performs no coercion, default insertion, unknown-key stripping, or effect rollback. Source authors must choose bounded regular expressions; there is no regex execution timeout.

Internal types also have source documentation, but authority objects, methods, opaque sessions, and recursive portable vocabularies are not model arguments. The older experimental portable registry remains a parser-and-schema authoring path. Its canonical registered schemas drive its projections; handwritten parsers require parity tests. The legacy append parser now uses Unicode code-point bounds like its published schema, while its `appendedCharacters` output intentionally counts JavaScript UTF-16 code units.

## OpenAPI and error contracts

Typed projections produce OpenAPI 3.1 with compatible JSON Schema components. The root and every hypothetical operation carry `x-documentation-projection: true` and `x-network-endpoint: false`. There is no HTTP listener, authentication middleware, approval UI, or automatic resumption protocol.

The projected successful body is the validated tool output. A hypothetical 422 response references `ToolInputValidationFailure`, generated from the same named TypeScript interface used by the runtime. Diagnostics describe paths and violated expectations without echoing rejected values. Other named runtime result types distinguish invalid output, pending approval, policy denial, unknown tool, authorization failure, execution failure, and the need for a governed kernel. See [tool-results.ts](../src/contracts/tool-results.ts).

A future HTTP host must implement its status and body mappings. The projection's default response explicitly leaves policy, approval, and execution error mappings open. OpenAPI extensions describe effects, approval, execution, and source provenance; they do not enforce those properties. Native MCP calls use the same runtime with separately supplied host context. Future HTTP transports must explicitly configure request/input limits and bearer-token audience validation where applicable.

The standards check uses `@seriousme/openapi-schema-validator` for OpenAPI 3.1 structure and references, plus Ajv's JSON Schema 2020-12 implementation for embedded schemas. Tests include malformed OpenAPI and invalid embedded schemas. The [JSON Schema validation vocabulary](https://json-schema.org/draft/2020-12/json-schema-validation) defines these bounds and plain UUID semantics. External consumers must configure the assertion behavior they need, especially format checking; discovery alone is not enforcement.

## Generation and verification

```sh
npm run docs
npm run build
npm run example:generate
node dist/cli.js generate --project examples/hello/tsconfig.json --entry tools.ts --out examples/hello/schemas.json
npm run check
```

Generation produces runtime boundary schemas, legacy portable projections, and typed capability/MCP/OpenAPI artifacts. Checks verify these files without rewriting, validate OpenAPI, run Biome and the TypeScript source checker, check documentation coverage, typecheck, build, run tests, check binding drift, execute the governed example, and verify an isolated package consumer.

The documentation guard checks authored declarations and structural members across source, scripts, examples, and tests, excluding generated files. It detects missing leading prose; review must still establish accuracy and usefulness. The source checker separately checks engineering rules such as forbidden assertions, layer dependencies, and uninjected clocks. The pre-commit hook can format and re-stage files; run checks directly when preserving an existing index.

Passing these checks does not establish production authentication, durable authority, persistent audit, restart recovery, or a finalized MCCP specification. AAPI means Agentic Application Programming Interface. MCCP means Model Context & Convergence Protocol. Tubular is the TypeScript library for building with these technologies.
