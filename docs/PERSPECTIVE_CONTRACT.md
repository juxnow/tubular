# Perspective: experimental capability contract

## Purpose

Perspective is the direction for expressing viewpoints and capability contracts across an agent-operable system. The current prototype implements a portable semantic contract: it identifies what a system can do, what information an operation consumes and returns, what resources it addresses, what authority it requires, what effects it may cause, and how its outcomes are represented. It is not yet the complete personal-perspective concept.

Perspective is not:

- An approval user interface.
- A runtime API.
- A transport protocol.
- An MCP server.
- A workflow engine.
- An assumption that a language model is involved.

A deterministic program, a human-operated client, a scheduled job, an agent, or a model-backed service can all operate against the same Perspective manifest. Models have no special authority in the protocol.

The current protocol identifier is `perspective/v0`. This is an experimental version whose types and compatibility rules may still change before a stable specification is published.

## How the pieces relate

The experimental Perspective manifest is serializable data. It contains no handlers, SDK objects, transport routes, live credentials, or executable policy functions. The current projection compiler verifies a manifest and derives a catalog, proposal-only MCP descriptors, and documentation-only OpenAPI. A projection does not create a live endpoint.

**Through the Looking Glass** is the portal in the architectural direction. The current compiler's projection work is one part of that direction; the complete portal is not yet implemented. AAPI (Agentic Application Programming Interface) and MCCP (Model Context & Convergence Protocol) are technologies; these experiments do not establish a finalized MCCP specification.

**sincopar** names the context-plane direction. “con text” is creative framing around that name. Existing host-selected, in-memory context manifests are a partial implementation, not a completed personal context plane. Serenity is a separate future service.

Tubular's current leases, approvals, policy kernel, receipts, and audit are one in-memory runtime profile. A host remains responsible for identity and for any approval interface; descriptions alone do not enforce authority.

## Canonical definition

The implementation in `src/perspective/definition.ts` defines `PerspectiveDefinition` as the content-addressed form of `PerspectiveBody`. Its canonical fields are:

- `specification`: the Perspective protocol version.
- `name`: a stable lowercase dotted Perspective name.
- `version`: the semantic version of this manifest.
- `title` and `description`: human-readable intent.
- `scopeKinds`: application-defined kinds of scope.
- `resourceKinds`: portable resource identity schemas.
- `contextKinds`: context selection, provenance, integrity, binding, classification, disclosure, and omission semantics.
- `authoritySchemes`: schemas for evidence required to invoke capabilities.
- `effectKinds`: descriptions of state interaction, external interaction, and reversibility.
- `lifecycles`: named state machines for capability execution.
- `capabilities`: the callable semantic operations.
- `requiredExtensions` and `extensions`: explicitly namespaced additions.
- `id` and `digest`: deterministic content identity derived from the canonical body.

Definitions use JSON-compatible data and JSON Schema-shaped objects. Object schemas are closed with `additionalProperties: false` so that accepted input, output, resource identities, and authority evidence are not silently broader than their documentation.

Collections that are semantically unordered are normalized before hashing. Equivalent definitions therefore produce the same digest regardless of declaration order. The digest proves deterministic self-consistency. It is not a digital signature and does not authenticate the author.

## Capability semantics

Each `CapabilityDefinition` includes:

- A stable `id` and independently versioned capability contract.
- Closed input and output schemas.
- Declared error codes and retryability.
- Resource targets resolved from input through JSON Pointer-shaped paths.
- Bounded named context requirements.
- A composable authority expression.
- A complete declared set of possible or guaranteed effects.
- Completion, idempotency, evidence, and unknown-outcome semantics.
- A reference to a declared lifecycle.

Capability IDs are canonical. Names such as an MCP tool name, HTTP operation ID, slash command, or CLI subcommand are bindings chosen by a projector or adapter. They do not rename the capability.

A capability may use a model internally, but model use is not part of its identity unless it materially changes the public semantic contract. A provider SDK type must never leak into its input or output schema.

## Orthogonal effect model

Perspective deliberately does not collapse every consequence into a single ordered risk label. `EffectKindDefinition` represents three independent dimensions:

### State interaction

`state` describes interaction with canonical or owned state:

- `none`
- `read`
- `create`
- `update`
- `delete`

### External interaction

`externalInteraction` describes interaction beyond the local state boundary:

- `none`
- `read`
- `compute`
- `write`

### Reversibility

`reversibility` describes recovery semantics:

- `not-applicable`
- `reversible`
- `compensatable`
- `irreversible`
- `unknown`

These axes are intentionally orthogonal. Reading local context and sending selected fields to an external model is a state read plus external compute and disclosure. Querying a remote system can be an external read without a local state change. Creating a local draft can be a state create with no external interaction. Posting a message can be an external write even if no canonical local state changes.

### Disclosure

Disclosure is declared per effect rather than inferred from external interaction. A `DisclosureDefinition` identifies:

- The data class being disclosed.
- The target port receiving it.
- Whether persistence is forbidden, allowed, required, or unknown.
- The fields that can cross the boundary.

This distinction matters because an external compute can disclose private data without writing application state, while an external write may send only a public identifier. State mutation, external interaction, disclosure, and reversibility must remain separately inspectable.

Totally Tubular's existing labels such as `read`, `draft`, `workspace-write`, `external-write`, and `destructive` are its reference effect vocabulary. Other compatible Perspective manifests may define different effect kinds while preserving the orthogonal fields.

## Context and authority

Context and authority are separate protocol concepts.

A context kind declares how context is selected, whether provenance is required, whether items are content-addressed, how exact binding works, which classification and disclosure labels are recognized, and whether omissions are recorded. A capability declares named context slots with accepted kinds and explicit item and byte bounds.

An authority scheme declares the shape of authority evidence. A capability combines schemes using `none`, `scheme`, `all-of`, or `any-of`. The `promptGrantsAuthority: false` invariant makes the boundary explicit: text in a prompt, message, context item, or model response cannot grant authority.

Totally Tubular currently defines `capability-lease` and `exact-human-approval` schemes. A different runtime may use signed service identity, role membership, delegated OAuth scopes, local ownership, a hardware-backed credential, or another evidence scheme. The protocol describes the requirement without prescribing how the runtime authenticates or stores that evidence.

## Lifecycle and execution

Lifecycles are named semantic state machines. They define an initial state, terminal states, and valid transitions. A capability references a lifecycle rather than receiving a universal approval-oriented state machine.

The Totally Tubular reference manifest currently uses `proposal-execution`, which includes proposal, policy, optional approval, dispatch, success, failure, and outcome-unknown states. This lifecycle belongs to the reference profile. A read-only status capability, an asynchronous batch job, or a streaming inference capability may publish a different lifecycle.

Execution semantics separately declare:

- Synchronous, asynchronous, or either completion.
- Invocation-ID, caller-key, inherent, or no idempotency.
- Whether outcome evidence is required.
- Whether an unknown outcome requires terminal reconciliation or permits a safe retry.

An adapter may implement these semantics more conservatively. It may not silently weaken them.

## Core invariants

Every conforming implementation must preserve these rules:

1. The canonical Perspective manifest is pure serializable data. Executable handlers and policy functions are runtime bindings.
2. Context, identity, scope, and authority remain distinct concepts.
3. Context presence never grants authority.
4. A capability's effects form an upper bound on what an implementation may do.
5. A runtime may impose stricter authority or effect policy, but an adapter may not weaken the canonical requirement.
6. Every resource target refers to a declared resource kind and is resolved from declared input.
7. Every context, authority, effect, and lifecycle reference resolves within the manifest.
8. Every object-shaped schema is closed.
9. A capability invocation and its outcome must be attributable to an exact Perspective and capability version.
10. Provenance and content digests are evidence of claimed lineage and integrity, not proof that a claim is true.
11. Unknown external outcomes are never represented as known failures or automatic retry permission.
12. Provider, SDK, transport, and interface types do not enter canonical capability contracts.
13. Required extensions must be understood. Unknown optional extensions may be ignored without changing base semantics.
14. Projection loss must be explicit and machine-detectable.

## Canonical concerns versus projection concerns

Canonical data answers semantic questions:

- What capability is this?
- What inputs, outputs, and errors are valid?
- Which resources and context can it use?
- What authority evidence is required?
- What state, external, disclosure, and recovery effects can occur?
- What lifecycle and execution guarantees apply?

Projection data answers representation questions:

- What is the MCP tool called?
- Which HTTP method and path represent it?
- Is a generated OpenAPI operation documentation-only?
- Which Discord command invokes it?
- Which CLI syntax maps to its input?
- Which UI control renders an authority challenge?

`inspectPerspectiveBody` currently rejects transport and projection keys such as `mcpName`, `httpMethod`, `operationId`, `path`, `servers`, `transport`, `wrapperName`, `proposalOnly`, `documentationOnly`, and `x-network-endpoint` when they appear as protocol structure. JSON Schemas and authority claims remain opaque domain data, so a capability may legitimately accept a field called `path` or `transport`.

A projection should identify at least:

- The exact source Perspective ID, version, and digest.
- The projector ID and version.
- The target format and binding configuration.
- Whether the projection is lossless or lossy.
- Diagnostics for every semantic field that cannot be represented.
- Whether the artifact is documentation, executable registration metadata, or an actual deployed endpoint.

An OpenAPI-shaped artifact must not claim that synthetic paths are reachable network endpoints. An MCP projection must not imply that calling a generated tool performs an effect if the binding only records proposals. A UI must not reinterpret a displayed control as authority without runtime-verifiable evidence.

## Compatibility rules

The protocol specification version, Perspective version, and capability version are independent.

The Perspective rename is recorded in the package and reference manifest as 0.2.0. See [migration from the 0.1.0 prototype](MIGRATING_0_2.md) for changed symbols, wire keys, and digest handling.

- `specification` identifies the protocol vocabulary.
- The manifest `version` identifies the published system contract.
- Each capability `version` identifies that capability's semantic contract.
- The content digest identifies one exact normalized definition.

Changing canonical content always changes the digest. Authors must also change the appropriate semantic version rather than treating a new digest as a substitute for versioning.

Until an automated compatibility checker exists, v0 uses these conservative rules:

### Usually compatible

- Adding a new capability without changing existing capability semantics.
- Adding an optional input field.
- Widening accepted input while preserving authority and effects.
- Narrowing an output guarantee so existing consumers still receive a valid value.
- Adding an optional extension that base consumers may ignore.
- Adding a new resource, context, effect, authority, or lifecycle definition that no existing capability begins requiring.

### Breaking or security-significant

- Removing or renaming a canonical ID.
- Adding a required input field or narrowing accepted input.
- Widening possible output beyond the previous schema.
- Changing resource target resolution.
- Adding, removing, or materially changing declared effects.
- Adding, removing, or changing authority requirements.
- Changing required context, context bounds, binding, classification, or disclosure semantics.
- Changing idempotency, outcome evidence, unknown-outcome, or lifecycle guarantees.
- Making an optional extension required.
- Reusing a version for different canonical semantics.

Consumers must retain a generic fallback for unknown error codes. This permits a capability to document a newly discovered failure mode without making the wire representation undecodable. If a consumer depends on an exhaustive error union, adding an error remains breaking for that consumer.

Security-significant relaxation can be just as important as strengthening. Removing an authority requirement or disclosure restriction may not break a caller mechanically, but it changes the trust contract and requires explicit review and versioning.

## Current v0 implementation status

Implemented across `src/perspective/definition.ts`, `src/perspective/messages.ts`, `src/perspective/aapi-v0.ts`, and `src/profiles/totally-tubular.ts`:

- Strict TypeScript interfaces for the canonical vocabulary.
- Deterministic normalization and SHA-256 content identity.
- Integrity verification and compact Perspective references.
- Identifier, semantic-version, uniqueness, bounds, and cross-reference checks.
- Closed-schema conformance inspection.
- Rejection of known projection and transport keys in canonical data.
- Required extension naming and presence checks.
- A profile bridge from the current Totally Tubular `ContractRegistry` into a reference `PerspectiveDefinition`.
- A reference vocabulary for workspace resources, exact context manifests, capability leases, exact human approval, effect kinds, and proposal execution.
- Version-pinned invocation and success or failure outcome envelopes.
- An AAPI v0 compatibility bridge for the currently implemented invocation and success-result shapes; conversions reject shapes that cannot be represented.

The registry bridge is an implementation adapter. Every registered contract supplies explicit targets, context slots, authority requirements, effects, execution semantics, and lifecycle references. The bridge copies those declarations rather than inferring them from a capability name, a Boolean approval flag, or an opaque resource resolver. Totally Tubular's available resource, context, authority, effect, and lifecycle vocabularies still describe only this reference slice. They do not narrow what Perspective can describe.

Not yet implemented or standardized:

- A standalone normative JSON Schema for arbitrary serialized Perspective manifests.
- Safe parsing of an untrusted serialized definition into the TypeScript domain.
- A stable cross-language specification and test fixture suite.
- Automated semantic compatibility comparison.
- A formal extension registry or vocabulary negotiation mechanism.
- Normative, cross-language schemas for invocation and outcome envelopes.
- A Looking Glass projection interface with fidelity diagnostics.
- Perspective-native MCP, WebMCP, HTTP, CLI, Discord, or UI binding documents.
- Cryptographic authorship, signatures, trust roots, or authenticated distribution.
- Discovery, transport, deployment, persistence, telemetry, or secret management.
- A concrete AAPI package publishing a Perspective manifest across multiple adapters.

The current status is therefore an executable protocol nucleus and reference-manifest bridge, not a finished interoperability standard.

## Immediate next proof

The next meaningful proof is not an approval interface. It is to describe at least two materially different capabilities using one canonical Perspective, then project them through more than one adapter without changing their identities or semantic contracts.

A strong demonstration would include:

1. A model-backed, non-mutating capability such as `content.explain` that performs external compute and declares its disclosures.
2. An effectful capability such as `task.create` or the existing workspace note operation with explicit resource, authority, lifecycle, and evidence semantics.
3. MCP and one non-MCP projection generated by Looking Glass.
4. A conformance report showing which target format preserved or lost each Perspective concern.
5. A Totally Tubular runtime execution proving that projection metadata cannot bypass canonical authority or effects.

That demonstration would establish the intended abstraction: one semantic contract, multiple runtimes and adapters, no transport-specific domain model, and no confusion between the protocol and an operator interface.
