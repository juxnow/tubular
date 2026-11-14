import { describe, expect, it } from "vitest";
import {
  createHandoffEnvelope,
  verifyHandoffEnvelopeIntegrity,
} from "../src/context/handoff.js";
import {
  buildContextManifest,
  CONTEXT_LIMITS,
  verifyContextManifestIntegrity,
  type ContextSource,
} from "../src/context/manifest.js";
import { TestClock } from "./support.js";

const clock = new TestClock("2026-09-13T16:00:00.000Z");

const sources: readonly ContextSource[] = [
  {
    id: "public",
    label: "Public",
    mediaType: "text/plain",
    content: "hello",
    classification: "public",
    disclosure: "shareable",
    provenance: {
      kind: "url",
      locator: "https://example.test/public",
      observedAt: "2026-09-13T15:00:00.000Z",
    },
  },
  {
    id: "private",
    label: "Private",
    mediaType: "text/plain",
    content: "not for this handoff",
    classification: "private",
    disclosure: "local-only",
    provenance: {
      kind: "file",
      locator: "/private/example",
      observedAt: "2026-09-13T15:00:00.000Z",
    },
  },
];

describe("context manifests", () => {
  it("snapshots selected content and records omissions without leaking it", () => {
    const manifest = buildContextManifest(
      sources,
      {
        purpose: "share safe context",
        principalId: "agent.test",
        selectedSourceIds: ["public", "private", "missing"],
        classificationCeiling: "internal",
      },
      clock,
    );

    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]?.sourceId).toBe("public");
    expect(manifest.items[0]?.byteLength).toBe(5);
    expect(manifest.items[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.omitted).toEqual([
      { sourceId: "private", reason: "classification-exceeds-ceiling" },
      { sourceId: "missing", reason: "source-not-found" },
    ]);
    expect(JSON.stringify(manifest.omitted)).not.toContain("not for this handoff");
  });

  it("is deterministic for the same exact snapshots", () => {
    const request = {
      purpose: "deterministic",
      principalId: "agent.test",
      selectedSourceIds: ["public"],
      classificationCeiling: "public" as const,
    };
    expect(buildContextManifest(sources, request, clock)).toEqual(
      buildContextManifest(sources, request, clock),
    );
  });

  it("requires explicit source selection", () => {
    expect(() =>
      buildContextManifest(
        sources,
        {
          purpose: "invalid",
          principalId: "agent.test",
          selectedSourceIds: [],
          classificationCeiling: "public",
        },
        clock,
      ),
    ).toThrow("selected explicitly");
  });

  it("rejects fabricated provenance kinds and tampered snapshots", () => {
    expect(() =>
      buildContextManifest(
        [
          {
            ...sources[0]!,
            provenance: {
              ...sources[0]!.provenance,
              kind: "fabricated" as "manual",
            },
          },
        ],
        {
          purpose: "reject bad provenance",
          principalId: "agent.test",
          selectedSourceIds: ["public"],
          classificationCeiling: "public",
        },
        clock,
      ),
    ).toThrow("metadata exceeds");

    const manifest = buildContextManifest(
      sources,
      {
        purpose: "integrity",
        principalId: "agent.test",
        selectedSourceIds: ["public"],
        classificationCeiling: "public",
      },
      clock,
    );
    const item = manifest.items[0];
    if (item === undefined) {
      throw new Error("Expected a context item");
    }
    expect(
      verifyContextManifestIntegrity({
        ...manifest,
        items: [
          {
            ...item,
            provenance: { ...item.provenance, kind: "fabricated" as "manual" },
          },
        ],
      }),
    ).toBe(false);
  });

  it("omits an oversized source without copying its contents into omissions", () => {
    const oversized = "x".repeat(CONTEXT_LIMITS.maxSourceBytes + 1);
    const manifest = buildContextManifest(
      [
        {
          ...sources[0]!,
          id: "oversized",
          content: oversized,
        },
      ],
      {
        purpose: "bounded context",
        principalId: "agent.test",
        selectedSourceIds: ["oversized"],
        classificationCeiling: "public",
      },
      clock,
    );
    expect(manifest.items).toHaveLength(0);
    expect(manifest.omitted).toEqual([
      { sourceId: "oversized", reason: "source-exceeds-byte-limit" },
    ]);
    expect(JSON.stringify(manifest.omitted)).not.toContain(oversized.slice(0, 64));
  });

  it("pins a handoff to the manifest digest", () => {
    const manifest = buildContextManifest(
      sources,
      {
        purpose: "handoff",
        principalId: "agent.test",
        selectedSourceIds: ["public"],
        classificationCeiling: "public",
      },
      clock,
    );
    const handoff = createHandoffEnvelope(
      {
        fromPrincipalId: "human.test",
        intendedPrincipalIds: ["agent.test"],
        objective: "continue safely",
        constraints: ["do not infer authority"],
        openQuestions: ["which adapter is next?"],
        contextManifest: manifest,
      },
      clock,
    );
    expect(handoff.contextManifestId).toBe(manifest.id);
    expect(handoff.contextManifestDigest).toBe(manifest.digest);
    expect(handoff.contextManifest).toEqual(manifest);
    expect(JSON.stringify(handoff)).toContain("hello");
    expect(handoff.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyHandoffEnvelopeIntegrity(handoff)).toBe(true);
    expect(
      verifyHandoffEnvelopeIntegrity({ ...handoff, objective: "tampered" }),
    ).toBe(false);
  });

  it("refuses to transmit local-only context in a handoff", () => {
    const manifest = buildContextManifest(
      sources,
      {
        purpose: "keep local",
        principalId: "agent.test",
        selectedSourceIds: ["private"],
        classificationCeiling: "private",
      },
      clock,
    );
    expect(() =>
      createHandoffEnvelope(
        {
          fromPrincipalId: "human.test",
          intendedPrincipalIds: ["agent.test"],
          objective: "must fail",
          constraints: [],
          openQuestions: [],
          contextManifest: manifest,
        },
        clock,
      ),
    ).toThrow("local-only");
  });
});
