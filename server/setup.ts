import type { AgentProvider } from "../shared/models.js";
import type { SetupNeed } from "../shared/setup.js";
import { redact } from "./secrets.js";

/**
 * What an agent may install. The machine belongs to the person, and agents
 * read untrusted repository content, so only throwaway places are writable.
 */
export const installBoundaries =
  "Never change this machine: no sudo or system package managers, no global or user-level installs (for example npm -g, pip install --user, cargo install, rustup component add) and no edits outside this working directory, except in a temporary directory you create. Installing inside them is allowed: the project's own lockfile install (such as npm ci) or a package unpacked into a temporary directory that build tools are pointed at. When a check still needs a change to the machine, skip it and report what is missing.";

/** Where an agent's commands really run, so it describes its limits truthfully. */
export function commandEnvironment(provider: AgentProvider = "codex") {
  return provider === "claude"
    ? "Your commands are not sandboxed: they run with the person's own account on their machine, which is why the rules about changing the machine matter."
    : "Codex runs your commands in a workspace-write sandbox: writing outside this worktree and network access may be blocked, so a check that needs them is reported as missing setup.";
}

/** The report field that turns missing setup into the person's checklist. */
export const setupInstruction =
  "setup lists what this machine lacks for checks you could not run, so the person can install it: need (what is missing, Traditional Chinese), command (one command the person can run, preferably the one the project's own documentation gives; it may use sudo) and reason (Traditional Chinese: which check it blocked and where the project documents the requirement, if it does). List it also when you worked around it in a temporary directory. Empty when nothing was missing.";

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
