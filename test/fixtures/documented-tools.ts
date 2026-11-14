/**
 * A documented query whose scope is selected by the host, never by tool arguments.
 * @title Documented query
 * @example {"id":"123e4567-e89b-12d3-a456-426614174000","query":"hello","tags":["a"]}
 */
export interface DocumentedQuery {
  /**
   * Correlation identifier only; it does not identify an authenticated caller.
   * @format uuid
   * @example "123e4567-e89b-12d3-a456-426614174000"
   */
  id: string;
  /**
   * Lowercase search token, measured in Unicode code points.
   * @minLength 2
   * @maxLength 8
   * @pattern ^[a-z]+$
   * @example "hello"
   */
  query: string;
  /**
   * Requested count; omission uses the handler's documented default.
   * @isInt
   * @minimum 1
   * @maximum 5
   * @default 2
   */
  count?: number;
  /**
   * Explicit null means no label. Omission has the same handler behavior.
   * @maxLength 3
   * @default null
   */
  label?: string | null;
  /**
   * One or two literal categories. These are filters, not permissions.
   * @minItems 1
   * @maxItems 2
   * @example ["a"]
   */
  tags: readonly ("a" | "b")[];
}

/** A validated response with the host-selected prefix and the effective request count. */
export interface DocumentedOutput {
  /** Host-scoped match text; the model cannot supply the prefix. */
  value: string;
  /** Effective integer count after applying the handler default. */
  count: number;
  /** Caller label or explicit null when absent. */
  label: string | null;
}

/** Trusted fixture context excluded from the generated argument schema. */
export interface DocumentedHost {
  /** Value selected by the host before any model tool call. */
  prefix: string;
}

/**
 * Search only the host-selected synthetic context.
 * @tubular
 * @summary Documented search
 * @deprecated Prefer the next application revision; this fixture still executes.
 * @example {"id":"123e4567-e89b-12d3-a456-426614174000","query":"hello","tags":["a"]}
 * @returns The validated host-scoped match and effective count.
 */
export function documentedSearch(
  input: DocumentedQuery,
  context: DocumentedHost,
): DocumentedOutput {
  return {
    value: `${context.prefix}:${input.query}`,
    count: input.count ?? 2,
    label: input.label ?? null,
  };
}
