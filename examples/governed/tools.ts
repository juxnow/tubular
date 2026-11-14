import type { GovernedToolContext } from "@juxnow/tubular";

export interface AppendInput {
  resource: string;
  text: string;
}

export interface AppendOutput {
  resource: string;
  lines: readonly string[];
  selectedSourceIds: readonly string[];
}

// This example adapter stores effects only in memory. The operation map also
// deduplicates adapter calls by proposal ID within this process.
const notes = new Map<string, string[]>();
const completed = new Map<string, AppendOutput>();

/** @tubular */
export function appendNote(input: AppendInput, context: GovernedToolContext): AppendOutput {
  const previous = completed.get(context.operationId);
  if (previous !== undefined) return previous;
  const lines = [...(notes.get(input.resource) ?? []), input.text];
  notes.set(input.resource, lines);
  const result: AppendOutput = {
    resource: input.resource,
    lines,
    selectedSourceIds: context.manifest.items.map(item => item.sourceId),
  };
  completed.set(context.operationId, result);
  return result;
}
