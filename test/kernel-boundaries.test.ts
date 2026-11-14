import { describe, expect, it } from "vitest";
import { issueAuthorityLease } from "../src/authority/types.js";
import { ContractRegistry } from "../src/contracts/registry.js";
import { defineToolContract } from "../src/contracts/tool-contract.js";
import type { RuntimeSchema } from "../src/contracts/schema.js";
import { isJsonObject, type JsonObject } from "../src/core/json.js";
import { buildContextManifest } from "../src/context/manifest.js";
import {
  ContextRegistrationAuthority,
  LeaseIssuerAuthority,
  TotallyTubularKernel,
} from "../src/runtime/kernel.js";
import { TestClock } from "./support.js";

const outputSchema: RuntimeSchema<JsonObject> = {
  jsonSchema: { type: "object" },
  parse(input: unknown) {
    return isJsonObject(input)
      ? { ok: true, value: input }
      : {
          ok: false,
          issues: [{ path: "/", code: "type", message: "Expected object" }],
        };
  },
};

const readPortableSemantics = {
  targets: [],
  contexts: [
    {
      name: "working-context",
      acceptsKindRefs: ["exact-manifest"],
      required: true,
      minItems: 1,
      maxItems: 64,
      maxBytes: 1_048_576,
    },
  ],
  authority: {
    kind: "scheme" as const,
    schemeRef: "capability-lease",
    claims: { exactContextBinding: true },
  },
  effects: [
    {
      kindRef: "read",
      occurrence: "guaranteed" as const,
      targetRef: null,
      disclosures: [],
    },
  ],
  execution: {
    completion: "synchronous" as const,
    idempotency: "inherent" as const,
    outcomeEvidence: "optional" as const,
    unknownOutcome: "retry-safe" as const,
  },
  lifecycleRef: "proposal-execution",
};

function kernelForContract(
  contract: ReturnType<typeof defineToolContract<JsonObject, JsonObject>>,
): {
  readonly kernel: TotallyTubularKernel;
  readonly leaseId: string;
  readonly manifestId: string;
} {
  const clock = new TestClock("2026-09-13T16:00:00.000Z");
  const manifest = buildContextManifest(
    [
      {
        id: "boundary.context",
        label: "Boundary context",
        mediaType: "text/plain",
        content: "Untrusted parser boundary",
        classification: "public",
        disclosure: "shareable",
        provenance: {
          kind: "generated",
          locator: "test://boundary",
          observedAt: clock.now().toISOString(),
        },
      },
    ],
    {
      purpose: "exercise a failing contract boundary",
      principalId: "agent.boundary",
      selectedSourceIds: ["boundary.context"],
      classificationCeiling: "public",
    },
    clock,
  );
  const issuer = new LeaseIssuerAuthority("human.boundary");
  const registrar = new ContextRegistrationAuthority("context.boundary");
  const lease = issueAuthorityLease(
    {
      subjectId: "agent.boundary",
      issuedBy: issuer.issuerId,
      expiresAt: "2026-09-13T17:00:00.000Z",
      grants: [{ toolName: contract.name, resourcePatterns: ["*"] }],
      effectCeiling: "read",
      contextManifestDigests: [manifest.digest],
      maxUses: 1,
    },
    clock,
  );
  const kernel = new TotallyTubularKernel(new ContractRegistry([contract]), clock, {
    leaseIssuerAuthorities: [issuer],
    contextRegistrationAuthorities: [registrar],
  });
  kernel.registerManifest(manifest, registrar);
  kernel.registerLease(lease, issuer);
  return { kernel, leaseId: lease.id, manifestId: manifest.id };
}

function requestFor(
  fixture: ReturnType<typeof kernelForContract>,
  toolName: string,
) {
  return {
    principalId: "agent.boundary",
    leaseId: fixture.leaseId,
    contextManifestId: fixture.manifestId,
    toolName,
    input: { value: "secret-parser-sentinel" },
  };
}

describe("untrusted contract failure boundaries", () => {
  it("turns a throwing input parser into a sanitized structured failure", () => {
    const inputSchema: RuntimeSchema<JsonObject> = {
      jsonSchema: { type: "object" },
      parse() {
        throw new Error("secret-validator-detail");
      },
    };
    const contract = defineToolContract({
      name: "test.throwing-input",
      version: "1.0.0",
      title: "Throwing input",
      description: "Exercises parser containment.",
      effect: "read",
      approval: "none",
      input: inputSchema,
      output: outputSchema,
      errors: [],
      semantics: readPortableSemantics,
      resolveResource: () => "workspace://test/resource",
    });
    const fixture = kernelForContract(contract);
    const result = fixture.kernel.propose(requestFor(fixture, contract.name));
    expect(result).toMatchObject({
      ok: false,
      failure: { code: "INPUT_INVALID", retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain("secret-validator-detail");
    expect(JSON.stringify(fixture.kernel.audit.entries())).not.toContain(
      "secret-parser-sentinel",
    );
  });

  it("turns a throwing resource resolver into a sanitized structured failure", () => {
    const inputSchema: RuntimeSchema<JsonObject> = {
      jsonSchema: { type: "object" },
      parse(input: unknown) {
        return isJsonObject(input)
          ? { ok: true, value: input }
          : {
              ok: false,
              issues: [{ path: "/", code: "type", message: "Expected object" }],
            };
      },
    };
    const contract = defineToolContract({
      name: "test.throwing-resource",
      version: "1.0.0",
      title: "Throwing resource",
      description: "Exercises resolver containment.",
      effect: "read",
      approval: "none",
      input: inputSchema,
      output: outputSchema,
      errors: [],
      semantics: readPortableSemantics,
      resolveResource() {
        throw new Error("secret-resolver-detail");
      },
    });
    const fixture = kernelForContract(contract);
    const result = fixture.kernel.propose(requestFor(fixture, contract.name));
    expect(result).toMatchObject({
      ok: false,
      failure: { code: "INPUT_INVALID", retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain("secret-resolver-detail");
    expect(JSON.stringify(fixture.kernel.audit.entries())).not.toContain(
      "secret-parser-sentinel",
    );
  });
});
