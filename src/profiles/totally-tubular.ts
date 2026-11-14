import type { ContractRegistry } from "../contracts/registry.js";
import {
  definePortAuthority,
  type PortAuthorityDefinition,
} from "../port-authority/definition.js";

export function portAuthorityFromRegistry(
  registry: ContractRegistry,
): PortAuthorityDefinition {
  return definePortAuthority({
    name: "totally-tubular.reference-runtime",
    version: "0.1.0",
    title: "Totally Tubular reference runtime",
    description:
      "A provider-neutral, bounded-agency runtime described by a Port Authority manifest.",
    scopeKinds: ["private", "project", "external-resource"],
    resourceKinds: [
      {
        id: "workspace-resource",
        description: "A logical workspace resource resolved by the trusted runtime.",
        identitySchema: {
          type: "string",
          pattern: "^workspace://[a-z0-9][a-z0-9._/-]{0,500}$",
        },
        parentKindRefs: [],
      },
    ],
    contextKinds: [
      {
        id: "exact-manifest",
        description:
          "An explicitly selected, bounded context manifest with recorded provenance and omissions.",
        selection: "explicit",
        provenance: "required",
        integrity: "sha-256",
        binding: "exact-digest",
        classifications: ["public", "internal", "private", "secret"],
        disclosurePolicies: ["shareable", "explicit-grant", "local-only"],
        recordsOmissions: true,
      },
    ],
    authoritySchemes: [
      {
        id: "capability-lease",
        description:
          "Time-bounded authority for named capabilities, resources, contexts, effects, and uses.",
        evidenceSchema: {
          type: "object",
          additionalProperties: false,
          required: ["leaseId", "leaseDigest"],
          properties: {
            leaseId: { type: "string" },
            leaseDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
          },
        },
        promptGrantsAuthority: false,
      },
      {
        id: "exact-human-approval",
        description:
          "Approval issued by separately held human authority for one exact proposal digest.",
        evidenceSchema: {
          type: "object",
          additionalProperties: false,
          required: ["approvalId", "proposalDigest", "expiresAt"],
          properties: {
            approvalId: { type: "string" },
            proposalDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        promptGrantsAuthority: false,
      },
    ],
    effectKinds: [
      {
        id: "read",
        description: "Read local state without changing it or disclosing it externally.",
        state: "read",
        externalInteraction: "none",
        reversibility: "not-applicable",
      },
      {
        id: "draft",
        description: "Create local draft state without an external write.",
        state: "create",
        externalInteraction: "none",
        reversibility: "reversible",
      },
      {
        id: "workspace-write",
        description: "Change a resource inside the bounded workspace.",
        state: "update",
        externalInteraction: "none",
        reversibility: "compensatable",
      },
      {
        id: "external-write",
        description: "Write to a system outside the bounded runtime.",
        state: "update",
        externalInteraction: "write",
        reversibility: "unknown",
      },
      {
        id: "destructive",
        description: "Delete or irreversibly replace state.",
        state: "delete",
        externalInteraction: "write",
        reversibility: "irreversible",
      },
    ],
    lifecycles: [
      {
        id: "proposal-execution",
        description:
          "A proposal is evaluated, optionally approved, dispatched, and reconciled to evidence.",
        initialState: "proposed",
        states: [
          { id: "proposed", terminal: false },
          { id: "approval-required", terminal: false },
          { id: "ready", terminal: false },
          { id: "executing", terminal: false },
          { id: "succeeded", terminal: true },
          { id: "rejected", terminal: true },
          { id: "failed", terminal: true },
          { id: "outcome-unknown", terminal: true },
        ],
        transitions: [
          { from: "proposed", to: "approval-required", on: "policy-requires-approval" },
          { from: "proposed", to: "ready", on: "policy-allows" },
          { from: "proposed", to: "rejected", on: "policy-denies" },
          { from: "approval-required", to: "ready", on: "approval-accepted" },
          { from: "ready", to: "executing", on: "dispatch-started" },
          { from: "executing", to: "succeeded", on: "receipt-verified" },
          { from: "executing", to: "failed", on: "failure-proven" },
          { from: "executing", to: "outcome-unknown", on: "completion-unproven" },
        ],
      },
    ],
    capabilities: registry.list().map((contract) => ({
      id: contract.name,
      version: contract.version,
      title: contract.title,
      description: contract.description,
      inputSchema: contract.inputSchema,
      outputSchema: contract.outputSchema,
      errors: contract.errors.map((error) => ({
        code: error.code,
        description: error.description,
        retryability: error.retryable ? "conditional" : "never",
      })),
      targets: contract.semantics.targets,
      contexts: contract.semantics.contexts,
      authority: contract.semantics.authority,
      effects: contract.semantics.effects,
      execution: contract.semantics.execution,
      lifecycleRef: contract.semantics.lifecycleRef,
    })),
  });
}
