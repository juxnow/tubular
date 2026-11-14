# Trust model

The governed typed runtime uses these kernel rules through generated bindings and opaque host-created sessions. The lightweight read-only runtime has only host callback authorization and schema validation; it does not inherit kernel audit or approval behavior. The complete integration boundary and recovery limits are in [GOVERNED_RUNTIME.md](GOVERNED_RUNTIME.md).

## Trusted

- Contract definitions reviewed into the repository
- Runtime validators attached to those contracts
- The policy engine and effect ordering
- Exact-digest approval handling
- Registered effect adapters
- The in-memory audit chain and standalone receipt integrity verifier

## Untrusted

- Model output
- Tool-call arguments
- Provider responses
- Context source contents
- Adapter results before output validation
- Serialized handoffs received from another process

## Non-negotiable rules

1. A model may propose an action but may not approve its own proposal.
2. Presence in a prompt does not grant authority.
3. Presence in a registry does not grant authority.
4. A lease names the subject, capability, resource scope, effect ceiling, context scope, expiry, and use budget.
5. Approval applies to one proposal digest and expires.
6. Mutating a proposal invalidates its approval.
7. Policy is re-evaluated at execution time.
8. Every completed effect returns a receipt linked to the proposal, approval when applicable, lease, context manifest, and audit event.
9. Context classification and permission to transmit are different fields.
10. Audit metadata is retained by default. Context content retention is a separate opt-in policy.

## What integrity does and does not mean

Manifest, handoff, lease, proposal, approval, receipt, and audit digests provide deterministic self-consistency. They are not digital signatures, external identity proof, or proof that a source's classification or provenance claim is truthful.

`intendedPrincipalIds` inside a handoff is routing metadata. It does not authenticate a recipient or enforce transport access. A transport or storage layer must add that control.

The current audit chain lives in memory. It detects modification or reordering of the events it is given, but it does not survive restart and cannot independently detect truncation without a durable store and an externally anchored head hash.

## Authority boundary

Human approval, lease issuance, and context registration are represented by registered in-process object capabilities. Object identity prevents a caller from gaining authority merely by copying an ID, but it is not user authentication.

Safety depends on keeping the raw kernel and every authority object outside untrusted model code. In particular, a model must never receive direct access to `approve`, `execute`, `registerManifest`, `registerLease`, revocation methods, or `exportState`. The MCP gateway is the intended model-facing boundary.

In the typed bridge, a registered session is also an object capability. Arguments cannot create or select it. Only selected manifest content reaches handlers, and that content grants no authority. The TypeScript handler, resource resolver, and effect declarations remain trusted host code. Generated fingerprints and contract digests are build provenance and consistency checks, not signatures, authentication, or evidence of code purity.

## Context caveats

Context manifests and handoff envelopes embed the raw content selected for them. Totally Tubular enforces size, classification-ceiling, and disclosure-policy rules, but it does not currently detect secrets, encrypt content, authenticate provenance, or prevent a trusted caller from misclassifying a source. Source selection and classification must happen on the trusted side of the boundary.
