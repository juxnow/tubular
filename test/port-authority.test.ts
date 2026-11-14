import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../src/catalog.js";
import { sha256, stableStringify } from "../src/core/json.js";
import {
  type AuthorityRequirement,
  type CapabilityDefinition,
  definePortAuthority,
  PORT_AUTHORITY_PROTOCOL,
  type PortAuthorityDefinition,
  type PortAuthoritySource,
  portAuthorityBody,
  verifyPortAuthorityIntegrity,
} from "../src/port-authority/definition.js";
import { portAuthorityFromRegistry } from "../src/profiles/totally-tubular.js";

/** Recover authoring fields from a sealed fixture for targeted conformance mutations. */
function sourceFromDefinition(definition: PortAuthorityDefinition): PortAuthoritySource {
  return {
    name: definition.name,
    version: definition.version,
    title: definition.title,
    description: definition.description,
    scopeKinds: definition.scopeKinds,
    resourceKinds: definition.resourceKinds,
    contextKinds: definition.contextKinds,
    authoritySchemes: definition.authoritySchemes,
    effectKinds: definition.effectKinds,
    lifecycles: definition.lifecycles,
    capabilities: definition.capabilities,
    requiredExtensions: definition.requiredExtensions,
    extensions: definition.extensions,
  };
}

/** Replace one fixture capability while preserving the surrounding portable definition. */
function updateCapability(
  source: PortAuthoritySource,
  update: (capability: CapabilityDefinition) => CapabilityDefinition,
): PortAuthoritySource {
  return {
    ...source,
    capabilities: source.capabilities.map((capability) =>
      capability.id === "workspace.note.append" ? update(capability) : capability,
    ),
  };
}

/** Reverse requirement order to verify canonical normalization preserves the digest. */
function reverseAuthority(authority: AuthorityRequirement): AuthorityRequirement {
  if (authority.kind === "none") {
    return { kind: "none" };
  }
  if (authority.kind === "scheme") {
    return {
      kind: "scheme",
      schemeRef: authority.schemeRef,
      claims: authority.claims,
    };
  }
  return {
    kind: authority.kind,
    requirements: [...authority.requirements]
      .reverse()
      .map((requirement) => reverseAuthority(requirement)),
  };
}

/** Reverse fixture collections to test stable portable projection ordering. */
function reverseCapability(capability: CapabilityDefinition): CapabilityDefinition {
  return {
    ...capability,
    errors: [...capability.errors].reverse(),
    targets: [...capability.targets].reverse(),
    contexts: [...capability.contexts].reverse().map((context) => ({
      ...context,
      acceptsKindRefs: [...context.acceptsKindRefs].reverse(),
    })),
    authority: reverseAuthority(capability.authority),
    effects: [...capability.effects].reverse().map((effect) => ({
      ...effect,
      disclosures: [...effect.disclosures].reverse().map((disclosure) => ({
        ...disclosure,
        fields: [...disclosure.fields].reverse(),
      })),
    })),
  };
}

/** Verify a sealed definition and return its compact identifier, version, and digest reference. */
function referencePortAuthority(): PortAuthorityDefinition {
  return portAuthorityFromRegistry(createDefaultRegistry());
}

describe("Port Authority Protocol v0 conformance", () => {
  it("describes the current AAPI capability without transport concerns", () => {
    const portAuthority = referencePortAuthority();
    expect(portAuthority.specification).toBe(PORT_AUTHORITY_PROTOCOL);
    expect(portAuthority.specification).toBe("port-authority/v0");

    const capability = portAuthority.capabilities.find(
      (candidate) => candidate.id === "workspace.note.append",
    );
    if (capability === undefined) {
      throw new Error("Expected the reference capability");
    }
    expect(capability.version).toBe("1.0.0");
    expect(
      capability.errors.find((error) => error.code === "APPROVAL_REQUIRED")?.retryability,
    ).toBe("conditional");
    expect(capability.inputSchema["additionalProperties"]).toBe(false);
    expect(capability.outputSchema["additionalProperties"]).toBe(false);
    expect(capability.targets).toEqual([
      {
        name: "resource",
        resourceKindRef: "workspace-resource",
        fromInput: "/resource",
        required: true,
      },
    ]);
    expect(capability.contexts).toEqual([
      {
        name: "working-context",
        acceptsKindRefs: ["exact-manifest"],
        required: true,
        minItems: 1,
        maxItems: 64,
        maxBytes: 1_048_576,
      },
    ]);
    expect(capability.effects).toEqual([
      {
        kindRef: "workspace-write",
        occurrence: "guaranteed",
        targetRef: "resource",
        disclosures: [],
      },
    ]);
    expect(capability.execution).toEqual({
      completion: "synchronous",
      idempotency: "invocation-id",
      outcomeEvidence: "receipt-required",
      unknownOutcome: "terminal-reconciliation-required",
    });
    expect(capability.lifecycleRef).toBe("proposal-execution");

    const authority = capability.authority;
    expect(authority.kind).toBe("all-of");
    if (authority.kind !== "all-of") {
      throw new Error("Expected composite authority");
    }
    expect(authority.requirements).toEqual([
      {
        kind: "scheme",
        schemeRef: "exact-human-approval",
        claims: { binds: "proposal-digest" },
      },
      {
        kind: "scheme",
        schemeRef: "capability-lease",
        claims: { exactContextBinding: true },
      },
    ]);
    expect(
      portAuthority.contextKinds.find((context) => context.id === "exact-manifest"),
    ).toMatchObject({
      selection: "explicit",
      provenance: "required",
      integrity: "sha-256",
      binding: "exact-digest",
      recordsOmissions: true,
    });
    expect(
      portAuthority.authoritySchemes.every((scheme) => scheme.promptGrantsAuthority === false),
    ).toBe(true);
    expect(
      portAuthority.lifecycles
        .find((lifecycle) => lifecycle.id === "proposal-execution")
        ?.states.find((state) => state.id === "outcome-unknown"),
    ).toEqual({ id: "outcome-unknown", terminal: true });

    const serialized = stableStringify(portAuthority);
    for (const projectionKey of [
      "documentationOnly",
      "httpMethod",
      "mcpName",
      "operationId",
      "proposalOnly",
      "servers",
      "transport",
      "wrapperName",
      "x-network-endpoint",
      "tt.propose",
      "/tools/",
    ]) {
      expect(serialized).not.toContain(projectionKey);
    }
  });

  it("normalizes unordered declarations before calculating identity", () => {
    const canonical = referencePortAuthority();
    const source = sourceFromDefinition(canonical);
    const reordered = definePortAuthority({
      ...source,
      scopeKinds: [...(source.scopeKinds ?? [])].reverse(),
      resourceKinds: [...(source.resourceKinds ?? [])].reverse(),
      contextKinds: [...(source.contextKinds ?? [])].reverse().map((context) => ({
        ...context,
        classifications: [...context.classifications].reverse(),
        disclosurePolicies: [...context.disclosurePolicies].reverse(),
      })),
      authoritySchemes: [...(source.authoritySchemes ?? [])].reverse(),
      effectKinds: [...(source.effectKinds ?? [])].reverse(),
      lifecycles: [...(source.lifecycles ?? [])].reverse().map((lifecycle) => ({
        ...lifecycle,
        states: [...lifecycle.states].reverse(),
        transitions: [...lifecycle.transitions].reverse(),
      })),
      capabilities: [...source.capabilities]
        .reverse()
        .map((capability) => reverseCapability(capability)),
      requiredExtensions: [...(source.requiredExtensions ?? [])].reverse(),
    });

    expect(stableStringify(reordered)).toBe(stableStringify(canonical));
    expect(reordered.id).toBe(canonical.id);
    expect(reordered.digest).toBe(canonical.digest);
    expect(canonical.digest).toBe(sha256(stableStringify(portAuthorityBody(canonical))));
    expect(canonical.id).toBe(`port_authority_${canonical.digest.slice(0, 24)}`);
  });

  it("changes identity when any core semantic declaration changes", () => {
    const canonical = referencePortAuthority();
    const source = sourceFromDefinition(canonical);
    const mutations: readonly {
      /** Human-readable regression case label, independent of contract identifiers. */
      readonly name: string;
      /** Fixture transformation introducing exactly the inconsistency checked by the case. */
      readonly mutate: (input: PortAuthoritySource) => PortAuthoritySource;
    }[] = [
      {
        name: "Port Authority version",
        mutate: (input) => ({ ...input, version: "0.2.0" }),
      },
      {
        name: "capability version",
        mutate: (input) =>
          updateCapability(input, (capability) => ({
            ...capability,
            version: "1.1.0",
          })),
      },
      {
        name: "input constraint",
        mutate: (input) =>
          updateCapability(input, (capability) => ({
            ...capability,
            inputSchema: { ...capability.inputSchema, minProperties: 2 },
          })),
      },
      {
        name: "effect kind",
        mutate: (input) =>
          updateCapability(input, (capability) => ({
            ...capability,
            effects: capability.effects.map((effect, index) =>
              index === 0 ? { ...effect, kindRef: "destructive" } : effect,
            ),
          })),
      },
      {
        name: "authority requirement",
        mutate: (input) =>
          updateCapability(input, (capability) => ({
            ...capability,
            authority: {
              kind: "scheme",
              schemeRef: "capability-lease",
              claims: { exactContextBinding: false },
            },
          })),
      },
      {
        name: "context bound",
        mutate: (input) =>
          updateCapability(input, (capability) => ({
            ...capability,
            contexts: capability.contexts.map((context) => ({
              ...context,
              maxBytes: context.maxBytes - 1,
            })),
          })),
      },
    ];

    for (const mutation of mutations) {
      const changed = definePortAuthority(mutation.mutate(source));
      expect(changed.digest, mutation.name).not.toBe(canonical.digest);
      expect(changed.id, mutation.name).not.toBe(canonical.id);
    }
  });

  it("detects post-definition tampering", () => {
    const portAuthority = referencePortAuthority();
    expect(verifyPortAuthorityIntegrity(portAuthority)).toBe(true);
    expect(verifyPortAuthorityIntegrity({ ...portAuthority, title: "Tampered title" })).toBe(false);
    expect(
      verifyPortAuthorityIntegrity({
        ...portAuthority,
        digest: "0".repeat(64),
      }),
    ).toBe(false);
    expect(
      verifyPortAuthorityIntegrity({
        ...portAuthority,
        capabilities: portAuthority.capabilities.map((capability) => ({
          ...capability,
          execution: {
            ...capability.execution,
            idempotency: "none",
          },
        })),
      }),
    ).toBe(false);
  });

  it("rejects open object schemas at canonical boundaries and when nested", () => {
    const portAuthority = referencePortAuthority();
    const source = sourceFromDefinition(portAuthority);
    const openSchemas: readonly PortAuthoritySource[] = [
      updateCapability(source, (capability) => ({
        ...capability,
        inputSchema: { type: "object" },
      })),
      updateCapability(source, (capability) => ({
        ...capability,
        outputSchema: {
          ...capability.outputSchema,
          properties: {
            nested: { type: "object", properties: {} },
          },
        },
      })),
      {
        ...source,
        authoritySchemes: (source.authoritySchemes ?? []).map((scheme) =>
          scheme.id === "capability-lease"
            ? { ...scheme, evidenceSchema: { type: "object" } }
            : scheme,
        ),
      },
    ];

    for (const open of openSchemas) {
      expect(() => definePortAuthority(open)).toThrow("open_object_schema");
    }
  });

  it("rejects non-finite JSON data before hashing", () => {
    const source = sourceFromDefinition(referencePortAuthority());
    expect(() =>
      definePortAuthority(
        updateCapability(source, (capability) => ({
          ...capability,
          inputSchema: {
            ...capability.inputSchema,
            maximum: Number.NaN,
          },
        })),
      ),
    ).toThrow("finite, acyclic JSON data");
  });

  it("allows domain fields that merely share names with projection concepts", () => {
    const source = sourceFromDefinition(referencePortAuthority());
    expect(() =>
      definePortAuthority(
        updateCapability(source, (capability) => ({
          ...capability,
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["path", "transport"],
            properties: {
              path: { type: "string" },
              transport: { type: "string" },
            },
          },
        })),
      ),
    ).not.toThrow();
  });

  it("rejects unknown semantic references", () => {
    const source = sourceFromDefinition(referencePortAuthority());
    const unknownReferences: readonly {
      /** Human-readable regression case label, independent of contract identifiers. */
      readonly name: string;
      /** Portable authoring fixture supplied to the conformance assertion. */
      readonly source: PortAuthoritySource;
      /** Expected diagnostic text for the deliberately malformed fixture. */
      readonly message: string;
    }[] = [
      {
        name: "lifecycle",
        source: updateCapability(source, (capability) => ({
          ...capability,
          lifecycleRef: "missing-lifecycle",
        })),
        message: "Unknown lifecycle",
      },
      {
        name: "resource kind",
        source: updateCapability(source, (capability) => ({
          ...capability,
          targets: capability.targets.map((target) => ({
            ...target,
            resourceKindRef: "missing-resource",
          })),
        })),
        message: "Unknown resource kind",
      },
      {
        name: "context kind",
        source: updateCapability(source, (capability) => ({
          ...capability,
          contexts: capability.contexts.map((context) => ({
            ...context,
            acceptsKindRefs: ["missing-context"],
          })),
        })),
        message: "Unknown context kind",
      },
      {
        name: "authority scheme",
        source: updateCapability(source, (capability) => ({
          ...capability,
          authority: {
            kind: "scheme",
            schemeRef: "missing-authority",
            claims: {},
          },
        })),
        message: "Unknown authority scheme",
      },
      {
        name: "effect kind",
        source: updateCapability(source, (capability) => ({
          ...capability,
          effects: capability.effects.map((effect) => ({
            ...effect,
            kindRef: "missing-effect",
          })),
        })),
        message: "Unknown effect kind",
      },
      {
        name: "effect target",
        source: updateCapability(source, (capability) => ({
          ...capability,
          effects: capability.effects.map((effect) => ({
            ...effect,
            targetRef: "missing-target",
          })),
        })),
        message: "Unknown effect target",
      },
      {
        name: "parent resource kind",
        source: {
          ...source,
          resourceKinds: (source.resourceKinds ?? []).map((resource) => ({
            ...resource,
            parentKindRefs: ["missing-parent"],
          })),
        },
        message: "Unknown parent resource kind",
      },
    ];

    for (const unknown of unknownReferences) {
      expect(() => definePortAuthority(unknown.source), unknown.name).toThrow(unknown.message);
    }
  });

  it("rejects duplicate identities and declarations", () => {
    const source = sourceFromDefinition(referencePortAuthority());
    const capability = source.capabilities[0];
    const lifecycle = (source.lifecycles ?? [])[0];
    if (capability === undefined || lifecycle === undefined) {
      throw new Error("Expected the reference definitions");
    }
    const firstError = capability.errors[0];
    const firstState = lifecycle.states[0];
    if (firstError === undefined || firstState === undefined) {
      throw new Error("Expected reference errors and lifecycle states");
    }

    expect(() =>
      definePortAuthority({
        ...source,
        capabilities: [capability, capability],
      }),
    ).toThrow("Duplicate capability");
    expect(() =>
      definePortAuthority({
        ...source,
        capabilities: [
          {
            ...capability,
            errors: [firstError, firstError],
          },
        ],
      }),
    ).toThrow("Duplicate error code");
    expect(() =>
      definePortAuthority({
        ...source,
        lifecycles: [
          {
            ...lifecycle,
            states: [...lifecycle.states, firstState],
          },
        ],
      }),
    ).toThrow("Duplicate lifecycle state");
  });
});
