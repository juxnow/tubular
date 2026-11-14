/** Author-supplied discovery text. These fields describe a capability and never grant execution authority. */
export interface ToolDocumentation {
  /** Human-readable tool summary, also sent as the native MCP tool description. */
  readonly description?: string;
  /** Short display label from the function's summary tag; not a registry key. */
  readonly title?: string;
  /** True when callers should migrate away; does not disable the handler. */
  readonly deprecated?: boolean;
  /** Meaning of a validated successful return, derived from the function's returns tag. */
  readonly resultDescription?: string;
}
