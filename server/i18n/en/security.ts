import { formatters } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";

const fmt = formatters("en");
/** Keys, files and similar items, separated as the locale separates a plain list. */
const list = (items: readonly string[]) => fmt.list(items, { type: "unit" });

/** Sign-in, session and sandbox messages, and Git safety refusals. */
export default {
  /** A Claude Code write agent that cannot get the OS sandbox (503). */
  sandbox: {
    unavailable: `Claude Code agents that edit files and run commands need the operating system sandbox, which is not available on this computer. On Linux it needs bubblewrap (bwrap) and socat; on macOS, sandbox-exec. Install them, switch this project to Codex, or allow unsandboxed agents under Settings → Agent safety.`,
    installFix: "Install bubblewrap and socat (Debian, Ubuntu)",
    codexFix:
      "Or sign in to Codex and choose it as the provider under Settings → Models",
    allowFix: `Or allow unsandboxed Claude agents under Settings → Agent safety, or start ${product.name} with this variable (agents then run with your full user rights)`,
  },
  /** A repository whose own Git configuration could run commands (409). */
  gitConfigUnsafe: ({ keys }: { keys: string[] }) =>
    `This repository's Git configuration sets ${list(keys)}, which can make Git run other programs or send credentials elsewhere. ${product.name} does not run Git in it. Remove these settings from its .git/config, or import the project again.`,
  /** A teammate checkout whose .git file points somewhere else (409). */
  worktreeForged:
    "A teammate's checkout no longer points to this run's Git repository, so it is not used. Retry the task to give it a fresh checkout.",
  /** A recorded GitHub repository or branch name that is not valid (409). */
  invalidRemote:
    "The GitHub repository or branch recorded for this run is not a valid name, so nothing was fetched or pushed.",
};
