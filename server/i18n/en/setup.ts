import type { DoctorCheckId } from "../../../shared/doctor.js";
import { formatters, intlLocale } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";

const fmt = formatters("en");

/** A disk size such as "12.3 GB". */
const size = (bytes: number) => {
  const units = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(intlLocale("en"), {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
};

const labels: Record<DoctorCheckId, string> = {
  node: "Node.js",
  git: "Git",
  "git-identity": "Git identity",
  gh: "GitHub CLI",
  "gh-auth": "GitHub sign-in",
  "gh-scopes": "GitHub permissions",
  codex: "Codex CLI",
  "codex-auth": "Codex sign-in",
  claude: "Claude Code",
  "claude-auth": "Claude Code sign-in",
  "claude-sandbox": "Claude Code sandbox",
  "provider-ready": "AI provider",
  "data-dir": "Data directory",
  app: product.name,
  platform: "Platform",
};

/** Environment checks (doctor), setup errors and app settings messages. */
export default {
  /** PUT /api/app-settings. */
  settings: {
    /** The settings an environment variable can fix, by name. */
    names: {
      maxActiveRuns: "Runs at a time",
      maxAgentProcesses: "Agent processes at a time",
      agentTimeoutScale: "Agent time limit scale",
      allowUnsandboxedAgents: "Allow unsandboxed Claude Code agents",
      retentionDays: "Days to keep a finished run's files",
    },
    locked: ({ setting, variable }: { setting: string; variable: string }) =>
      `The setting "${setting}" comes from the ${variable} environment variable. Change or remove the variable, then restart ${product.name}.`,
  },
  /** Deleting while a project analysis runs. */
  busy: {
    analysisRunning:
      "This project is being analyzed. Wait until the analysis finishes, then delete the project.",
    eraseAnalysisRunning:
      "A project analysis is still running. Wait until it finishes, then delete all data.",
  },
  /** Errors for a tool that is missing or not signed in, by error code. */
  errors: {
    gitMissing: `Git is not installed, or ${product.name} cannot find it on its PATH.`,
    ghMissing: `The GitHub CLI (gh) is not installed, or ${product.name} cannot find it on its PATH.`,
    codexMissing: `The Codex CLI is not installed, or ${product.name} cannot find it on its PATH.`,
    claudeMissing: `Claude Code is not installed, or ${product.name} cannot find it on its PATH.`,
    ghUnauthenticated:
      "The GitHub CLI is not signed in, or its sign-in expired. Sign in again, then retry.",
    githubAuthRequired:
      "GitHub asked for a sign-in. Sign in with the GitHub CLI, then retry.",
    gitIdentityMissing:
      "Git does not know your name and e-mail address, and every commit needs them. Set them, then retry.",
    ghWorkflowScope:
      "This change edits GitHub Actions workflows (.github/workflows), and your GitHub sign-in is not allowed to push them. Add the workflow permission, then retry.",
    codexUnauthenticated:
      "Codex is not signed in, or its sign-in expired. Sign in again, then retry.",
    claudeUnauthenticated:
      "Claude Code is not signed in, or its sign-in expired. Sign in again, then retry.",
    cloneTimeout:
      "Cloning took longer than 10 minutes, so it was stopped. Clone the repository yourself, then import the path of your clone.",
  },
  /** Labels of the commands that fix a problem. */
  fixes: {
    installGit: "Install Git",
    useWsl: `Install WSL2 and run ${product.name} inside it`,
    installGh: "Install the GitHub CLI",
    signInGh: "Sign in to GitHub",
    addWorkflowScope: "Allow pushing workflow changes",
    addRepoScope: "Allow pushing to repositories",
    installCodex: "Install the Codex CLI",
    signInCodex: "Sign in to Codex",
    installClaude: "Install Claude Code",
    signInClaude: "Sign in to Claude Code",
    setGitName: "Set your name",
    setGitEmail: "Set your e-mail address",
    setNoreplyEmail: "Use your private GitHub no-reply address",
    cloneLocally: "Clone it yourself",
    installNode: "Install Node.js 22 or later",
    dataDir: "Start with a data directory you can write to",
  },
  /** Values to replace in a fix command. */
  placeholders: {
    name: "Your Name",
    email: "you@example.com",
    directory: "<directory>",
  },
  doctor: {
    /** Each check's name. */
    labels,
    nodeTooOld: ({ version }: { version: string }) =>
      `Node.js ${version} is too old: ${product.name} needs version 22 or later.`,
    notInstalled: "Not installed.",
    notResponding: "Installed, but it did not answer within 5 seconds.",
    versionFailed: ({ command }: { command: string }) =>
      `Installed, but \`${command}\` failed.`,
    versionFailedWith: ({ command, output }: { command: string; output: string }) =>
      `Installed, but \`${command}\` failed: ${output}`,
    gitTooOld: ({ version }: { version: string }) =>
      `Git ${version} works, but moving a run onto the latest target branch needs Git 2.40 or later. Everything else works.`,
    identityMissing:
      "Not set: Git does not know your name and e-mail address, so nothing can be committed or published.",
    identityAutodetected: ({ email }: { email: string }) =>
      `No e-mail address is set. Git guessed ${email}, which would be published with your commits.`,
    identityUnknown: "Git could not report your identity.",
    signedOut: "Not signed in.",
    githubOffline:
      "Signed in, but GitHub could not be reached. Check your connection.",
    githubRejected: "GitHub rejected the saved sign-in. Sign in again.",
    scopesMissingRepo:
      "This sign-in cannot push to repositories: it needs the repo or public_repo permission.",
    scopesMissingWorkflow:
      "Pull requests that change GitHub Actions workflows cannot be pushed without the workflow permission.",
    scopesUnknown:
      "This kind of token does not report its permissions, so they are not checked.",
    sandboxReady: "Available: Claude Code agents that edit files run in the sandbox.",
    sandboxMissing:
      "Not available: install bubblewrap and socat so Claude Code agents can edit files in a sandbox.",
    sandboxBlocked:
      "Not available: bubblewrap is installed but cannot start a sandbox here, as in a container with default security settings.",
    sandboxUnsupported:
      "Not available on this platform, so Claude Code agents cannot edit files.",
    sandboxAllowed:
      "Not available. Claude Code agents may edit files without it because you allowed that; such runs are marked.",
    providersReady: ({ providers }: { providers: string[] }) =>
      `Ready: ${fmt.list(providers)}.`,
    noProvider:
      `Install and sign in to the Codex CLI or Claude Code: ${product.name} needs at least one.`,
    savedProviderNotReady: ({ provider }: { provider: string }) =>
      `${provider} is chosen in the model settings but is not ready.`,
    /** Codex when the release switch `codexEnabled` is false. Not a failure. */
    codexDisabled: "Disabled. Codex is turned off in this build.",
    /** Only Codex is installed, and the release switch leaves it off. */
    claudeOnlyRelease: "Claude Code only in 1.0.0; Codex support is disabled",
    installClaudeCode: "Please install Claude Code.",
    dataDirReady: ({ free }: { free: number }) => `Writable, ${size(free)} free.`,
    dataDirWritable: "Writable.",
    dataDirNew: "Will be created at the first start.",
    dataDirLowSpace: ({ free }: { free: number }) =>
      `Writable, but only ${size(free)} free. Runs need room for a copy of each project.`,
    dataDirReadOnly: `Not writable: ${product.name} cannot save its data here.`,
    /** The app check's detail; the version is shown beside it. Empty when nothing is known. */
    app: ({
      port,
      runs,
      processes,
    }: {
      port?: number;
      runs?: number;
      processes?: number;
    }) => {
      const parts = [
        port === undefined ? undefined : `Port ${port}`,
        runs === undefined
          ? undefined
          : fmt.plural(runs) === "one"
            ? `${runs} run at a time`
            : `${runs} runs at a time`,
        processes === undefined
          ? undefined
          : fmt.plural(processes) === "one"
            ? `${processes} agent process`
            : `${processes} agent processes`,
      ].filter(Boolean);
      return parts.length ? `${parts.join(", ")}.` : "";
    },
    windows: `Windows runs ${product.name} through WSL2: install it inside a WSL2 distribution.`,
  },
  /** `bell-pr doctor` on the command line. */
  cli: {
    title: `${product.name} environment check`,
    ready: "Ready: every required check passed.",
    /** Ready, but checks that are not required failed: the steps that need them will not work. */
    readyExcept: ({ checks }: { checks: string[] }) =>
      fmt.plural(checks.length) === "one"
        ? `Ready: every required check passed. Some steps need the check marked ✗ fixed first (${checks[0]}).`
        : `Ready: every required check passed. Some steps need the checks marked ✗ fixed first (${fmt.list(checks)}).`,
    notReady: ({ checks }: { checks: string[] }) =>
      fmt.plural(checks.length) === "one"
        ? `Not ready: fix the required check marked ✗ (${checks[0]}), then run the check again.`
        : `Not ready: fix the required checks marked ✗ (${fmt.list(checks)}), then run the check again.`,
    dataDir: ({ path }: { path: string }) => `Data directory: ${path}`,
    /** The line above a fix command. */
    fix: ({ label }: { label: string }) => `${label}:`,
    usage: `Usage: ${product.binNames[0]} doctor [--json] [--data-dir <dir>]`,
    unknownArgument: ({ argument }: { argument: string }) =>
      `Unknown argument "${argument}".`,
  },
};
