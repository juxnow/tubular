/** Greeting arguments used to test schema binding, input rejection, and immutable authorization snapshots. */
export interface GreetingInput {
  /** Display name inserted into the validated greeting output. */
  name: string;
  /** Optional punctuation switch; omission produces the ordinary greeting. */
  excited?: boolean;
}
/** Closed successful greeting output; unexpected keys or nonstring text must be rejected. */
export interface GreetingOutput {
  /** Rendered greeting text after the handler has applied the requested punctuation. */
  greeting: string;
}
/** Trusted fixture tenant context, independent of model-supplied tool arguments. */
export interface HostContext {
  /** Host-selected tenant label, never accepted from the tool's input schema. */
  tenant: string;
}

/** Render a fixture greeting using validated arguments and the trusted tenant context.
 * @tubular
 */
export function greet(input: GreetingInput, context: HostContext): GreetingOutput {
  return { greeting: `${context.tenant}: Hello, ${input.name}${input.excited ? "!" : "."}` };
}

/** Model-facing greeting arguments compiled into native MCP input schema. */
export interface McpInput {
  /** Greeting target supplied by the model; authority is carried separately in host context. */
  readonly text: string;
}
/** Validated greeting response used to test native MCP output and structured-content behavior. */
export interface McpOutput {
  /** Display greeting released only after output validation succeeds. */
  readonly greeting: string;
}
/** Trusted fixture identity and policy decision resolved outside model input. */
export interface McpHostContext {
  /** Host-selected fixture identity that extra model input fields cannot replace. */
  readonly principal: string;
  /** Trusted fixture decision returned by the host authorization callback; ASK never dispatches. */
  readonly decision: "ALLOW" | "ASK" | "DENY";
}

/** Produce a greeting from validated arguments and independently supplied host context. */
export function generatedGreet(input: McpInput, context: McpHostContext): McpOutput {
  return { greeting: `${input.text}, ${context.principal}` };
}
