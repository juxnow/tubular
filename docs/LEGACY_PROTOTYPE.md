# Totally Tubular

Historical prototype documentation follows. Tubular now reuses this kernel through its generated typed capability path; see [GOVERNED_RUNTIME.md](GOVERNED_RUNTIME.md). The protocol experiments below remain distinct from a finalized MCCP specification, and the proposal-only stdio demo still cannot execute effects.

**Shared context. Bounded agency. Ready for the tubes.**

Totally Tubular is a reference runtime and authority profile for Port Authority, a provider-neutral semantic contract for agent-operable systems. The repository also contains the first Second Service compiler, which validates that portable contract and derives documentation and adapter projections from it.

Port Authority describes capabilities, resources, context, authority, effects, execution semantics, and lifecycles without choosing a model provider, runtime, transport, or interface. It is not an approval UI, runtime API, or transport. See [docs/PORT_AUTHORITY_PROTOCOL.md](docs/PORT_AUTHORITY_PROTOCOL.md) for the corrected hierarchy and v0 contract.

This repository is a clean-room implementation of MJ-owned architectural ideas. It does not contain employer code or confidential employer material.

## The first working slice

The initial vertical slice proves both a portable semantic description and one bounded runtime path:

1. Author executable validation and explicit portable semantics in the `ContractRegistry`.
2. Compile that registry into a deterministic, content-addressed `PortAuthorityDefinition`.
3. Validate the manifest's identifiers, references, schemas, authority, effects, and lifecycle semantics.
4. Feed the manifest to Second Service to produce a contract catalog, proposal-only MCP descriptors, and documentation-only OpenAPI.
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

- `port-authority-manifest.json`: the canonical portable semantic manifest.
- `contracts.json`: Second Service's capability catalog projection.
- `mcp-tools.json`: proposal-only MCP descriptor projection for the Totally Tubular profile.
- `openapi.json`: documentation-only OpenAPI-shaped projection with no network endpoint claim.

To start the deliberately non-effecting MCP demonstration server:

```sh
npm run mcp
```

The MCP entrypoint has a short-lived, hardcoded demo binding. It has no approval authority, executor, persistence, credentials, or ability to complete an effect. Proposal-only MCP is one optional Totally Tubular adapter and profile, not a requirement of Port Authority. See [docs/MCP_GATEWAY.md](docs/MCP_GATEWAY.md) before adapting it.

## Architecture

```text
ContractRegistry
    -> PortAuthorityDefinition
    -> Second Service
        -> port-authority-manifest.json
        -> contracts.json
        -> mcp-tools.json
        -> openapi.json

PortAuthorityDefinition
    +-> Totally Tubular reference runtime and authority profile
    +-> AAPI-compatible application contracts
    +-> MCP, WebMCP, HTTP, CLI, Discord, and UI adapters
```

The current executable runtime path remains:

```text
Context Manifest -> Action Proposal -> Policy -> Optional Exact Approval
    -> Effect Adapter -> Execution Receipt -> Audit Chain
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PORT_AUTHORITY_PROTOCOL.md](docs/PORT_AUTHORITY_PROTOCOL.md), [docs/TRUST_MODEL.md](docs/TRUST_MODEL.md), and [docs/MCP_GATEWAY.md](docs/MCP_GATEWAY.md) for the boundaries behind those flows.

## Implementation status

Implemented and tested now:

- Immutable, bounded context manifests and portable handoff envelopes
- Exact-manifest capability leases with expiry, revocation, effect ceilings, resource scopes, and use budgets
- Canonical runtime contracts with closed input and output validation
- A serializable `PortAuthorityDefinition` with deterministic normalization, content identity, reference validation, and conformance checks
- Orthogonal state, external-interaction, reversibility, and disclosure semantics
- Port Authority invocation and outcome envelopes plus an explicit AAPI v0 compatibility adapter
- Exact-digest human approval and policy re-evaluation before dispatch
- Idempotent adapter dispatch, execution receipts, and an in-memory hash-chained audit log
- Proposal-only MCP over stdio with a trusted launcher binding, redacted status, call limits, pending limits, and a 1 MiB transport ceiling
- A Second Service compiler producing deterministic manifest, contract, MCP, and OpenAPI-shaped artifacts

Deliberately not claimed yet:

- Durable or distributed persistence
- External identity authentication, secret management, or encrypted context storage
- A production effect adapter or provider integration
- A stable cross-language Port Authority specification, untrusted-document parser, compatibility analyzer, or projection-fidelity diagnostics
- Production MCP, WebMCP, HTTP, CLI, Discord, or UI bindings generated from the manifest
- An optional operator or approval interface
- Deployment, telemetry, or an HTTP API

## Names carried forward

- **Port Authority** is the portable semantic contract. Its v0 nucleus is implemented.
- **Second Service** validates and compiles a Port Authority into conformance and projection artifacts. Its first deterministic compiler is implemented.
- **Totally Tubular** is the reference runtime and its opinionated bounded-authority profile.
- **AAPI** is a concrete compatible application architecture that can publish a Port Authority manifest.
- **context** remains the friendly CLI name for selecting and packaging context.

No license has been selected yet.
