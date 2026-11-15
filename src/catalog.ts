import { appendNoteContract } from "./builtin/append-note.js";
import { ContractRegistry } from "./contracts/registry.js";
import type { PerspectiveDefinition } from "./perspective/definition.js";
import { perspectiveFromRegistry } from "./profiles/totally-tubular.js";

/** Construct the legacy catalog with the governed append-note capability registered once. */
export function createDefaultRegistry(): ContractRegistry {
  return new ContractRegistry([appendNoteContract]);
}

/** Derive the experimental portable definition from the default canonical registry. */
export function createDefaultPerspective(): PerspectiveDefinition {
  return perspectiveFromRegistry(createDefaultRegistry());
}
