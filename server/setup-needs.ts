/**
 * The setup list in a teammate's or a follow-up round's report: what this
 * machine lacked for a check the agent could not run. The prompt text that
 * asks for it is in prompts/setup.ts.
 */
import type { SetupNeed } from "../shared/setup-needs.js";
import { redact } from "./secrets.js";

/** The report field in the CLIs' structured output; every object closed and fully required. */
export const setupJsonSchema = {
  type: "array",
  maxItems: 10,
  items: {
    type: "object",
    properties: {
      need: { type: "string" },
      command: { type: "string" },
      reason: { type: "string" },
    },
    required: ["need", "command", "reason"],
    additionalProperties: false,
  },
};

// The person may run these with sudo: one line, and never a download run by a
// shell, whether piped (`| sh`) or substituted (`sh <(curl …)`, `$(wget …)`).
const unsafeCommand =
  /[\r\n]|\|\s*(?:sudo\s+)?\S*sh\b|[<$]\(\s*(?:curl|wget)\b/;

/** Keeps well-formed needs and drops the rest; an agent's answer is not trusted. */
export function parseSetupNeeds(value: unknown): SetupNeed[] {
  if (!Array.isArray(value)) return [];
  const text = (input: unknown, max: number) =>
    typeof input === "string" ? redact(input.trim()).slice(0, max) : "";
  return value
    .slice(0, 10)
    .map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      return {
        need: text(record.need, 120),
        // A cut command would be a different command, so a long one is dropped.
        command: text(record.command, 301),
        reason: text(record.reason, 600),
      };
    })
    .filter(
      (entry) =>
        entry.need &&
        entry.command &&
        entry.command.length <= 300 &&
        !unsafeCommand.test(entry.command),
    );
}
