import { isDefinedToolContract, type RegisteredToolContract } from "./tool-contract.js";

/** Canonical registered legacy contracts shared by validation, policy, and portable projections. */
export class ContractRegistry {
  /** Sealed definitions keyed by exact tool name; duplicate registration is rejected. */
  readonly #contracts = new Map<string, RegisteredToolContract>();

  /** Register an optional initial catalog, rejecting duplicates and unsealed definitions. */
  constructor(contracts: readonly RegisteredToolContract[] = []) {
    for (const contract of contracts) {
      this.register(contract);
    }
  }

  /** Accept only a contract created by defineToolContract and reject a duplicate tool name. */
  register(contract: RegisteredToolContract): void {
    if (!isDefinedToolContract(contract)) {
      throw new TypeError("Tool contracts must be created with defineToolContract");
    }
    if (this.#contracts.has(contract.name)) {
      throw new Error(`Tool contract already registered: ${contract.name}`);
    }
    this.#contracts.set(contract.name, contract);
  }

  /** Look up an exact registered name, returning undefined when it is unknown. */
  get(name: string): RegisteredToolContract | undefined {
    return this.#contracts.get(name);
  }

  /** Return contracts sorted by name for deterministic projections. */
  list(): readonly RegisteredToolContract[] {
    return [...this.#contracts.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
}
