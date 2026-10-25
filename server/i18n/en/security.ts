import { formatters } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import draftChecks from "./security-draft-checks.js";

const fmt = formatters("en");
/** Keys, files and similar items, separated as the locale separates a plain list. */
const list = (items: readonly string[]) => fmt.list(items, { type: "unit" });

/** Sandbox messages, and the outgoing-text checks on a PR. */
export default {
  /** A Claude Code write agent that cannot get the OS sandbox (503). */
  sandbox: {
    unavailable: `Claude Code agents that edit files and run commands need the operating system sandbox, which is not available on this computer. On Linux it needs bubblewrap (bwrap) and socat; on macOS, sandbox-exec. Install them, switch this project to Codex, or allow unsandboxed agents under Settings → Agent safety.`,
    /** bubblewrap is installed but cannot create a sandbox, as in Docker with default options. */
    blocked: `Claude Code agents that edit files and run commands need the operating system sandbox. bubblewrap is installed but cannot create a sandbox here, as in a Docker container started without the security options listed in docs/docker.md. Start the container with those options, or allow unsandboxed agents if you accept the container as the only boundary.`,
    installFix: "Install bubblewrap and socat (Debian, Ubuntu)",
    dockerFix:
      "In Docker, add these options to docker run (see docs/docker.md)",
    codexFix:
      "Or sign in to Codex and choose it as the provider under Settings → Models",
    allowFix: `Or allow unsandboxed Claude agents under Settings → Agent safety, or start ${product.name} with this variable (agents then run with your full user rights)`,
  },
  /** BELLPR_ALLOWED_ORIGINS (or an origin given to the request guard) is not valid. */
  invalidOrigins:
    "BELLPR_ALLOWED_ORIGINS must contain comma-separated origins without credentials, paths, queries, fragments, or wildcards; plain HTTP is accepted only for loopback addresses.",
  /** A repository whose own Git configuration could run commands (409). */
  gitConfigUnsafe: ({ keys }: { keys: string[] }) =>
    `This repository's Git configuration sets ${list(keys)}, which can make Git run other programs or send credentials elsewhere. ${product.name} does not run Git in it. Remove these settings from its .git/config, or import the project again.`,
  /** A teammate checkout whose .git file points somewhere else (409). */
  worktreeForged:
    "A teammate's checkout no longer points to this run's Git repository, so it is not used. Retry the task to give it a fresh checkout.",
  /** A recorded GitHub repository or branch name that is not valid (409). */
  invalidRemote:
    "The GitHub repository or branch recorded for this run is not a valid name, so nothing was fetched or pushed.",
  /** Checks on the text sent to GitHub, shown in the draft tab and publish dialog. */
  draftChecks,
};
