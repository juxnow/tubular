import {
  isDefinedToolContract,
  type RegisteredToolContract,
} from "./tool-contract.js";

export class ContractRegistry {
  readonly #contracts = new Map<string, RegisteredToolContract>();

  constructor(contracts: readonly RegisteredToolContract[] = []) {
    for (const contract of contracts) {
      this.register(contract);
    }
  }

  register(contract: RegisteredToolContract): void {
    if (!isDefinedToolContract(contract)) {
      throw new TypeError("Tool contracts must be created with defineToolContract");
    }
    if (this.#contracts.has(contract.name)) {
      throw new Error(`Tool contract already registered: ${contract.name}`);
    }
    this.#contracts.set(contract.name, contract);
  }

  get(name: string): RegisteredToolContract | undefined {
    return this.#contracts.get(name);
  }

  list(): readonly RegisteredToolContract[] {
    return [...this.#contracts.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }
}
