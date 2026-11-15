# Proposal-only MCP gateway

This page documents the retained experimental stdio gateway. The generated typed adapter is a separate interface: it invokes a host-bound typed runtime, returns proposal references when approval is needed, and can execute approval-free capabilities through the governed kernel. See [GOVERNED_RUNTIME.md](GOVERNED_RUNTIME.md). Neither adapter supplies an HTTP server or a human approval interface.

The MCP stdio server is one optional adapter for the experimental runtime profile. Proposal-only behavior is a choice of this adapter, not an inherent requirement of every capability contract.

This adapter is intentionally less powerful than the Totally Tubular kernel. It lets an untrusted model ask for an action proposal. It does not let that model approve or execute the proposal.

The canonical generation direction is:

```text
ContractRegistry
  -> PerspectiveDefinition
  -> projection compiler
  -> proposal-only MCP descriptors
```

The documentation generation script writes the portable manifest to `docs/generated/perspective-manifest.json` and this profile's MCP descriptor projection to `docs/generated/mcp-tools.json`. The compiler is one part of the Through the Looking Glass direction, not a complete portal. Each descriptor references the exact source Perspective. The executable stdio adapter currently registers equivalent wrappers directly from the trusted runtime registry and routes calls through `ProposalOnlyGateway`.

See [PERSPECTIVE_CONTRACT.md](PERSPECTIVE_CONTRACT.md) for the experimental contract and [ARCHITECTURE.md](ARCHITECTURE.md) for the layer boundaries.

## Exposed tools

For every capability compiled from the current canonical runtime contracts, the server registers one proposal wrapper:

```text
tt.propose.<canonical-contract-name>
```

The current catalog therefore exposes `tt.propose.workspace.note.append`. Its arguments are validated against the same closed JSON Schema and runtime parser used by the kernel. A successful call records a proposal and returns only a redacted status view.

The `tt.propose.*` wrapper name is projection metadata. The canonical capability remains `workspace.note.append`. An MCP caller must not infer that another Perspective implementation uses this prefix, creates proposals, or has human approval in its lifecycle.

The server also exposes `tt.proposal.status`, which accepts one proposal ID. Status lookup is scoped to the principal fixed by the launcher, so another principal's proposal is indistinguishable from a missing proposal.

Safe status fields are limited to:

- Proposal ID and digest
- Canonical tool name and effect class
- Policy outcome and lifecycle state
- Whether approval is required
- Challenge ID and expiry
- Receipt ID when completed
- Terminal failure code when present

Proposal input, resolved resource, principal ID, lease ID, context manifest ID, source content, approver identity, adapter output, and audit payloads are not returned.

## Trusted binding

The launcher constructs an `AgentBinding` with a principal ID, lease ID, and context manifest ID before the MCP server starts. Those values are not tool arguments, are not derived from MCP client information, and cannot be selected by the model.

The following operations must stay outside every model-facing server:

- Human approval or approval revocation
- Lease issuance, registration, or revocation
- Context registration
- Effect execution or executor registration
- Raw kernel access
- Audit append access
- `exportState`

Those exclusions define this adapter's security profile. They do not prohibit a different conforming adapter from exposing a capability directly when that capability's canonical authority, effects, execution semantics, and runtime policy permit it.

## Guards

- Perspective preserves the closed capability input schema and exact source reference in its generated descriptors.
- The MCP SDK validates incoming arguments against the projected JSON Schema.
- The kernel validates the same input again with the canonical runtime parser.
- The gateway returns only error code and retryability on rejection.
- The demo allows 60 calls per rolling minute.
- The demo binding allows at most 64 live proposals. Expired challenges, revoked approvals, invalid authority, receipts, and terminal failures release their slots.
- The stdio transport rejects a single message larger than 1 MiB.
- Standard output is reserved for JSON-RPC. Transport and startup errors written to standard error are sanitized.
- The server supports current protocol negotiation while serving legacy MCP clients through the SDK compatibility path.

## Run the demonstration

```sh
npm run mcp
```

This entrypoint is a boundary demonstration, not a production agent service. It creates a generated public context manifest and a one-hour lease for `workspace://demo/**`. It intentionally registers no approval authority and no executor, so it cannot complete an effect. All state is process-local and disappears when the process exits.

A production launcher for this profile must supply authenticated identities, durable state, a reviewed Perspective and executable registry, secret-safe context ingestion, separately held authority objects, idempotent adapters, and a separately trusted approval mechanism when the capability requires one. None of those should be reconstructed from model arguments.

An operator or approval UI could consume that trusted mechanism as an optional runtime client.
