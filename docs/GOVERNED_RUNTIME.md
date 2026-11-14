# Governed typed capabilities

Tubular's generated binding, schema validation, contract catalog, MCP adapter, and governed execution now form a tested in-process path. The bridge reuses `TotallyTubularKernel`; it does not implement a second policy or approval engine. The protocol strings inside kernel records remain experimental legacy identifiers. They do not identify a completed MCCP specification.

## Authoring and build contract

The TypeScript compiler derives input and awaited output schemas and discovery metadata from the same exported function that the generated binding imports. The host uses the generated factory to select effect classification, approval requirements, and a typed resource resolver. Function prose supplies the description unless the host deliberately overrides it. A public name can differ from the exported function name. The factory captures the handler and schemas before host configuration, and rejects a separate schema map in the read-only runtime. See [source contracts](SOURCE_CONTRACTS.md) for supported annotations and enforced constraints.

The source fingerprint covers local program sources except the generated binding destination, emitted schemas, and the TypeScript compiler version. It includes imported local models and implementation-only edits. It excludes external dependency source files and default libraries. Generated output has relative paths and no timestamps. Lock dependencies and run the compiler's drift check during every relevant build. Hashes provide self-consistency, not signatures or runtime code attestation. The lower-level binding helper is trusted infrastructure, not proof that arbitrary manually supplied schemas match a function.

Use a source generation project and an application build project when generated consumers would otherwise create a circular build dependency. The governed example demonstrates this split. Generate with the built CLI, then typecheck the generated module with the application. In CI, use the same arguments plus the check flag:

```sh
npm run build
npm run example:generate
npm run check
```

The compiler preserves JSON-representable shapes. Structural object intersections merge their properties, including stronger required properties. Impossible intersections and primitive brands fail. Readonly arrays have the same JSON representation as mutable arrays. Nested tagged unions retain all closed alternatives. Recursive types, tuples, open dictionaries, functions in models, generic handlers, overloaded handlers, explicit function `this`, and non-JSON values remain unsupported. Compiler errors include the affected type/property path or TypeScript source diagnostic. MCP can project object-only output unions by adding their implied object root without removing alternatives.

## Host and model boundaries

The trusted host owns the runtime control surface, authority objects, clock, capability definitions, and effect adapters. `openSession` requires registered issuer and registrar object identities. A copied object or matching textual ID does not acquire their authority. The session itself is frozen and registered by object identity; copied or fabricated session objects are rejected.

The host selects a manifest and issues a lease with the same principal and exact manifest digest. Registration seals both. Only the selected, sealed manifest reaches the handler through `GovernedToolContext`, together with the proposal, operation ID, and abort signal. The handler does not receive the broader source catalog. Neither context content nor provenance labels confer authority. Provenance is a host claim; it is not independently authenticated by Tubular.

Authentication remains the host's responsibility. An authority object is an in-process capability, not a login session or identity provider. Use one session per trusted principal/lease/context selection. Keep sessions and the raw kernel inaccessible to model-generated code. This is a library boundary, not an isolation mechanism for arbitrary untrusted JavaScript running in the same process.

## Proposal, approval, and execution

1. `propose` uses the session's identity, lease, and manifest. It validates a defensive input copy and resolves a canonical workspace resource through the trusted resolver.
2. The kernel evaluates resource grants, effect ceiling, lease expiry/revocation/use budget, context binding, and disclosure policy. It records the proposal and policy decision in the audit chain.
3. Non-read definitions default to exact human approval. The host receives the complete proposal for review and approves its ID, digest, revision, and challenge using a separately held human authority. Editing the input means proposing again and obtaining new approval.
4. `execute` checks session ownership, then the kernel rechecks policy and approval before dispatch. An input copy allows ordinary mutable TypeScript inputs without changing the approved proposal. The handler receives the exact selected context.
5. Valid output produces a receipt linked to the proposal, lease, approval, manifest, and completion audit event. Repeated or concurrent execution of that proposal returns the cached receipt without dispatching again.

The library does not decide that a human reviewed something merely because a model requested approval. The example's approval is a labeled simulation. An application must implement an authenticated review surface and bind the displayed content to the approved digest.

Each independent submission has a unique proposal ID formed from a per-kernel namespace and a synchronously incremented bigint counter. The namespace defaults to a fresh UUID. The proposal digest covers that ID along with the arguments, context, resource, revision, and timestamp, so identical same-tick submissions have different digests and approval challenges. Execution reserves its in-flight entry before calling an executor, including executors that synchronously re-enter the kernel. Separate proposals compete against the same live lease budget, while concurrent execution of one proposal shares its dispatch and receipt.

Trusted tests may set `KernelOptions.proposalNamespace` to 1 to 64 ASCII letters, digits, underscores, or hyphens. Reusing that namespace in independent kernels can repeat IDs. Neither the namespace nor the counter is persisted, and this design does not provide cross-process deduplication or restart recovery. Do not use a new proposal to retry an uncertain effect without reconciliation.

`propose` and `execute` return discriminated results with kernel failure codes. `invoke` returns `ask` with the proposal reference, `success` with output and receipt, `deny` for proposal rejection, or `execution_error` for execution rejection. MCP returns a sanitized failure status and, for `ask`, only the proposal ID/digest. Approval, resumption, and receipt retrieval remain host operations; the current MCP adapter has no approval UI or automatic resume protocol.

## Failure and durability limits

Handler exceptions after dispatch produce a terminal unknown-outcome failure for that proposal. Invalid output is also terminal. Neither case automatically dispatches again. Output validation cannot roll back an effect. A new proposal is a new operation and may repeat a prior effect, so the host must reconcile uncertain outcomes before reproposing. Cancellation signals are available to adapters and do not imply rollback.

All kernel state is process-local. Replay suppression and audit continuity do not survive restart. The audit chain detects tampering with supplied events but cannot independently detect truncation without an externally anchored head. Durable storage, operation-key retention, restart recovery, transaction boundaries, cross-process coordination, and effect reconciliation are required before consequential production use. External adapters must honor operation IDs and define their own recovery semantics.

Resource matching currently accepts canonical workspace URIs and bounded workspace patterns. Generalized resource kinds and policy plugins are open work. The host's resource resolver and effect/disclosure declarations must accurately describe what the handler does. Neither the type compiler nor the kernel proves that trusted handler code accesses only its declared resource. This bridge does not implement provider calls, network transports, secrets ingestion, or personal context-plane delivery.

## Machine-readable projections

The capability manifest carries documented schemas, source description/title, effect, source provenance, approval requirement, and the governed execution marker. OpenAPI carries the relevant metadata and marks both the document and synthetic operations as documentation projections with no network endpoint. Its hypothetical 422 schema is generated from the runtime's named input-validation failure type. Extensions do not enforce authorization or approval. These paths are not deployed routes and do not implement a complete HTTP approval/error protocol. Hosts implementing HTTP must define that protocol and enforce the same runtime boundary.

MCP invokes the same runtime with one host-bound session. The current adapter supports tools and object-shaped outputs, including object-only unions. Resources, prompts, provider-specific function adapters, HTTP endpoints, and transport authentication are not implemented by this integration. For HTTP hosts, configure input/request limits and bearer-token audience validation where applicable; SDK defaults must not be treated as a complete host security configuration.
