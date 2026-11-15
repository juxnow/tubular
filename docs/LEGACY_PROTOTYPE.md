# The earlier Tubular prototype

Historical prototype documentation follows. Tubular now reuses this kernel through its generated typed capability path; see [GOVERNED_RUNTIME.md](GOVERNED_RUNTIME.md). The protocol experiments below remain distinct from a finalized MCCP specification, and the proposal-only stdio demo still cannot execute effects.

**Shared context. Bounded agency. Ready for the tubes.**

The earlier prototype combines an in-memory runtime with a portable semantic contract. This contract is the current implementation associated with the emerging Perspective concept. A projection compiler validates the contract and derives documentation and adapter projections. That compiler is one part of the direction called Through the Looking Glass, not a complete portal.

The prototype's Perspective definition describes capabilities, resources, context, authority, effects, execution semantics, and lifecycles without choosing a model provider or transport. It is a concrete contract model, not a complete representation of someone's personal perspective. See [Perspective contract](PERSPECTIVE_CONTRACT.md) for its experimental vocabulary and limits.

## The first working slice

The initial vertical slice proves both a portable semantic description and one bounded runtime path:

1. Author executable validation and explicit portable semantics in the `ContractRegistry`.
2. Compile that registry into a deterministic, content-addressed `PerspectiveDefinition`.
3. Validate the manifest's identifiers, references, schemas, authority, effects, and lifecycle semantics.
4. Feed the manifest to the projection compiler to produce a contract catalog, proposal-only MCP descriptors, and documentation-only OpenAPI.
5. Select context sources explicitly and package bounded snapshots into a portable handoff envelope.
6. Bind an agent to the Totally Tubular capability-lease profile.
7. Validate a proposal, apply policy, require exact human approval when declared, and dispatch through a registered adapter.
8. Produce an execution receipt and verify the in-memory audit hash chain.
9. Expose an optional MCP stdio adapter where models can only propose actions and inspect redacted status.

The included adapter writes only to an in-memory workspace. The demo performs no network or filesystem effects.

## Run it

```sh
npm install
npm run check
npm run demo
```

Generated artifacts appear in `docs/generated/`:

- `perspective-manifest.json`: the canonical portable semantic manifest.
- `contracts.json`: Looking Glass's capability catalog projection.
- `mcp-tools.json`: proposal-only MCP descriptor projection for the Totally Tubular profile.
- `openapi.json`: documentation-only OpenAPI-shaped projection with no network endpoint claim.

To start the deliberately non-effecting MCP demonstration server:

```sh
npm run mcp
```

The MCP entrypoint has a short-lived, hardcoded demo binding. It has no approval authority, executor, persistence, credentials, or ability to complete an effect. Proposal-only MCP is one optional Totally Tubular adapter and profile, not a requirement of Perspective. See [MCP gateway](MCP_GATEWAY.md) before adapting it.

## Architecture

```text
ContractRegistry
    -> PerspectiveDefinition
    -> projection compiler
        -> perspective-manifest.json
        -> contracts.json
        -> mcp-tools.json
        -> openapi.json

PerspectiveDefinition
    +-> Totally Tubular reference runtime and authority profile
    +-> AAPI-compatible application contracts
    +-> MCP, WebMCP, HTTP, CLI, Discord, and UI adapters
```

The current executable runtime path remains:

```text
Context Manifest -> Action Proposal -> Policy -> Optional Exact Approval
    -> Effect Adapter -> Execution Receipt -> Audit Chain
```

See [Architecture](ARCHITECTURE.md), [Perspective contract](PERSPECTIVE_CONTRACT.md), [Trust model](TRUST_MODEL.md), and [MCP gateway](MCP_GATEWAY.md) for the boundaries behind those flows.

## Implementation status

Implemented and tested now:

- Immutable, bounded context manifests and portable handoff envelopes
- Exact-manifest capability leases with expiry, revocation, effect ceilings, resource scopes, and use budgets
- Canonical runtime contracts with closed input and output validation
- A serializable `PerspectiveDefinition` with deterministic normalization, content identity, reference validation, and conformance checks
- Orthogonal state, external-interaction, reversibility, and disclosure semantics
- Perspective invocation and outcome envelopes plus an explicit AAPI v0 compatibility adapter
- Exact-digest human approval and policy re-evaluation before dispatch
- Idempotent adapter dispatch, execution receipts, and an in-memory hash-chained audit log
- Proposal-only MCP over stdio with a trusted launcher binding, redacted status, call limits, pending limits, and a 1 MiB transport ceiling
- A projection compiler producing deterministic manifest, contract, MCP, and OpenAPI-shaped artifacts

Deliberately not claimed yet:

- Durable or distributed persistence
- External identity authentication, secret management, or encrypted context storage
- A production effect adapter or provider integration
- A stable cross-language Perspective specification, untrusted-document parser, compatibility analyzer, or projection-fidelity diagnostics
- Production MCP, WebMCP, HTTP, CLI, Discord, or UI bindings generated from the manifest
- An optional operator or approval interface
- Deployment, telemetry, or an HTTP API

## Concepts and current implementation

- **Perspective** is the chosen direction for the portable capability contract and a broader idea about individual viewpoints. The prototype implements a contract model; it does not implement that broader idea in full.
- **Through the Looking Glass** is the portal in the architecture's direction. The existing projection compiler is one piece of that direction, not a complete portal.
- **sincopar** is the name for the context-plane direction; “con text” is surrounding creative phrasing. The prototype offers selected, in-memory context manifests, not a finished personal context plane.
- **Tubular** is the TypeScript library and includes this experimental runtime profile.
- **AAPI** (Agentic Application Programming Interface) and **MCCP** (Model Context & Convergence Protocol) are technologies. The experiments here do not establish a finished MCCP standard.
- **Serenity** is a separate future service for curated personal context planes and plugins.

No license has been selected yet.
