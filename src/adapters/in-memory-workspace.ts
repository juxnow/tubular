import { appendNoteInputSchema } from "../builtin/append-note.js";
import type { JsonObject } from "../core/json.js";
import type { ExecutorContext, ToolExecutor } from "../runtime/kernel.js";

/** Immutable snapshot of one in-memory note after a completed append. */
export interface WorkspaceNote {
  /** Canonical logical workspace URI selected for the operation; it does not grant filesystem access. */
  readonly resource: string;
  /** One-based append revision; repeated operation keys do not increment it. */
  readonly revision: number;
  /** Ordered appended strings; earlier snapshots remain unchanged after later appends. */
  readonly entries: readonly string[];
}

/** Ephemeral note store with operation-key deduplication; all data is lost on process exit. */
export class InMemoryWorkspace {
  /** Current immutable note snapshots indexed by canonical resource URI. */
  readonly #notes = new Map<string, WorkspaceNote>();
  /** Operation-key ledger retained for this store's lifetime to suppress duplicate appends. */
  readonly #operations = new Map<
    string,
    {
      /** Canonical logical workspace URI selected for the operation; it does not grant filesystem access. */
      readonly resource: string;
      /** Exact text originally associated with the operation key; reuse with different text is rejected. */
      readonly text: string;
      /** Result of the first completed operation, returned for matching retries. */
      readonly note: WorkspaceNote;
    }
  >();

  /** Append once per operationId and return the resulting snapshot; reject reuse with different arguments. */
  append(resource: string, text: string, operationId: string): WorkspaceNote {
    const prior = this.#operations.get(operationId);
    if (prior !== undefined) {
      if (prior.resource !== resource || prior.text !== text) {
        throw new Error("An operation id cannot be reused for different input");
      }
      return prior.note;
    }
    const current = this.#notes.get(resource);
    const note: WorkspaceNote = Object.freeze({
      resource,
      revision: (current?.revision ?? 0) + 1,
      entries: Object.freeze([...(current?.entries ?? []), text]),
    });
    this.#notes.set(resource, note);
    this.#operations.set(operationId, Object.freeze({ resource, text, note }));
    return note;
  }

  /** Return the stored immutable snapshot, or undefined if no note has been created. */
  read(resource: string): WorkspaceNote | undefined {
    return this.#notes.get(resource);
  }
}

/** Trusted adapter that applies validated note appends to an injected in-memory store. */
export class AppendNoteExecutor implements ToolExecutor {
  /** Exact registered tool name; policy grants match this identifier without aliases. */
  readonly toolName = "workspace.note.append";
  /** Promises proposal-id deduplication through the injected store's operation ledger. */
  readonly idempotency = "proposal-id";
  /** Injected ephemeral store that owns mutation and operation-key deduplication. */
  readonly #workspace: InMemoryWorkspace;

  /** Capture a trusted store; constructing the adapter performs no append. */
  constructor(workspace: InMemoryWorkspace) {
    this.#workspace = workspace;
  }

  /** Revalidate input, append using the proposal operation key, and report note counters. */
  async execute(input: JsonObject, context: ExecutorContext): Promise<unknown> {
    context.signal.throwIfAborted();
    const parsed = appendNoteInputSchema.parse(input);
    if (!parsed.ok) {
      throw new TypeError("Trusted executor received invalid input");
    }
    const note = this.#workspace.append(
      parsed.value.resource,
      parsed.value.text,
      context.operationId,
    );
    return {
      resource: note.resource,
      revision: note.revision,
      entryCount: note.entries.length,
      appendedCharacters: parsed.value.text.length,
    };
  }
}
