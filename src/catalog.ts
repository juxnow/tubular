import { appendNoteContract } from "./builtin/append-note.js";
import { ContractRegistry } from "./contracts/registry.js";
import { portAuthorityFromRegistry } from "./profiles/totally-tubular.js";
import type { PortAuthorityDefinition } from "./port-authority/definition.js";

export function createDefaultRegistry(): ContractRegistry {
  return new ContractRegistry([appendNoteContract]);
}

export function createDefaultPortAuthority(): PortAuthorityDefinition {
  return portAuthorityFromRegistry(createDefaultRegistry());
}
