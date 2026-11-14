import { describe, expect, it } from "vitest";
import { appendNoteContract } from "../src/builtin/append-note.js";
import { ContractRegistry } from "../src/contracts/registry.js";
import { defineToolContract } from "../src/contracts/tool-contract.js";
import type { RuntimeSchema } from "../src/contracts/schema.js";
import type { JsonObject } from "../src/core/json.js";

describe("canonical contract registry", () => {
  it("rejects hand-built and shallow-cloned contracts", () => {
    const registry = new ContractRegistry();
    expect(() => registry.register({ ...appendNoteContract })).toThrow(
      "defineToolContract",
    );
    expect(() =>
      registry.register({
        ...appendNoteContract,
        name: "fabricated.contract",
      }),
    ).toThrow("defineToolContract");
    expect(() => registry.register(appendNoteContract)).not.toThrow();
  });

  it("accepts a contract produced by the only factory", () => {
    const passthrough: RuntimeSchema<JsonObject> = {
      jsonSchema: { type: "object" },
      parse(input: unknown) {
        return typeof input === "object" && input !== null && !Array.isArray(input)
          ? { ok: true as const, value: input as JsonObject }
          : {
              ok: false as const,
              issues: [
                { path: "/", code: "type", message: "Expected an object" },
              ],
            };
      },
    };
    const contract = defineToolContract({
      name: "test.factory-contract",
      version: "1.0.0",
      title: "Factory contract",
      description: "A branded test contract.",
      effect: "read",
      approval: "none",
      input: passthrough,
      output: passthrough,
      errors: [],
      semantics: {
        targets: [],
        contexts: [],
        authority: { kind: "none" },
        effects: [
          {
            kindRef: "read",
            occurrence: "guaranteed",
            targetRef: null,
            disclosures: [],
          },
        ],
        execution: {
          completion: "synchronous",
          idempotency: "inherent",
          outcomeEvidence: "optional",
          unknownOutcome: "retry-safe",
        },
        lifecycleRef: "proposal-execution",
      },
      resolveResource: () => "workspace://test/resource",
    });
    expect(new ContractRegistry([contract]).get(contract.name)).toBe(contract);

    expect(() =>
      defineToolContract({
        name: "test.approval-drift",
        version: "1.0.0",
        title: "Approval drift",
        description: "Must not weaken semantic approval at runtime.",
        effect: "read",
        approval: "none",
        input: passthrough,
        output: passthrough,
        errors: [],
        semantics: {
          ...contract.semantics,
          authority: {
            kind: "scheme",
            schemeRef: "exact-human-approval",
            claims: { binds: "proposal-digest" },
          },
        },
        resolveResource: () => "workspace://test/resource",
      }),
    ).toThrow("Runtime approval must exactly match");

    expect(() =>
      defineToolContract({
        name: "test.effect-drift",
        version: "1.0.0",
        title: "Effect drift",
        description: "Must not weaken semantic effects at runtime.",
        effect: "read",
        approval: "none",
        input: passthrough,
        output: passthrough,
        errors: [],
        semantics: {
          ...contract.semantics,
          effects: [
            ...contract.semantics.effects,
            {
              kindRef: "destructive",
              occurrence: "possible",
              targetRef: null,
              disclosures: [],
            },
          ],
        },
        resolveResource: () => "workspace://test/resource",
      }),
    ).toThrow("strongest portable semantic effect");
  });
});
