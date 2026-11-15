import { describe, expect, it } from "vitest";
import {
  type AapiV0ContextItem,
  type AapiV0Invocation,
  type AapiV0Result,
  type AapiV0SourceReference,
  aapiV0ContextItemToPerspective,
  aapiV0InvocationToPerspective,
  aapiV0PrincipalToPerspective,
  aapiV0ResultToPerspective,
  aapiV0ScopeToPerspective,
  aapiV0SourceToPerspective,
  perspectiveContextItemToAapiV0,
  perspectiveInvocationToAapiV0,
  perspectiveOutcomeToAapiV0,
  perspectivePrincipalToAapiV0,
  perspectiveScopeToAapiV0,
  perspectiveSourceToAapiV0,
} from "../src/perspective/aapi-v0.js";
import { compatibilityScenario, scenarioSeeds } from "./fixtures/scenarios.js";

describe.each(scenarioSeeds)("AAPI v0 clean-room compatibility (seed %i)", (seed) => {
  const { perspective, principal, scope, source, contextItem } = compatibilityScenario(seed);
  it("rejects a Perspective reference whose id does not bind its digest", () => {
    expect(() =>
      aapiV0InvocationToPerspective(
        {
          correlationId: "correlation-invalid-perspective",
          principal,
          scope,
          capability: "activity.summarize",
          input: {},
          source,
        },
        { ...perspective, id: "perspective_0123456789abcdef01234567" },
        "1.0.0",
      ),
    ).toThrow("must match its digest");
  });

  it("round-trips every implemented supporting shape", () => {
    expect(perspectivePrincipalToAapiV0(aapiV0PrincipalToPerspective(principal))).toEqual(
      principal,
    );
    expect(perspectiveScopeToAapiV0(aapiV0ScopeToPerspective(scope))).toEqual(scope);
    expect(perspectiveSourceToAapiV0(aapiV0SourceToPerspective(source))).toEqual(source);
    expect(perspectiveContextItemToAapiV0(aapiV0ContextItemToPerspective(contextItem))).toEqual(
      contextItem,
    );
  });

  it("preserves omission of an optional parent resource id", () => {
    const parentless: AapiV0SourceReference = {
      provider: "discord",
      resourceType: "channel",
      resourceId: "direct-message-channel",
    };

    const roundTrip = perspectiveSourceToAapiV0(aapiV0SourceToPerspective(parentless));
    expect(roundTrip).toEqual(parentless);
    expect("parentResourceId" in roundTrip).toBe(false);
  });

  it("round-trips an invocation with nested JSON input", () => {
    const invocation: AapiV0Invocation<{
      /** Fixture audience retained as capability input during legacy-to-portable translation. */
      readonly audience: string;
      /** Nonempty task objective retained verbatim as context, never interpreted as an authority grant. */
      readonly objective: string;
      /** Fixture context records whose attribution and provenance must survive translation. */
      readonly items: readonly AapiV0ContextItem[];
    }> = {
      correlationId: "correlation-1",
      principal,
      scope,
      capability: "activity.summarize",
      input: {
        audience: "MJ",
        objective: "Catch up.",
        items: [contextItem],
      },
      source,
    };

    const encoded = aapiV0InvocationToPerspective(invocation, perspective, "1.0.0");
    expect(encoded.protocol).toBe("perspective.invocation/v0");
    expect(encoded.perspective).toEqual(perspective);
    expect(encoded.capability).toEqual({
      id: "activity.summarize",
      version: "1.0.0",
    });
    expect(perspectiveInvocationToAapiV0(encoded)).toEqual(invocation);
  });

  it("represents providerRequestId only as an opaque trace", () => {
    const result: AapiV0Result<{
      /** Fixture success summary expected to survive round-trip translation. */
      readonly headline: string;
      /** Fixture decision strings retained in successful portable output. */
      readonly decisions: readonly string[];
    }> = {
      correlationId: "correlation-1",
      capability: "activity.summarize",
      output: { headline: "Caught up", decisions: [] },
      providerRequestId: "req_test",
    };

    const encoded = aapiV0ResultToPerspective(result, perspective, "1.0.0");
    expect(encoded.protocol).toBe("perspective.outcome/v0");
    expect(encoded.perspective).toEqual(perspective);
    expect("providerRequestId" in encoded).toBe(false);
    expect(encoded.traces).toEqual([
      {
        namespace: "aapi-v0",
        kind: "provider-request",
        id: "req_test",
      },
    ]);
    expect(perspectiveOutcomeToAapiV0(encoded)).toEqual(result);
  });

  it("round-trips a result that has no provider request trace", () => {
    const result: AapiV0Result<readonly string[]> = {
      correlationId: "correlation-2",
      capability: "system.status",
      output: ["awake"],
    };

    const roundTrip = perspectiveOutcomeToAapiV0(
      aapiV0ResultToPerspective(result, perspective, "1.0.0"),
    );
    expect(roundTrip).toEqual(result);
    expect("providerRequestId" in roundTrip).toBe(false);
  });

  it("rejects non-JSON invocation input", () => {
    const invocation: AapiV0Invocation<unknown> = {
      correlationId: "correlation-3",
      principal,
      scope,
      capability: "activity.summarize",
      input: { callback: (): void => undefined },
      source,
    };

    expect(() => aapiV0InvocationToPerspective(invocation, perspective, "1.0.0")).toThrow(
      /Invocation input must be JSON-safe/u,
    );
  });

  it("rejects non-JSON and circular result output", () => {
    const invalidResult: AapiV0Result<unknown> = {
      correlationId: "correlation-4",
      capability: "activity.summarize",
      output: Number.POSITIVE_INFINITY,
    };
    const circular: {
      /** Deliberately cyclic fixture link used to prove JSON boundary rejection. */
      self?: unknown;
    } = {};
    circular.self = circular;
    const circularResult: AapiV0Result<unknown> = {
      correlationId: "correlation-5",
      capability: "activity.summarize",
      output: circular,
    };

    expect(() => aapiV0ResultToPerspective(invalidResult, perspective, "1.0.0")).toThrow(
      /finite numbers/u,
    );
    expect(() => aapiV0ResultToPerspective(circularResult, perspective, "1.0.0")).toThrow(
      /circular reference/u,
    );
  });
});
