# Architecture

Tubular is the TypeScript library. AAPI means Agentic Application Programming Interface and MCCP means Model Context & Convergence Protocol; both are technologies, and the MCCP specification remains unfinished. Serenity is a separate future service for curated personal context planes and plugins.

Perspective is the direction for describing a viewpoint and the associated capability contract. **Through the Looking Glass** is the portal in the architectural direction; the current projection compiler is one piece, not the entire portal. **sincopar** names the context-plane direction, with “con text” as creative phrasing. Existing in-memory context manifests and contract projections are building blocks, not a finished personal context plane or portal.

The current typed path is:

```text
TypeScript handler and models
  -> schema compiler + generated direct-import binding
  -> capability definition and immutable schemas
       -> read-only runtime with host authorization
       -> governed runtime -> existing kernel -> trusted handler
  -> capability manifest, OpenAPI projection, MCP tools
```

The governed runtime creates canonical kernel contracts from those definitions, reusing schema validation, resource policy, exact approval, execution rechecks, receipts, and audit. Host-created sessions select identity, leases, and sealed context. It is an implemented in-memory integration, with limitations documented in [GOVERNED_RUNTIME.md](GOVERNED_RUNTIME.md).

The sections below describe an experimental portable contract and projection compiler. They are not a finalized MCCP standard, the complete Looking Glass portal, the typed capability manifest, or a live HTTP API.

## Earlier protocol prototype

The prototype implements a portable capability contract and one in-memory runtime profile. The contract represents part of the Perspective direction; it is not a complete representation of a person's perspective.

The detailed protocol vocabulary, compatibility rules, and current limitations are documented in [PERSPECTIVE_CONTRACT.md](PERSPECTIVE_CONTRACT.md).

## Layering and dependency direction

```text
ContractRegistry
  executable validation and resource binding used by this TypeScript runtime
          |
          v
PerspectiveDefinition
  canonical portable semantics for capabilities, context, authority, and effects
          |
          v
projection compiler
  validation, compilation, conformance, and projections
          |
          +-> perspective-manifest.json
          +-> contracts.json
          +-> mcp-tools.json
          +-> openapi.json

PerspectiveDefinition
          +-> in-memory runtime profile
          +-> derived catalog and example adapter projections
```

The `ContractRegistry` remains the executable authoring source for runtime parsers and trusted resource resolution in the current implementation. Every registered contract must also declare its portable targets, contexts, authority, effects, execution behavior, and lifecycle. `perspectiveFromRegistry` copies those reviewed declarations into a normalized `PerspectiveDefinition`; it does not invent them from a tool name or resolver function. The Perspective manifest, not the registry or an adapter, is the canonical portable semantic representation.

The projection compiler consumes the manifest. Downstream projectors receive the Perspective reference and exact digest so their source is inspectable. It must not infer missing semantics from a transport, UI, prompt, or runtime convention.

## Perspective protocol layer

`src/perspective/definition.ts` describes:

- Scope kinds and resource identity schemas.
- Context selection, provenance, integrity, binding, classification, disclosure, and omission semantics.
- Composable authority evidence schemes.
- Orthogonal state interaction, external interaction, reversibility, and disclosure effects.
- Capability inputs, outputs, errors, targets, context requirements, authority, effects, and execution guarantees.
- Capability-specific lifecycle state machines.
- Required and optional namespaced extensions.

The definition is pure JSON-compatible data. It contains no runtime handler, SDK object, network route, command name, live credential, or executable policy function. Deterministic normalization produces a SHA-256 digest and content-derived Perspective ID.

`src/perspective/messages.ts` implements the current v0 invocation and outcome envelopes. `src/perspective/aapi-v0.ts` demonstrates explicit conversion between an AAPI v0 domain shape and those envelopes, including rejection when a conversion would be lossy.

## Looking Glass compiler layer

`src/looking-glass/compiler.ts` verifies Perspective integrity and emits one content-addressed compilation containing:

- A reference to the exact source Perspective.
- A capability catalog projection.
- A proposal-only MCP descriptor projection for the Totally Tubular profile.
- Documentation-only OpenAPI 3.1-shaped output.
- A digest covering the complete compilation.

The documentation build writes:

- `docs/generated/perspective-manifest.json`
- `docs/generated/contracts.json`
- `docs/generated/mcp-tools.json`
- `docs/generated/openapi.json`

The OpenAPI artifact has no servers and marks every synthetic operation with `x-documentation-projection: true` and `x-network-endpoint: false`. It is not an HTTP API.

The current compiler does not yet provide a generic binding language, a projection plugin interface, automated compatibility analysis, or machine-readable loss diagnostics. Those remain explicit v0 limitations.

## Totally Tubular reference-runtime planes

The following planes describe Totally Tubular's implementation profile. They do not define universal Perspective architecture.

### Context building blocks

The current in-memory context implementation creates snapshots from explicitly selected sources. Every snapshot records its classification, disclosure policy, byte length, digest, capture time, and provenance. A manifest records which requested sources were included or omitted. This is a building block for sincopar, not the completed context plane.

### Executable contract plane

The runtime registry owns trusted input and output parsers plus resource resolution. Each contract also carries the semantic metadata that the runtime code alone cannot prove. Its contracts compile into the portable Perspective before Looking Glass creates documentation and adapter projections.

### Authority plane

An authority lease grants a named subject specific tools over specific resource patterns for a limited time and number of uses. A lease sets the maximum permitted effect class and binds the exact context manifest digests that may support an action. Exact-human approval is an additional authority scheme for contracts that require it.

These are Totally Tubular profile choices. Perspective permits other declared authority schemes while preserving the rule that prompt content does not grant authority.

### Execution plane

The runtime turns a validated request into an immutable action proposal. Policy evaluation denies it, allows it, or produces an approval challenge. When required, approval binds the exact proposal digest. The kernel rechecks policy immediately before execution and invokes only the adapter registered for that capability.

The reference `proposal-execution` lifecycle is one lifecycle described by the Perspective manifest. Other compatible capabilities may declare different lifecycles.

### Audit plane

Policy decisions, approval events, execution attempts, and receipts are chained by SHA-256. Verification recomputes the in-memory chain and reports the first invalid event. This does not yet provide durable, independently anchored audit history.

## Optional MCP adapter and profile

The executable MCP stdio server is a narrow adapter over the Totally Tubular runtime. Its trusted launcher fixes the principal, lease, and context manifest before a model request arrives. Models can create a proposal through `tt.propose.<canonical-capability>` or inspect their own redacted proposal through `tt.proposal.status`.

Proposal-only behavior and the `tt.*` names are not canonical Perspective semantics. They are choices made by this MCP projector and runtime adapter. Another MCP binding could safely expose a non-effecting capability directly, or use a different naming convention, if it preserves the manifest's declared authority, effects, and execution guarantees.

Approval, execution, lease issuance, context registration, revocation, audit mutation, and raw state export remain absent from this model-facing wire surface. See [MCP_GATEWAY.md](MCP_GATEWAY.md) for that adapter's exact boundary.

## Trust boundary

```text
UNTRUSTED                                         TRUSTED

model output                                      Perspective manifest
agent plans           invocation or proposal     runtime validators
adapter input     ----------------------->        policy and authority
external context                                  effect dispatch
                                                   outcome evidence
```

The model-facing gateway never receives an authority object, effect executor, unrestricted shell, or implicit permission merely because a capability exists. Context snapshots may contain selected raw content. A trusted caller must classify and filter sources before building a manifest.

At the protocol layer, a digest proves deterministic self-consistency, not authenticated authorship. At the runtime layer, object-capability identity is an in-process authority mechanism, not external user authentication.

## AAPI and adapter boundary

AAPI is the Agentic Application Programming Interface technology and architectural approach. In this prototype, domain capabilities remain independent of Discord, MCP, HTTP, a model provider, or database row types. The compatibility adapter translates the implemented AAPI v0 shapes into Perspective invocations and translates supported outcomes back.

The same dependency rule applies to every adapter:

```text
adapter input -> canonical capability invocation -> application/runtime ports
application outcome -> adapter-specific rendering
```

Never reverse that dependency by making the canonical capability accept Discord objects, MCP request types, HTTP controller types, UI state, or provider SDK responses.
