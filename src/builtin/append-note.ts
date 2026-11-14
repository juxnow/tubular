import { isCanonicalWorkspaceResource, WORKSPACE_RESOURCE_PATTERN } from "../authority/resource.js";
import {
  hasOnlyKeys,
  invalid,
  type RuntimeSchema,
  type SchemaIssue,
  type ValidationResult,
} from "../contracts/schema.js";
import { defineToolContract } from "../contracts/tool-contract.js";
import { isJsonObject, type JsonObject } from "../core/json.js";

/** Legacy governed append arguments. Only a canonical workspace resource and bounded nonblank text are accepted. */
export interface AppendNoteInput extends JsonObject {
  /** Canonical logical workspace URI selected for the operation; it does not grant filesystem access. */
  readonly resource: string;
  /** Nonblank append payload, limited to 4000 Unicode code points by the runtime parser. */
  readonly text: string;
}

/** Validated append result describing the resulting note revision and entry count. */
export interface AppendNoteOutput extends JsonObject {
  /** Canonical logical workspace URI selected for the operation; it does not grant filesystem access. */
  readonly resource: string;
  /** One-based resulting note revision, represented as a positive safe integer. */
  readonly revision: number;
  /** Number of appended entries after completion, represented as a positive safe integer. */
  readonly entryCount: number;
  /** Number of UTF-16 code units appended, matching JavaScript string.length; this is not a byte or code-point count. */
  readonly appendedCharacters: number;
}

const inputKeys = new Set(["resource", "text"]);
const outputKeys = new Set(["resource", "revision", "entryCount", "appendedCharacters"]);

/** Reject unknown keys, noncanonical resources, and blank or oversized text before an effect is proposed. */
function parseAppendNoteInput(input: unknown): ValidationResult<AppendNoteInput> {
  if (!isJsonObject(input)) {
    return invalid("/", "type", "Input must be an object");
  }
  const issues: SchemaIssue[] = [...hasOnlyKeys(input, inputKeys)];
  const resource = input["resource"];
  const text = input["text"];
  if (typeof resource !== "string" || !isCanonicalWorkspaceResource(resource)) {
    issues.push({
      path: "/resource",
      code: "format",
      message: "resource must be a canonical workspace:// URI",
    });
  }
  if (typeof text !== "string" || text.trim().length === 0 || [...text].length > 4_000) {
    issues.push({
      path: "/text",
      code: "length",
      message: "text must contain nonblank text of 1 to 4000 Unicode code points",
    });
  }
  if (issues.length > 0 || typeof resource !== "string" || typeof text !== "string") {
    return { ok: false, issues };
  }
  return { ok: true, value: { resource, text } };
}

/** Narrow to a positive JavaScript safe integer, excluding fractional and nonfinite values. */
function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Validate resource and positive safe-integer counters before releasing executor output. */
function parseAppendNoteOutput(input: unknown): ValidationResult<AppendNoteOutput> {
  if (!isJsonObject(input)) {
    return invalid("/", "type", "Output must be an object");
  }
  const issues: SchemaIssue[] = [...hasOnlyKeys(input, outputKeys)];
  const resource = input["resource"];
  const revision = input["revision"];
  const entryCount = input["entryCount"];
  const appendedCharacters = input["appendedCharacters"];
  if (typeof resource !== "string" || !isCanonicalWorkspaceResource(resource)) {
    issues.push({ path: "/resource", code: "format", message: "Invalid resource URI" });
  }
  for (const [key, value] of [
    ["revision", revision],
    ["entryCount", entryCount],
    ["appendedCharacters", appendedCharacters],
  ] as const) {
    if (!positiveInteger(value)) {
      issues.push({
        path: `/${key}`,
        code: "type",
        message: `${key} must be a positive safe integer`,
      });
    }
  }
  if (
    issues.length > 0 ||
    typeof resource !== "string" ||
    !positiveInteger(revision) ||
    !positiveInteger(entryCount) ||
    !positiveInteger(appendedCharacters)
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: { resource, revision, entryCount, appendedCharacters },
  };
}

/** Canonical legacy input schema paired with its parser; generated portable projections reuse this object. */
export const appendNoteInputSchema: RuntimeSchema<AppendNoteInput> = {
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["resource", "text"],
    properties: {
      resource: {
        type: "string",
        pattern: WORKSPACE_RESOURCE_PATTERN,
        maxLength: 512,
        description: "Logical workspace resource to update",
      },
      text: {
        type: "string",
        minLength: 1,
        maxLength: 4000,
        pattern: "\\S",
        description: "Text to append after exact human approval",
      },
    },
  },
  parse: parseAppendNoteInput,
};

/** Canonical legacy output schema paired with its parser; counters use positive safe integers. */
export const appendNoteOutputSchema: RuntimeSchema<AppendNoteOutput> = {
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["resource", "revision", "entryCount", "appendedCharacters"],
    properties: {
      resource: {
        type: "string",
        pattern: WORKSPACE_RESOURCE_PATTERN,
        maxLength: 512,
      },
      revision: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      entryCount: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      appendedCharacters: {
        type: "integer",
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    },
  },
  parse: parseAppendNoteOutput,
};

/** Governed workspace append capability requiring exact human approval and explicit workspace authority. */
export const appendNoteContract = defineToolContract({
  name: "workspace.note.append",
  version: "1.0.0",
  title: "Append a workspace note",
  description: "Append text to one logical workspace note through the trusted execution kernel.",
  effect: "workspace-write",
  approval: "exact-human",
  input: appendNoteInputSchema,
  output: appendNoteOutputSchema,
  errors: [
    {
      code: "INPUT_INVALID",
      description: "The input does not satisfy the closed runtime schema.",
      retryable: true,
    },
    {
      code: "APPROVAL_REQUIRED",
      description: "A human has not approved this exact proposal digest.",
      retryable: true,
    },
    {
      code: "APPROVAL_EXPIRED",
      description: "The exact approval or its challenge has expired.",
      retryable: true,
    },
    {
      code: "APPROVAL_MISMATCH",
      description: "The stored approval does not match the executable proposal.",
      retryable: false,
    },
    {
      code: "POLICY_DENIED",
      description:
        "The active lease, context binding, resource scope, or effect ceiling denies the proposal.",
      retryable: false,
    },
    {
      code: "OUTPUT_INVALID",
      description: "The trusted adapter returned an invalid result.",
      retryable: false,
    },
    {
      code: "EXECUTION_OUTCOME_UNKNOWN",
      description: "Dispatch began but completion could not be proven.",
      retryable: false,
    },
    {
      code: "APPROVAL_REVOKED",
      description: "Approval was revoked before the proposal could execute.",
      retryable: false,
    },
    {
      code: "EXECUTOR_NOT_FOUND",
      description: "No trusted effect adapter is bound to this contract.",
      retryable: false,
    },
    {
      code: "PROPOSAL_LIMIT_REACHED",
      description: "The principal has reached its live proposal limit.",
      retryable: true,
    },
  ],
  semantics: {
    targets: [
      {
        name: "resource",
        resourceKindRef: "workspace-resource",
        fromInput: "/resource",
        required: true,
      },
    ],
    contexts: [
      {
        name: "working-context",
        acceptsKindRefs: ["exact-manifest"],
        required: true,
        minItems: 1,
        maxItems: 64,
        maxBytes: 1_048_576,
      },
    ],
    authority: {
      kind: "all-of",
      requirements: [
        {
          kind: "scheme",
          schemeRef: "capability-lease",
          claims: { exactContextBinding: true },
        },
        {
          kind: "scheme",
          schemeRef: "exact-human-approval",
          claims: { binds: "proposal-digest" },
        },
      ],
    },
    effects: [
      {
        kindRef: "workspace-write",
        occurrence: "guaranteed",
        targetRef: "resource",
        disclosures: [],
      },
    ],
    execution: {
      completion: "synchronous",
      idempotency: "invocation-id",
      outcomeEvidence: "receipt-required",
      unknownOutcome: "terminal-reconciliation-required",
    },
    lifecycleRef: "proposal-execution",
  },
  /** Resolve the already validated target resource without creating or widening authority. */
  resolveResource(input: AppendNoteInput): string {
    return input.resource;
  },
});
