import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeGenerationHost } from "../src/typegen/node-generation-host.js";
import { artifactEncodings } from "./fixtures/artifact-encodings.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, readFileSync: vi.fn(original.readFileSync) };
});
afterEach(() => vi.mocked(readFileSync).mockReset());

describe("Node artifact reader", () => {
  it.each(artifactEncodings)("preserves $name bytes from the filesystem", ({ encode }) => {
    const bytes = encode("generated contract\n");
    vi.mocked(readFileSync).mockReturnValue(bytes);
    expect(createNodeGenerationHost().readArtifact("schemas.json")).toEqual(bytes);
    expect(readFileSync).toHaveBeenCalledWith("schemas.json");
  });

  it("distinguishes missing files, empty files, and permission errors", () => {
    const host = createNodeGenerationHost();
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("Missing"), { code: "ENOENT" });
    });
    expect(host.readArtifact("missing.json")).toBeUndefined();
    vi.mocked(readFileSync).mockReturnValueOnce(Buffer.alloc(0));
    expect(host.readArtifact("empty.json")).toEqual(Buffer.alloc(0));
    const denied = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw denied;
    });
    expect(() => host.readArtifact("restricted.json")).toThrow(denied);
  });
});
