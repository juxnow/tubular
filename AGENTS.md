# Totally Tubular engineering contract

## Product invariants

- Models are untrusted planners. They never become the authority for an effect.
- Every effectful action passes through the trusted kernel.
- Context is explicit, selected, classified, provenance-bearing, and content-addressed.
- Authority is explicit, scoped, revocable, expiring, and bounded by an effect ceiling.
- Human approval binds one exact proposal digest. Editing creates a new proposal.
- Every policy decision and completed effect produces an append-only audit event.
- Adapters translate protocols. They may not bypass contracts, policy, approval, or audit.
- One canonical tool contract registry drives runtime validation and documentation projections.
- OpenAPI-shaped output is documentation only unless an actual network endpoint exists.

## Source rules

- Author executable source in strict TypeScript.
- Use interfaces for object-shaped models and type aliases for unions.
- Use `unknown` at untrusted boundaries and narrow it with explicit validation.
- Do not use `any`, double assertions, blanket assertions, or compiler suppressions.
- Keep domain models, runtime adapters, and documentation projections separate.
- Preserve deterministic behavior by injecting clocks and effect executors.
- Do not add network calls, provider credentials, persistence, deployment, or telemetry without explicit authorization.
- Do not copy employer-owned code or confidential material into this repository.

## Delivery checks

Run `npm run check` before presenting a change as complete. Generated documentation must be deterministic and checked for truthful `x-documentation-projection` and `x-network-endpoint` markers.
