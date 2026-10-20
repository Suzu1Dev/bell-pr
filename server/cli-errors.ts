/**
 * Turns the failures of the tools BELL PR runs (git, gh, codex, claude)
 * into errors with a stable code and the commands that fix them: a tool
 * that is not installed, a sign-in that is missing or rejected, a Git
 * identity that is not set, or a GitHub token without the `workflow`
 * permission.
 *
 * Failures are recognized by their structure only: the spawn error's
 * `cause.code`, and the raw stderr of the tool that command() attaches as
 * `details.stderr`. BELL's own (translated) message text is never matched.
 */
import path from "node:path";
import type { ErrorCode, Fix } from "../shared/errors.js";
import { agentProviders, type AgentProvider } from "../shared/models.js";
import { sm } from "./i18n/index.js";
import { AppError, type AppErrorOptions } from "./types.js";

/** The tools whose failures have a setup fix. */
type Tool = "git" | "gh" | AgentProvider;

/** Codes for a tool that cannot be found. */
const missingCodes: Record<Tool, ErrorCode> = {
  git: "git_missing",
  gh: "gh_missing",
  codex: "codex_missing",
  claude: "claude_missing",
};

/** The error codes this module gives fixes and messages for. */
export type SetupErrorCode =
  | "git_missing"
  | "gh_missing"
  | "codex_missing"
  | "claude_missing"
  | "gh_unauthenticated"
  | "github_auth_required"
  | "git_identity_missing"
  | "gh_workflow_scope"
  | "codex_unauthenticated"
  | "claude_unauthenticated"
  | "clone_timeout";

/** The tool an executable (a name or a path, also with .exe/.cmd) is. */
function toolOf(executable: string): Tool | undefined {
  const name = path
    .basename(executable)
    .replace(/\.(?:exe|cmd|bat)$/i, "")
    .toLowerCase();
  return name === "git" || name === "gh" || (agentProviders as readonly string[]).includes(name)
    ? (name as Tool)
    : undefined;
}

function errnoCode(value: unknown): string | undefined {
  const code = (value as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/** The raw stderr tail that command() attaches to a failed run. */
function stderrOf(error: unknown): string {
  const stderr = error instanceof AppError ? error.details?.stderr : undefined;
  return typeof stderr === "string" ? stderr : "";
}

/** The code for a failure, from the spawn error or the tool's own output. */
function classify(error: Error, tool: Tool): SetupErrorCode | undefined {
  if (
    errnoCode((error as { cause?: unknown }).cause) === "ENOENT" ||
    errnoCode(error) === "ENOENT"
  )
    return missingCodes[tool] as SetupErrorCode;
  const stderr = stderrOf(error);
  if (!stderr) return undefined;
  switch (tool) {
    case "gh":
      return /gh auth login|HTTP 401/.test(stderr)
        ? "gh_unauthenticated"
        : undefined;
    case "git":
      if (/(?:Author|Committer) identity unknown/.test(stderr))
        return "git_identity_missing";
      if (/without `workflow` scope/.test(stderr)) return "gh_workflow_scope";
      if (/could not read Username/.test(stderr)) return "github_auth_required";
      return undefined;
    case "claude":
      return /Please run \/login|Invalid API key/i.test(stderr)
        ? "claude_unauthenticated"
        : undefined;
    case "codex":
      return /\b401\b|Unauthorized/.test(stderr)
        ? "codex_unauthenticated"
        : undefined;
  }
}

/** Keeps the fixes for `platform`; a fix without a platform fits every one. */
export function fixesFor(
  fixes: Fix[],
  platform: NodeJS.Platform | string = process.platform,
): Fix[] {
  return fixes.filter((fix) => !fix.platform || fix.platform === platform);
}

/** Installing a tool, per platform where the command differs. */
export function installFixes(tool: Tool): Fix[] {
  const f = sm().setup.fixes;
  switch (tool) {
    case "git":
      return [
        { label: f.installGit, command: "xcode-select --install", platform: "darwin" },
        { label: f.installGit, command: "sudo apt install git", platform: "linux" },
        { label: f.useWsl, command: "wsl --install", platform: "win32" },
      ];
    case "gh":
      return [
        { label: f.installGh, command: "brew install gh", platform: "darwin" },
        { label: f.installGh, command: "sudo apt install gh", platform: "linux" },
        { label: f.installGh, command: "winget install --id GitHub.cli", platform: "win32" },
      ];
    case "codex":
      return [{ label: f.installCodex, command: "npm install -g @openai/codex" }];
    case "claude":
      return [
        {
          label: f.installClaude,
          command: "npm install -g @anthropic-ai/claude-code",
        },
      ];
  }
}

/** Signing a tool in. */
export function signInFixes(tool: Exclude<Tool, "git">): Fix[] {
  const f = sm().setup.fixes;
  switch (tool) {
    case "gh":
      return [{ label: f.signInGh, command: "gh auth login" }];
    case "codex":
      return [{ label: f.signInCodex, command: "codex login" }];
    case "claude":
      return [{ label: f.signInClaude, command: "claude auth login" }];
  }
}

/** The GitHub no-reply e-mail address of an account, when its id and login are known. */
export function noreplyAddress(github?: { id?: string; login?: string }) {
  return github?.id && github.login
    ? `${github.id}+${github.login}@users.noreply.github.com`
    : undefined;
}

/**
 * Setting the Git identity. With the GitHub account's id and login, the
 * e-mail fix offers GitHub's no-reply address, which keeps a personal
 * address out of published commits.
 */
export function identityFixes(
  github?: { id?: string; login?: string },
  options: { name?: boolean } = {},
): Fix[] {
  const f = sm().setup.fixes;
  const placeholders = sm().setup.placeholders;
  const noreply = noreplyAddress(github);
  return [
    ...(options.name === false
      ? []
      : [
          {
            label: f.setGitName,
            command: `git config --global user.name "${placeholders.name}"`,
          },
        ]),
    noreply
      ? {
          label: f.setNoreplyEmail,
          command: `git config --global user.email "${noreply}"`,
        }
      : {
          label: f.setGitEmail,
          command: `git config --global user.email "${placeholders.email}"`,
        },
  ];
}

/** The fixes for a setup error code. */
export function setupFixes(
  code: SetupErrorCode,
  params: { url?: string } = {},
): Fix[] {
  const f = sm().setup.fixes;
  switch (code) {
    case "git_missing":
      return fixesFor(installFixes("git"));
    case "gh_missing":
      return fixesFor([...installFixes("gh"), ...signInFixes("gh")]);
    case "codex_missing":
      return [...installFixes("codex"), ...signInFixes("codex")];
    case "claude_missing":
      return [...installFixes("claude"), ...signInFixes("claude")];
    case "gh_unauthenticated":
    case "github_auth_required":
      return signInFixes("gh");
    case "codex_unauthenticated":
      return signInFixes("codex");
    case "claude_unauthenticated":
      return signInFixes("claude");
    case "git_identity_missing":
      return identityFixes();
    case "gh_workflow_scope":
      return [
        {
          label: f.addWorkflowScope,
          command: "gh auth refresh -h github.com -s workflow",
        },
      ];
    case "clone_timeout":
      return [
        {
          label: f.cloneLocally,
          command: `git clone ${params.url ? `${params.url}.git` : "<url>"}`,
        },
      ];
  }
}

/** The message for a setup error code, in the locale in effect. */
function setupMessage(code: SetupErrorCode): string {
  const e = sm().setup.errors;
  const messages: Record<SetupErrorCode, string> = {
    git_missing: e.gitMissing,
    gh_missing: e.ghMissing,
    codex_missing: e.codexMissing,
    claude_missing: e.claudeMissing,
    gh_unauthenticated: e.ghUnauthenticated,
    github_auth_required: e.githubAuthRequired,
    git_identity_missing: e.gitIdentityMissing,
    gh_workflow_scope: e.ghWorkflowScope,
    codex_unauthenticated: e.codexUnauthenticated,
    claude_unauthenticated: e.claudeUnauthenticated,
    clone_timeout: e.cloneTimeout,
  };
  return messages[code];
}

/**
 * An AppError for a setup problem: the message in the locale in effect,
 * the code, and the fixes (unless `options.fixes` replaces them).
 */
export function setupError(
  code: SetupErrorCode,
  statusCode = 503,
  options: Omit<AppErrorOptions, "code"> & { url?: string } = {},
): AppError {
  const { url, ...rest } = options;
  return new AppError(setupMessage(code), statusCode, {
    ...rest,
    code,
    fixes: rest.fixes ?? setupFixes(code, { url }),
  });
}

/**
 * Returns `error` with a setup code and fixes when it is a known failure of
 * `executable` (git, gh, codex or claude); anything else, and an error that
 * already has a code, is returned unchanged. The original error is kept as
 * the cause, and its status and details (the redacted stderr tail and the
 * exit code) stay.
 */
export function withCliSetupHint(error: unknown, executable: string): unknown {
  if (!(error instanceof Error)) return error;
  if (error instanceof AppError && error.code) return error;
  const tool = toolOf(executable);
  if (!tool) return error;
  const code = classify(error, tool);
  if (!code) return error;
  return setupError(code, error instanceof AppError ? error.statusCode : 503, {
    cause: error,
    ...(error instanceof AppError && error.details
      ? { details: error.details }
      : {}),
  });
}
