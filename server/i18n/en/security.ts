import { formatters } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import draftChecks from "./security-draft-checks.js";

const fmt = formatters("en");
/** Keys, files and similar items, separated as the locale separates a plain list. */
const list = (items: readonly string[]) => fmt.list(items, { type: "unit" });

/** Sandbox messages, and the outgoing-text checks on a PR. */
export default {
  /** A Claude Code or Antigravity write agent that cannot get the OS sandbox (503). */
  sandbox: {
    unavailable: `Claude Code Agents that edit files and run commands need the OS sandbox, which this computer lacks: Linux needs bubblewrap (bwrap) and socat, macOS sandbox-exec. Install them, switch this project to Codex, or allow unsandboxed Agents under Settings → Agent safety.`,
    /** bubblewrap is installed but cannot create a sandbox, as in Docker with default options. */
    blocked: `Claude Code Agents that edit files and run commands need the OS sandbox. bubblewrap is installed but can't create one here, as in Docker without the options in docs/docker.md. Add those options, or allow unsandboxed Agents if you accept the container as the only boundary.`,
    installFix: "Install bubblewrap and socat (Debian, Ubuntu)",
    dockerFix:
      "In Docker, add these options to docker run (see docs/docker.md)",
    codexFix:
      "Or sign in to Codex and choose it as the provider under Settings → AI provider",
    allowFix: `Or allow unsandboxed Agents under Settings → Agent safety, or start ${product.name} with this variable (Agents then run with your full user rights)`,
    /** An Antigravity write agent whose terminal sandbox cannot start (503). */
    antigravityUnavailable: `Antigravity Agents that edit files and run commands need the Antigravity CLI's terminal sandbox, unavailable here (Linux needs user namespaces; macOS, sandbox-exec). Choose Claude Code or Codex under Settings → AI provider, or allow unsandboxed Agents under Settings → Agent safety.`,
    /** Linux withholds user namespaces from the Antigravity CLI (Ubuntu 24.04 and later by default). */
    antigravityRestricted: `Antigravity Agents that edit files and run commands need the Antigravity CLI's terminal sandbox. It can't start: this Linux system blocks user namespaces (kernel.apparmor_restrict_unprivileged_userns, Ubuntu's default since 24.04). Allow them as docs/troubleshooting.md explains, or allow unsandboxed Agents under Settings → Agent safety. Switching to Claude Code or Codex may not help: their sandboxes can need it too.`,
    claudeFix:
      "Or sign in to Claude Code and choose it as the provider under Settings → AI provider",
    /** The working directory holds customizations the Antigravity CLI would load (422). */
    antigravityWorkspaceConfig: ({ paths }: { paths: string[] }) =>
      `This project has Antigravity customizations (${list(paths)}). The Antigravity CLI would run their hooks and MCP servers outside any sandbox for every Agent, so ${product.name} won't start Antigravity here. Choose Claude Code or Codex under Settings → AI provider instead.`,
  },
  /** BELLPR_ALLOWED_ORIGINS (or an origin given to the request guard) is not valid. */
  invalidOrigins:
    "BELLPR_ALLOWED_ORIGINS must contain comma-separated origins without credentials, paths, queries, fragments, or wildcards; plain HTTP is accepted only for loopback addresses.",
  /** BELLPR_SUITE_LINKS is not valid. Never quotes the value: it may hold a private host name. */
  suiteLinksInvalid: `BELLPR_SUITE_LINKS takes explain=<origin> or personal=<origin>, comma-separated, each product once. An origin has no credentials, path (not even a trailing /), query, fragment, wildcard or port 0. It is this computer (localhost, 127.x.x.x or [::1]) or an https *.ts.net name in the tailnet of BELLPR_PUBLIC_URL or BELLPR_ALLOWED_ORIGINS, never this ${product.name}'s own address.`,
  /** A repository whose own Git configuration could run commands (409). */
  gitConfigUnsafe: ({ keys }: { keys: string[] }) =>
    `This repository's Git config sets ${list(keys)}, which can make Git run other programs or send credentials elsewhere, so ${product.name} won't run Git in it. Remove them from .git/config or re-import the project.`,
  /** A teammate checkout whose .git file points somewhere else (409). */
  worktreeForged:
    "A teammate's working directory no longer points to this run's Git repository, so it is unused. Retry the task for a fresh one.",
  /** A recorded GitHub repository or branch name that is not valid (409). */
  invalidRemote:
    "The GitHub repository or branch recorded for this run is not a valid name, so nothing was fetched or pushed.",
  /** Checks on the text sent to GitHub, shown in the draft tab and publish dialog. */
  draftChecks,
};
