import { formatters } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";

const fmt = formatters("en");
/** Keys, files and similar items, separated as the locale separates a plain list. */
const list = (items: readonly string[]) => fmt.list(items, { type: "unit" });
const [bin] = product.binNames;

/**
 * Sign-in, session and sandbox messages, and Git safety refusals. Text
 * between backticks is shown as code on the sign-in pages.
 */
export default {
  /** The JSON error for an API request without a valid session (401). */
  authRequired: `Sign in to ${product.name} first: open the sign-in link printed in your terminal, or run \`${bin} open\` on this machine.`,
  /** The pages shown around signing in; plain HTML without scripts. */
  signIn: {
    title: `Sign in to ${product.name}`,
    heading: `Sign in to ${product.name}`,
    howTo: `Open the sign-in link printed in your terminal, or run \`${bin} open\` in a terminal on this machine (Docker: \`docker exec <container> ${bin} open --print\`).`,
    /** Shown above howTo when the link in the address bar was not accepted. */
    linkInvalid:
      "This sign-in link has expired or was already used. Each link works once, within two minutes.",
    signedInTitle: `Signed in to ${product.name}`,
    signedIn: "You are signed in on this browser.",
    continue: `Continue to ${product.name}`,
  },
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
