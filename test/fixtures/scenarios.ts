import { createDefaultPerspective } from "../../src/catalog.js";
import type {
  AapiV0ContextItem,
  AapiV0Principal,
  AapiV0Scope,
  AapiV0SourceReference,
} from "../../src/perspective/aapi-v0.js";
import { referencePerspective } from "../../src/perspective/definition.js";
import type { DocumentedHost, DocumentedQuery } from "./documented-tools.js";
import type { GreetingInput, HostContext } from "./greeting-tools.js";

/** Stable regression seeds, included in case names so any failure can be replayed exactly. */
export const scenarioSeeds = [7, 42, 20261115] as const;

/** Reproducible synthetic data sampler; this is not an identity or cryptographic generator. */
export function scenarioRandom(seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("Scenario seed must be a uint32");
  let state = seed;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  return {
    /** Choose only from declared domain values; an empty vocabulary is a fixture error. */
    pick<T>(values: readonly T[]): T {
      const value = values[next() % values.length];
      if (value === undefined) throw new Error("Cannot sample an empty fixture vocabulary");
      return value;
    },
    /** Produce a version-4-shaped correlation UUID, never an authentication credential. */
    uuid(): string {
      const hex = Array.from({ length: 4 }, () => next().toString(16).padStart(8, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
    },
    /** Produce a plausible positive decimal provider identifier without contacting that provider. */
    providerId(): string {
      return (1200000000000000000n + BigInt(next())).toString();
    },
  };
}

/** Greeting scenario keeps tenant selection in trusted context, separate from requested display text. */
export interface GreetingScenario {
  /** Valid model input sampled from synthetic display names and punctuation choices. */
  input: GreetingInput;
  /** Host-selected workspace, never merged into model input. */
  context: HostContext;
}

/** Create independent mutable inputs for runtime snapshot and authorization tests. */
export function greetingScenario(seed: number): GreetingScenario {
  const random = scenarioRandom(seed);
  return {
    input: {
      name: random.pick(["Alex", "Robin", "Samira", "Casey", "Morgan"]),
      excited: random.pick([true, false]),
    },
    context: { tenant: random.pick(["Design", "Research", "Operations"]) },
  };
}

/** Valid documented search arguments and the separately selected host workspace. */
export interface SearchScenario {
  /** Correlation UUID, bounded lowercase token, and allowed category filters. */
  input: DocumentedQuery;
  /** Host scope used to verify that model-supplied authority cannot replace it. */
  context: DocumentedHost;
}

/** Sample valid searches with omitted optional defaults; negative tests change one field explicitly. */
export function searchScenario(seed: number): SearchScenario {
  const random = scenarioRandom(seed);
  return {
    input: {
      id: random.uuid(),
      query: random.pick(["release", "design", "review", "notes"]),
      tags: random.pick([["a"], ["b"], ["a", "b"]] as const),
    },
    context: { prefix: `workspace:${random.pick(["design", "research", "operations"])}` },
  };
}

/** Build related legacy provider records and a reference sealed by the real contract implementation. */
export function compatibilityScenario(seed: number) {
  const random = scenarioRandom(seed);
  const userId = random.providerId();
  const guildId = random.providerId();
  const channelId = random.providerId();
  const messageId = random.providerId();
  const principal: AapiV0Principal = {
    id: `principal:discord:${userId}`,
    externalIdentity: { provider: "discord", subject: userId },
  };
  const scope: AapiV0Scope = { id: `project:${guildId}`, kind: "project" };
  const source: AapiV0SourceReference = {
    provider: "discord",
    resourceType: "channel",
    resourceId: channelId,
    parentResourceId: guildId,
  };
  const contextItem: AapiV0ContextItem = {
    id: messageId,
    authorLabel: random.pick(["Alex", "Robin", "Samira"]),
    occurredAt: "2026-11-15T12:00:00.000Z",
    content: random.pick([
      "The design review is ready for feedback.",
      "The release notes include the migration steps.",
      "Please include the test results in the project summary.",
    ]),
    source: {
      provider: "discord",
      resourceType: "message",
      resourceId: messageId,
      parentResourceId: channelId,
    },
  };
  return {
    principal,
    scope,
    source,
    contextItem,
    perspective: referencePerspective(createDefaultPerspective()),
  };
}
