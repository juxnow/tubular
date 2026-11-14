import { describe, expect, it } from "vitest";
import {
  type AapiV0ContextItem,
  type AapiV0Invocation,
  type AapiV0Principal,
  type AapiV0Result,
  type AapiV0Scope,
  type AapiV0SourceReference,
  aapiV0ContextItemToPortAuthority,
  aapiV0InvocationToPortAuthority,
  aapiV0PrincipalToPortAuthority,
  aapiV0ResultToPortAuthority,
  aapiV0ScopeToPortAuthority,
  aapiV0SourceToPortAuthority,
  portAuthorityContextItemToAapiV0,
  portAuthorityInvocationToAapiV0,
  portAuthorityOutcomeToAapiV0,
  portAuthorityPrincipalToAapiV0,
  portAuthorityScopeToAapiV0,
  portAuthoritySourceToAapiV0,
} from "../src/port-authority/aapi-v0.js";
import {
  PORT_AUTHORITY_PROTOCOL,
  type PortAuthorityReference,
} from "../src/port-authority/definition.js";

const portAuthority: PortAuthorityReference = {
  id: `port_authority_${"a".repeat(24)}`,
  digest: "a".repeat(64),
  version: "0.1.0",
  specification: PORT_AUTHORITY_PROTOCOL,
};

const principal: AapiV0Principal = {
  id: "principal:mj",
  externalIdentity: {
    provider: "discord",
    subject: "123",
  },
};

const scope: AapiV0Scope = {
  id: "project:test",
  kind: "project",
};

const source: AapiV0SourceReference = {
  provider: "discord",
  resourceType: "channel",
  resourceId: "channel-1",
  parentResourceId: "guild-1",
};

describe("AAPI v0 clean-room compatibility", () => {
  it("rejects a Port Authority reference whose id does not bind its digest", () => {
    expect(() =>
      aapiV0InvocationToPortAuthority(
        {
          correlationId: "correlation-invalid-port-authority",
          principal,
          scope,
          capability: "activity.summarize",
          input: {},
          source,
        },
        { ...portAuthority, id: "port_authority_0123456789abcdef01234567" },
        "1.0.0",
      ),
    ).toThrow("must match its digest");
  });

  it("round-trips every implemented supporting shape", () => {
    const contextItem: AapiV0ContextItem = {
      id: "message-1",
      authorLabel: "Alex",
      occurredAt: "2026-08-27T12:00:00.000Z",
      content: "hello from discord",
      source: {
        provider: "discord",
        resourceType: "message",
        resourceId: "message-1",
        parentResourceId: "channel-1",
      },
    };

    expect(portAuthorityPrincipalToAapiV0(aapiV0PrincipalToPortAuthority(principal))).toEqual(
      principal,
    );
    expect(portAuthorityScopeToAapiV0(aapiV0ScopeToPortAuthority(scope))).toEqual(scope);
    expect(portAuthoritySourceToAapiV0(aapiV0SourceToPortAuthority(source))).toEqual(source);
    expect(portAuthorityContextItemToAapiV0(aapiV0ContextItemToPortAuthority(contextItem))).toEqual(
      contextItem,
    );
  });

  it("preserves omission of an optional parent resource id", () => {
    const parentless: AapiV0SourceReference = {
      provider: "discord",
      resourceType: "channel",
      resourceId: "direct-message-channel",
    };

    const roundTrip = portAuthoritySourceToAapiV0(aapiV0SourceToPortAuthority(parentless));
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
        items: [
          {
            id: "message-1",
            authorLabel: "Alex",
            occurredAt: "2026-08-27T12:00:00.000Z",
            content: "hello from discord",
            source: {
              provider: "discord",
              resourceType: "message",
              resourceId: "message-1",
            },
          },
        ],
      },
      source,
    };

    const encoded = aapiV0InvocationToPortAuthority(invocation, portAuthority, "1.0.0");
    expect(encoded.protocol).toBe("port-authority.invocation/v0");
    expect(encoded.portAuthority).toEqual(portAuthority);
    expect(encoded.capability).toEqual({
      id: "activity.summarize",
      version: "1.0.0",
    });
    expect(portAuthorityInvocationToAapiV0(encoded)).toEqual(invocation);
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

    const encoded = aapiV0ResultToPortAuthority(result, portAuthority, "1.0.0");
    expect(encoded.protocol).toBe("port-authority.outcome/v0");
    expect(encoded.portAuthority).toEqual(portAuthority);
    expect("providerRequestId" in encoded).toBe(false);
    expect(encoded.traces).toEqual([
      {
        namespace: "aapi-v0",
        kind: "provider-request",
        id: "req_test",
      },
    ]);
    expect(portAuthorityOutcomeToAapiV0(encoded)).toEqual(result);
  });

  it("round-trips a result that has no provider request trace", () => {
    const result: AapiV0Result<readonly string[]> = {
      correlationId: "correlation-2",
      capability: "system.status",
      output: ["awake"],
    };

    const roundTrip = portAuthorityOutcomeToAapiV0(
      aapiV0ResultToPortAuthority(result, portAuthority, "1.0.0"),
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

    expect(() => aapiV0InvocationToPortAuthority(invocation, portAuthority, "1.0.0")).toThrow(
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

    expect(() => aapiV0ResultToPortAuthority(invalidResult, portAuthority, "1.0.0")).toThrow(
      /finite numbers/u,
    );
    expect(() => aapiV0ResultToPortAuthority(circularResult, portAuthority, "1.0.0")).toThrow(
      /circular reference/u,
    );
  });
});
