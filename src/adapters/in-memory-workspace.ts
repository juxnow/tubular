import { appendNoteInputSchema } from "../builtin/append-note.js";
import type { JsonObject } from "../core/json.js";
import type { ExecutorContext, ToolExecutor } from "../runtime/kernel.js";

export interface WorkspaceNote {
  readonly resource: string;
  readonly revision: number;
  readonly entries: readonly string[];
}

export class InMemoryWorkspace {
  readonly #notes = new Map<string, WorkspaceNote>();
  readonly #operations = new Map<
    string,
    { readonly resource: string; readonly text: string; readonly note: WorkspaceNote }
  >();

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

  read(resource: string): WorkspaceNote | undefined {
    return this.#notes.get(resource);
  }
}

export class AppendNoteExecutor implements ToolExecutor {
  readonly toolName = "workspace.note.append";
  readonly idempotency = "proposal-id";
  readonly #workspace: InMemoryWorkspace;

  constructor(workspace: InMemoryWorkspace) {
    this.#workspace = workspace;
  }

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
