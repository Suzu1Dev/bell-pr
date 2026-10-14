import { formatters } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";

const fmt = formatters("en");
/** Keys, files and similar items, separated as the locale separates a plain list. */
const list = (items: readonly string[]) => fmt.list(items, { type: "unit" });
const [bin] = product.binNames;

/**
 * Sign-in, session and sandbox messages, and the outgoing-text checks on a
 * PR. Text between backticks is shown as code on the sign-in pages; the
 * JSON messages, shown as plain text, use none.
 */
export default {
  /** The JSON error for an API request without a valid session (401). */
  authRequired: `Sign in to ${product.name} first: open the sign-in link printed in your terminal, or run ${bin} open on this machine.`,
  /** The pages shown around signing in; plain HTML without scripts. */
  signIn: {
    title: `Sign in to ${product.name}`,
    heading: `Sign in to ${product.name}`,
    howTo: `Open the sign-in link printed in your terminal, or run \`${bin} open\` in a terminal on this machine (Docker: \`docker exec <container> ${bin} open --print\`).`,
    /** Shown above howTo when the link in the address bar was not accepted. */
    linkInvalid: `This sign-in link is no longer valid. A link from \`${bin} open\` works once, within two minutes; the link printed when ${product.name} starts works until it restarts.`,
    signedInTitle: `Signed in to ${product.name}`,
    signedIn: "You are signed in on this browser.",
    continue: `Continue to ${product.name}`,
  },
  /** A Claude Code write agent that cannot get the OS sandbox (503). */
  sandbox: {
    unavailable: `Claude Code agents that edit files and run commands need the operating system sandbox, which is not available on this computer. On Linux it needs bubblewrap (bwrap) and socat; on macOS, sandbox-exec. Install them, switch this project to Codex, or allow unsandboxed agents under Settings → Agent safety.`,
    /** bubblewrap is installed but cannot create a sandbox, as in Docker with default options. */
    blocked: `Claude Code agents that edit files and run commands need the operating system sandbox. bubblewrap is installed but cannot create a sandbox here, as in a Docker container started without the security options listed in docs/docker.md. Start the container with those options, or allow unsandboxed agents if you accept the container as the only boundary.`,
    installFix: "Install bubblewrap and socat (Debian, Ubuntu)",
    dockerFix:
      "In Docker, start the container with these options (see docs/docker.md)",
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
  draftChecks: {
    secret:
      "The PR title, description or commit message contains what looks like a credential, such as an access token or a private key. Remove it: everything you publish on GitHub is public.",
    /** Which field holds it. */
    secretIn: ({ field }: { field: "title" | "body" | "commitMessage" }) =>
      ({
        title: "In the title",
        body: "In the description",
        commitMessage: "In the commit message",
      })[field],
    localPaths:
      "The PR text contains a path on this computer, which can show your user name and how your folders are organised. Confirm that you want to publish it, or remove it.",
    localPath: ({ path }: { path: string }) => `Found: ${path}`,
    workflows:
      "This change edits GitHub Actions workflows or other CI configuration. Maintainers check such changes closely, and pushing a workflow file needs the GitHub CLI's workflow scope.",
    workflowFile: ({ path }: { path: string }) => `Changed: ${path}`,
    authorEmail: ({ emails }: { emails: string[] }) =>
      fmt.plural(emails.length) === "one"
        ? `The commit will carry the e-mail address ${fmt.list(emails)}, which anyone can read on GitHub. To keep it private, set your GitHub no-reply address with git config user.email; this is asked only once.`
        : `The commit will carry the e-mail addresses ${fmt.list(emails)}, which anyone can read on GitHub. To keep them private, set your GitHub no-reply address with git config user.email; this is asked only once per address.`,
  },
};
