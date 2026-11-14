import type { GovernedToolContext } from "@juxnow/tubular";

/** Arguments for an ephemeral governed append; the trusted runtime supplies authority and selected context separately. */
export interface AppendInput {
  /** Canonical logical workspace URI selected for the operation; it does not grant filesystem access. */
  resource: string;
  /**
   * Text to append as one entry; whitespace-only text is rejected before dispatch.
   * @minLength 1
   * @maxLength 4000
   * @pattern \S
   * @example "Review the selected context before approving."
   */
  text: string;
}

/** Snapshot of the in-memory note after this operation, plus source identities from the host-selected context. */
export interface AppendOutput {
  /** Canonical logical workspace URI selected for the operation; it does not grant filesystem access. */
  resource: string;
  /** Ordered note entries after the append; replaying the same operation returns its prior snapshot. */
  lines: readonly string[];
  /** Source identifiers that the host selected for this operation; omitted sources never reach the handler. */
  selectedSourceIds: readonly string[];
}

// This example adapter stores effects only in memory. The operation map also
// deduplicates adapter calls by proposal ID within this process.
const notes = new Map<string, string[]>();
const completed = new Map<string, AppendOutput>();

/**
 * Append one note entry using the trusted operation identity for in-process deduplication.
 * @tubular
 * @summary Append a governed note
 * @example {"resource":"workspace://notes/one","text":"Reviewed the selected context."}
 * @returns The note entries after this append and the exact selected context source identifiers.
 */
export function appendNote(input: AppendInput, context: GovernedToolContext): AppendOutput {
  const previous = completed.get(context.operationId);
  if (previous !== undefined) return previous;
  const lines = [...(notes.get(input.resource) ?? []), input.text];
  notes.set(input.resource, lines);
  const result: AppendOutput = {
    resource: input.resource,
    lines,
    selectedSourceIds: context.manifest.items.map((item) => item.sourceId),
  };
  completed.set(context.operationId, result);
  return result;
}
