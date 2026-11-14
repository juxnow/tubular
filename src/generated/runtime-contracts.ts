// Generated from authored runtime boundary types. Do not edit.
export const runtimeContractSchemas = {
  "ToolInputValidationFailure": {
    "type": "object",
    "properties": {
      "issues": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "code": {
              "type": "string",
              "description": "Stable diagnostic category such as `type`, `unknown_property`, or `invalid_schema`."
            },
            "message": {
              "type": "string",
              "description": "Explanation of the violated contract, intended for developers rather than policy decisions."
            },
            "path": {
              "type": "string",
              "description": "Value location: generated validators use JSON Pointer with an empty root; legacy parsers use slash paths with `/` at the root."
            }
          },
          "required": [
            "code",
            "message",
            "path"
          ],
          "additionalProperties": false,
          "description": "A validation diagnostic. Paths identify values without including their contents."
        },
        "description": "Field paths and reasons, without echoing the rejected values or host context."
      },
      "status": {
        "type": "string",
        "const": "invalid_input",
        "description": "Stable discriminator used by adapters to distinguish pre-dispatch validation failure."
      }
    },
    "required": [
      "issues",
      "status"
    ],
    "additionalProperties": false,
    "description": "Input rejected before authorization or handler execution by the lightweight runtime."
  }
} as const;
