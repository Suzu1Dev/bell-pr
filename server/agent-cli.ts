import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expandHome, sharedCredentialDenials } from "../shared/credential-denials.js";
import { physicalPath } from "../shared/physical-path.js";
import { codexEnabled, startsCodex } from "../shared/codex-switch.js";
export { setCodexEnabledForTests } from "../shared/codex-switch.js";
import {
  providerLabels,
  type AgentProvider,
  type ModelExecution,
} from "../shared/models.js";
import { formatters } from "../shared/i18n/locale.js";
import { modelArguments, modelExecutionSchema, modelId } from "./models.js";
import { AppError } from "./types.js";
import { redact } from "./secrets.js";
import { exitStatusCanHideFailure } from "./exit-status.js";
import { git } from "./process.js";
import {
  agentGitWriteDenials,
  agentReadDenials,
  agentSandboxReadPaths,
  antigravityCloneGitRead,
  antigravityGitWriteDenials,
  antigravityReadDenials,
  assertNoAntigravityWorkspaceConfig,
  enforceAgentSandbox,
  inside,
} from "./sandbox.js";
import { cancelled, currentLocale, sm } from "./i18n/index.js";
import { antigravityTurnNote } from "./prompts/setup.js";

/** none: answer from the prompt only; read: inspect files; write: edit the working directory and run commands. */
export type AgentAccess = "none" | "read" | "write";

export interface AgentCommandOptions {
  /** Codex receives it as -C; Claude Code and Antigravity use the spawned process cwd, so callers must also pass it to command(). */
  cwd: string;
  access: AgentAccess;
  /** JSON Schema file the final answer must match. */
  outputSchema?: string;
  /** Codex only: allow a working directory outside a Git repository. */
  skipGitRepoCheck?: boolean;
  /** Web search and page fetching for "read" and "write"; "none" never gets it. */
  web?: boolean;
  /** Write roles only: explicit permission to remove the sandbox and command deny rules. */
  full?: boolean;
}

export const agentLabel = (provider: AgentProvider = "codex") =>
  providerLabels[provider];

/**
 * The pages WebFetch may open when web access is on: GitHub itself, its
 * documentation and raw file contents. Anything else is not pre-approved,
 * so the CLI refuses it (nobody answers a prompt in -p mode).
 */
export const claudeWebFetchDomains = [
  "github.com",
  "docs.github.com",
  "raw.githubusercontent.com",
];

/**
 * Tool flags per access level. Verified against Claude Code 2.1.292 (the
 * settings schema and rule validator in the CLI, without a model call):
 * - `Read(./**)` scopes reading to the working directory. Claude Code checks
 *   Grep and Glob against Read rules ("Read rules cover all file-reading
 *   tools"); `Glob(path)` is reported as never matched, so no Grep or Glob
 *   path rule is added and neither gets an unscoped allow rule.
 * - `WebFetch(domain:…)` allows one host per rule; WebSearch takes no
 *   argument.
 */
function claudeAccess(access: AgentAccess, web: boolean, full: boolean): string[] {
  if (access === "none") return ["--tools", "", "--permission-mode", "dontAsk"];
  const tools =
    access === "read"
      ? ["Read", "Grep", "Glob"]
      : ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];
  const allowed = access === "read" ? ["Read(./**)"] : ["Read(./**)", "Bash"];
  return [
    "--tools",
    [...tools, ...(web ? ["WebSearch", "WebFetch"] : [])].join(","),
    "--allowedTools",
    [
      ...allowed,
      ...(web
        ? [
            "WebSearch",
            ...claudeWebFetchDomains.map((domain) => `WebFetch(domain:${domain})`),
          ]
        : []),
    ].join(" "),
    "--permission-mode",
    access === "read" ? "dontAsk" : full ? "bypassPermissions" : "acceptEdits",
    // acceptEdits approves file edits inside the working directory only.
    // Deny rules win over allow rules: pushing, GitHub CLI and raw downloads stay with BELL's own flow.
    ...(access === "write" && !full
      ? [
          "--disallowedTools",
          "Bash(git push:*)",
          "Bash(gh:*)",
          "Bash(curl:*)",
          "Bash(wget:*)",
        ]
      : []),
  ];
}

/**
 * A path the Codex profile can hold as a quoted TOML key: no quote,
 * backslash, brace or line break. Other paths are left out of the profile.
 */
function codexProfilePath(entry: string): boolean {
  return !/["\\\r\n{}]/.test(entry);
}

/**
 * The shared credential denials as Codex deny entries, leaving out an
 * entry that repeats an earlier one or lies under a denied directory (an
 * entry written with a trailing `/`), as written or at its physical path,
 * and an entry that passes through a symbolic link when another entry
 * names its physical path. `~` is expanded only to compare; entries keep
 * their spelling.
 *
 * Every `X/**` entry (`~/.config/gh/**`, `~/.aws/**`, `~/.ssh/**` and the
 * gh config directory that `GH_CONFIG_DIR` or `XDG_CONFIG_HOME` moves)
 * reaches Codex as the directory `X/`. Codex skips symbolic links when it
 * expands `**`, so a credential file in X that is a link (as dotfile
 * managers and vaults leave them) stayed readable: in every role with
 * 0.159, in read-only roles with 0.166 (its writable roles failed to
 * start instead). The directory form hides it with the rest of X, nested
 * files included, and both roles start. The link's target outside X is
 * still readable at its own path. `~/.ssh/**` then repeats `~/.ssh/` and
 * is left out. Claude Code's Read rules keep `X/**`.
 *
 * On Linux, bubblewrap cannot place a deny inside a directory it has
 * already denied: with `~/.ssh/` and `~/.ssh/**` both listed, any file in
 * `~/.ssh` stopped every command from starting ("Can't create file at
 * …/.ssh/authorized_keys: Read-only file system"), and a `store --file`
 * path inside `~/.ssh` did the same. The directory form stays, because
 * `X/**` alone still lists the names in X and stops at
 * `glob_scan_max_depth`. A deny path that passes through a symbolic link
 * stops the sandbox from starting as well ("Can't create file at
 * <link>/auth.json"), so a config directory that `CODEX_HOME`,
 * `XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR` or `GH_CONFIG_DIR` names through a
 * link reaches Codex at its physical path only, as in 1.0.0; reads through
 * the link are still denied. Claude Code's Read rules keep both forms.
 * Under a symlinked HOME the `~` entries still pass through the link, so
 * that case still fails. Verified with codex-cli 0.159.0 and 0.166.0
 * (`codex sandbox`) on Linux with bubblewrap 0.11.1.
 *
 * Entries the profile cannot hold are taken out before anything is
 * compared, so an entry is only left out for one that reaches the profile.
 * When a link's physical path holds such a character, the linked form
 * stays: the sandbox then fails to start instead of leaving the file
 * readable.
 */
function codexDenials(): string[] {
  const home = process.env.HOME || os.homedir();
  const entries = sharedCredentialDenials()
    .filter(codexProfilePath)
    .map((entry) => (entry.endsWith("/**") ? entry.slice(0, -2) : entry))
    .map((entry) => {
      const target = path.resolve(expandHome(entry, home));
      return {
        entry,
        target,
        physical: physicalPath(target),
        directory: entry.endsWith("/"),
      };
    });
  return entries
    .filter(
      (item, index) =>
        !entries.some(
          (other, at) =>
            (at < index && other.target === item.target) ||
            (item.physical !== item.target && other.target === item.physical) ||
            (other.directory &&
              (inside(item.target, other.target) ||
                inside(item.physical, other.physical))),
        ),
    )
    .map((item) => item.entry);
}

/**
 * Codex permission profile for one turn. `--sandbox` is not passed: on
 * Codex CLI 0.165 it selects the older sandbox, which does not apply
 * `default_permissions`, so the read denials would be ignored.
 * `glob_scan_max_depth` makes a glob deny apply on Linux; the credential
 * directories reach Codex as directories instead (see codexDenials).
 *
 * Filesystem values are only `read`, `write`, or `deny`. `deny` blocks
 * reads and writes. `read` allows reads and forbids writes, including
 * delete and replace. The checkout's `.git` and `.git/**` are `read`,
 * so the file cannot be edited or replaced with a directory, and Git
 * can still read it. Credential paths stay `deny`.
 */
export function codexSandboxConfig(access: AgentAccess, cwd: string): string[] {
  const dotGit = path.join(cwd, ".git");
  const filesystem = [
    "glob_scan_max_depth=4",
    ...codexDenials().map((entry) => `"${entry}"="deny"`),
    ...[dotGit, `${dotGit}/**`]
      .filter(codexProfilePath)
      .map((entry) => `"${entry}"="read"`),
  ].join(", ");
  const parent = access === "write" ? ":workspace" : ":read-only";
  return [
    "-c",
    'default_permissions="bell-pr"',
    "-c",
    `permissions={bell-pr={extends="${parent}", filesystem={${filesystem}}, network={enabled=false}}}`,
  ];
}

/** workspace-write or read-only, from the permission profile BELL passes. */
export function codexAccessMode(
  args: readonly string[],
): "workspace-write" | "read-only" | undefined {
  if (args.includes("--sandbox")) return undefined;
  const table = args.find((arg) => arg.startsWith("permissions={bell-pr="));
  if (!table) return undefined;
  if (table.includes('extends=":workspace"')) return "workspace-write";
  if (table.includes('extends=":read-only"')) return "read-only";
  return undefined;
}

/**
 * The user's own instruction files in Claude Code's config directory, the
 * way the CLI names them (verified with 2.1.292: the path as given matches
 * through a symbolic link too). Claude Code reads these as picomatch globs,
 * so each glob character in the directory, such as the parentheses of
 * `Dropbox (Personal)`, becomes a one-character class like `[(]`. A
 * backslash cannot escape it: Claude Code turns backslashes into `/`.
 */
function claudeUserMemoryFiles(): string[] {
  const directory = path
    .resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"))
    .replace(/[()[\]{}*?!+@|]/g, "[$&]");
  return [path.join(directory, "CLAUDE.md"), path.join(directory, "rules", "**")];
}

/**
 * The Claude Code releases BELL PR supports: `min` or later, before `below`.
 * Doctor warns about another release but does not block it.
 */
export const claudeSupportedVersions = { min: "2.1.292", below: "2.2" } as const;

/**
 * The `--settings` value for one Claude Code turn. Every turn denies
 * reading credential files and BELL's data outside its checkout. Read-only
 * turns also refuse file reads outside the working directory. A write turn
 * with the sandbox runs every Bash command inside it: writes only in the
 * working directory, no reads in BELL's data directory outside its
 * checkout, even of checkouts created during the turn (`filesystem`, see
 * agentSandboxReadPaths), no network, and no way to step outside
 * (`allowUnsandboxedCommands: false`); `failIfUnavailable` stops the turn
 * instead of running unsandboxed if the sandbox cannot start after all.
 *
 * The user's own settings still load (`--setting-sources user`), so sign-in
 * through `env`, `apiKeyHelper` or a cloud provider keeps working. A single
 * value given here wins over the user's; lists, `env` and the proxy ports
 * BELL cannot unset stay theirs. So does `sandbox.ripgrep`: the highest
 * source that sets it owns it whole, and Claude Code's own ripgrep cannot
 * be written here. Plugin language servers have no switch at all
 * (docs/security-model.md names what that leaves). A sandboxed turn
 * therefore sets each single value that would weaken the sandbox back to
 * its default: filesystem isolation stays on
 * (`filesystem.disabled`), /proc is fresh (`enableWeakerNestedSandbox`),
 * Unix sockets stay blocked (`allowAllUnixSockets`), commands cannot create
 * user namespaces of their own, which would let them undo the write denies
 * (`allowNestedUserNamespaces`, Linux, Claude Code 2.1.305 and later), and
 * on macOS there is no local port binding, trustd access or Apple Events.
 * Every turn also turns off what would run or persist outside BELL's
 * control: hooks, which run
 * outside the sandbox (`disableAllHooks`; managed hooks still run), and auto
 * memory under ~/.claude/projects/, also when the user's `env` forces it on
 * (`autoMemoryEnabled`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`). The user's own
 * instructions are left out too: CLAUDE.md and rules (`claudeMdExcludes`),
 * output style, `language`, and a main-thread `agent` from the user's or a
 * plugin's settings, which would replace the system prompt and narrow the
 * tools, StructuredOutput included (`agent: ""` selects none). Managed
 * policy still applies, and so does an output style that a loaded plugin
 * forces (`force-for-plugin`): Claude Code picks it before reading
 * `outputStyle`, and only disabling that plugin stops it.
 *
 * Keys verified against the settings schema bundled in Claude Code 2.1.292
 * (`permissions` and `sandbox` are passthrough objects there, so a key a
 * release does not know is ignored rather than rejected, but one value of
 * the wrong type, such as `sandbox.ripgrep: null`, makes the CLI ignore all
 * of `--settings` without a message);
 * `sandbox.filesystem.denyRead` and `allowRead` are in the schema since
 * 2.1.114 at the latest, and both apply on Linux and macOS. The top-level
 * keys, and that each wins over the user's settings, were verified with
 * 2.1.292 against a local stand-in for the API; so were the Linux sandbox
 * values above, through the arguments the CLI passed to bwrap (the macOS
 * ones only against the schema). `sandbox.allowNestedUserNamespaces` was
 * checked with 2.1.316: its schema, and the bwrap arguments against the
 * stand-in, where `false` here won over a user `true`. 2.1.292 does not know
 * the key and, the sandbox object being passthrough, still applies the rest
 * of `--settings` with it. Supported range: claudeSupportedVersions;
 * scripts/agent-sandbox-canary.mjs must pass on a release before the range
 * is widened.
 */
export function claudeSettings(options: {
  cwd: string;
  access: AgentAccess;
  sandbox: boolean;
  full?: boolean;
}): {
  disableAllHooks: true;
  autoMemoryEnabled: false;
  env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
  outputStyle: "default";
  language: "";
  agent: "";
  claudeMdExcludes: string[];
  permissions: { deny: string[]; blockReadsOutsideWorkingDirectories?: boolean };
  sandbox?: {
    enabled: boolean;
    failIfUnavailable?: boolean;
    autoAllowBashIfSandboxed?: boolean;
    allowUnsandboxedCommands?: boolean;
    enableWeakerNestedSandbox?: false;
    enableWeakerNetworkIsolation?: false;
    allowAppleEvents?: false;
    allowNestedUserNamespaces?: false;
    filesystem?: ReturnType<typeof agentSandboxReadPaths> & {
      denyWrite?: string[];
      disabled?: false;
    };
    network?: {
      allowedDomains: string[];
      strictAllowlist: boolean;
      allowAllUnixSockets?: false;
      allowLocalBinding?: false;
    };
  };
} {
  return {
    disableAllHooks: true,
    autoMemoryEnabled: false,
    env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
    outputStyle: "default",
    language: "",
    agent: "",
    claudeMdExcludes: claudeUserMemoryFiles(),
    permissions: {
      deny: agentReadDenials(options.cwd),
      ...(options.access === "write"
        ? {}
        : { blockReadsOutsideWorkingDirectories: true }),
    },
    ...(options.sandbox
      ? {
          sandbox: {
            enabled: true,
            failIfUnavailable: true,
            autoAllowBashIfSandboxed: true,
            allowUnsandboxedCommands: false,
            enableWeakerNestedSandbox: false,
            enableWeakerNetworkIsolation: false,
            allowAppleEvents: false,
            allowNestedUserNamespaces: false,
            filesystem: {
              ...agentSandboxReadPaths(options.cwd),
              denyWrite: agentGitWriteDenials(options.cwd),
              disabled: false,
            },
            network: {
              allowedDomains: [],
              strictAllowlist: true,
              allowAllUnixSockets: false,
              allowLocalBinding: false,
            },
          },
        }
      : options.full
        ? { sandbox: { enabled: false } }
        : {}),
  };
}

/** Commands a write turn may not run, unless the person allowed full access. */
const deniedWriteCommands = ["git push", "gh", "curl", "wget"];

/**
 * The `--settings` value for one Antigravity CLI turn: settings.json keys
 * for this session only, laid over the person's own (agy 1.5.0 logged the
 * permissions and toolPermission given here as the ones in effect). agy
 * offers every tool to every turn and cannot narrow the list, so each turn
 * denies what its access level does not allow, and deny rules win over the
 * person's allow and ask rules. Every turn denies reading credential files,
 * the Antigravity CLI's own files and BELL's data outside its checkout
 * (antigravityReadDenials), MCP tools and the browser (`execute_url`), and
 * fetching pages unless web access is on, when only GitHub's pages are
 * allowed. Its web search cannot be denied (docs/security-model.md).
 *
 * A read turn also denies writing, terminal commands and the home
 * directory off the way to its checkout; a "none" turn denies reading too. A sandboxed write turn runs its commands in agy's
 * terminal sandbox without asking (`proceed-in-sandbox`); when the sandbox
 * cannot start after all, agy treats that like `request-review`, so its
 * commands are refused instead of running outside it. An unsandboxed write
 * turn, which the person allowed, gets an allow rule for every command
 * instead. Either kind denies pushing, the GitHub CLI and raw downloads,
 * and writing the checkout's Git metadata, unless full access lifts them,
 * and may read the clone's Git directory, which the sandbox mounts only
 * when a rule allows it.
 *
 * Nothing in print mode can answer a permission request, so agy refuses
 * every action that needs one; it then ends the turn without an answer
 * (agy 1.5.0), which the event reader reports as a failure.
 */
export function antigravitySettings(options: {
  cwd: string;
  access: AgentAccess;
  web: boolean;
  sandbox: boolean;
  full?: boolean;
}): {
  toolPermission: "proceed-in-sandbox" | "request-review";
  enableTerminalSandbox: boolean;
  allowNonWorkspaceAccess: false;
  permissions: { allow: string[]; ask: []; deny: string[] };
} {
  const { access, cwd, web, sandbox } = options;
  const full = options.full === true && access === "write";
  const allow: string[] = [];
  const deny = [
    ...antigravityReadDenials(cwd, { outsideCheckout: access === "read" }),
    "execute_url(*)",
    "mcp(*)",
    ...(web && access !== "none" ? [] : ["read_url(*)"]),
  ];
  if (access === "none") deny.push("read_file(*)", "write_file(*)", "command(*)");
  if (access === "read") deny.push("write_file(*)", "command(*)");
  if (access === "write") {
    if (!full)
      deny.push(
        ...deniedWriteCommands.map((name) => `command(${name})`),
        ...antigravityGitWriteDenials(cwd),
      );
    if (!sandbox && !full) allow.push("command(*)");
    const gitRead = antigravityCloneGitRead(cwd);
    if (gitRead) allow.push(gitRead);
  }
  if (web && access !== "none")
    allow.push(...claudeWebFetchDomains.map((domain) => `read_url(${domain})`));
  return {
    toolPermission: access === "write" && sandbox ? "proceed-in-sandbox" : "request-review",
    enableTerminalSandbox: sandbox,
    allowNonWorkspaceAccess: false,
    permissions: { allow, ask: [], deny: [...new Set(deny)] },
  };
}

/**
 * One Antigravity prompt on stdin: in print mode agy takes its prompt as an
 * argument or, with `--input-format stream-json`, as NDJSON lines on stdin.
 * BELL never passes a prompt as an argument, so it sends one `user` event,
 * with the turn's tool note first (antigravityTurnNote).
 */
export function antigravityInput(
  prompt: string,
  access: AgentAccess,
  web: boolean,
  files: string[] = [],
): string {
  const content = `${antigravityTurnNote(access, web, files)}\n\n${prompt}`;
  return `${JSON.stringify({ event: "user", message: { content } })}\n`;
}

/**
 * The files of a read-only Antigravity turn's checkout: tracked ones, and
 * new ones Git does not ignore, such as a teammate's. agy 1.5.0 gives its
 * print-mode agent no tool to list a folder or search text (its model
 * named read_file, write_file, edit_file, run_command and the subagent
 * tools as all it had), and such a turn may run no command, so the paths
 * are the way it finds what to read. Empty outside a repository.
 */
async function antigravityTrackedFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      timeoutMs: 15_000,
      maxBytes: 8_000_000,
    });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/** How to start one agent CLI turn. */
export interface AgentCommand {
  executable: string;
  args: string[];
  /**
   * True when a write-role Claude or Antigravity agent runs without the OS
   * sandbox because the person allowed it; runAgent records it on the run
   * (run.unsandboxed) with one notice line.
   */
  unsandboxed?: boolean;
  /** What to write to stdin for a prompt; absent means the prompt as it is. */
  stdin?: (prompt: string) => string;
}

/**
 * The prompt is always written to stdin (through `stdin` when the result
 * has one); a shell is never used. A write-role Claude or Antigravity agent
 * needs the OS sandbox (see sandbox.ts): without it this throws 503
 * `claude_sandbox_unavailable` or `antigravity_sandbox_unavailable`, unless
 * the person allowed unsandboxed agents, which the result reports as
 * `unsandboxed: true`. An Antigravity turn is refused with 422
 * `antigravity_workspace_config` in a folder whose customizations agy
 * would load.
 */
export async function agentCommand(
  execution: ModelExecution,
  options: AgentCommandOptions,
): Promise<AgentCommand> {
  // Omitted provider means Codex. While the switch is off, it does not start.
  if (!codexEnabled && startsCodex(execution.provider))
    throw new AppError((m) => m.setup.doctor.codexDisabled, 422);
  const full = (options.full ?? execution.agentAccess === "full") && options.access === "write";
  const web = options.web === true && options.access !== "none";
  if (execution.provider === "antigravity") {
    assertNoAntigravityWorkspaceConfig(options.cwd);
    const value = modelExecutionSchema.parse(execution);
    const files = options.access === "read" ? await antigravityTrackedFiles(options.cwd) : [];
    const { sandbox, unsandboxed } = full
      ? { sandbox: false, unsandboxed: true }
      : await enforceAgentSandbox("antigravity", options.access);
    return {
      executable: "agy",
      args: [
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        // A prompt that starts with / stays a prompt, and skills are not expanded.
        "--disable-slash-commands",
        // Never the person's default `auto` mode, whose reviewer may run a command outside the sandbox.
        "--mode",
        "accept-edits",
        ...(sandbox ? ["--sandbox"] : []),
        ...(full ? ["--dangerously-skip-permissions"] : []),
        "--settings",
        JSON.stringify(
          antigravitySettings({ cwd: options.cwd, access: options.access, web, sandbox, full }),
        ),
        // agy's model IDs name their thinking level, so no --effort is passed.
        ...(value.model ? ["--model", value.model] : []),
        ...(options.outputSchema
          ? ["--json-schema", await readFile(options.outputSchema, "utf8")]
          : []),
      ],
      stdin: (prompt) => antigravityInput(prompt, options.access, web, files),
      ...(unsandboxed ? { unsandboxed: true } : {}),
    };
  }
  if (execution.provider === "claude") {
    const value = modelExecutionSchema.parse(execution);
    const { sandbox, unsandboxed } = full
      ? { sandbox: false, unsandboxed: true }
      : await enforceAgentSandbox("claude", options.access);
    return {
      executable: "claude",
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        // Keeps the user's claude.ai connectors and MCP servers away from agents reading untrusted content.
        "--strict-mcp-config",
        // -p shows no trust dialog, so the imported repository's .claude settings, hooks and memory must not load.
        "--setting-sources",
        "user",
        "--settings",
        JSON.stringify(
          claudeSettings({ cwd: options.cwd, access: options.access, sandbox, full }),
        ),
        ...(value.model ? ["--model", value.model] : []),
        ...(value.reasoningEffort ? ["--effort", value.reasoningEffort] : []),
        ...claudeAccess(options.access, web, full),
        ...(options.outputSchema
          ? ["--json-schema", await readFile(options.outputSchema, "utf8")]
          : []),
      ],
      ...(unsandboxed ? { unsandboxed: true } : {}),
    };
  }
  return {
    executable: "codex",
    args: [
      "exec",
      "--ignore-user-config",
      // The target repository's execpolicy .rules files and its AGENTS.md
      // (project docs) are never loaded as instructions; verified with
      // `codex exec --help` and the config keys of codex-cli 0.159.
      "--ignore-rules",
      "-c",
      "project_doc_max_bytes=0",
      "--ephemeral",
      ...modelArguments(execution),
      ...(full
        ? ["--sandbox", "danger-full-access"]
        : codexSandboxConfig(options.access, options.cwd)),
      "-c",
      'approval_policy="never"',
      // Codex 0.159 `exec` has no --search flag; live search is a config override.
      ...(web ? ["-c", 'web_search="live"'] : []),
      ...(options.skipGitRepoCheck ? ["--skip-git-repo-check"] : []),
      "--json",
      "--color",
      "never",
      ...(options.outputSchema ? ["--output-schema", options.outputSchema] : []),
      "-C",
      options.cwd,
      "-",
    ],
  };
}

/**
 * Exits successfully only when the CLI is installed and signed in. agy has
 * no status command; listing its models needs a sign-in (agy 1.5.0 exits 1
 * with "Please sign in to view available models." without one) and starts
 * no model turn.
 */
export function agentLoginCheck(provider: AgentProvider = "codex") {
  if (provider === "antigravity") return { executable: "agy", args: ["models"] };
  return provider === "claude"
    ? { executable: "claude", args: ["auth", "status"] }
    : { executable: "codex", args: ["login", "status"] };
}

export type AgentEvent =
  /** Agent text; the last one is the answer unless a final event follows. */
  | { kind: "message"; text: string }
  /** Claude Code's or Antigravity's terminal answer, including validated structured output. */
  | { kind: "final"; text: string }
  /** command is the first line the agent ran, redacted and cut to 300 characters; absent when the CLI gave none. */
  | { kind: "command"; outcome: string; command?: string }
  /** path is as the CLI reported it (Claude Code: absolute); the integrated paths come from the diff, not from here. */
  | { kind: "file-change"; path?: string }
  /** Recoverable waiting or denial the user should see now; never a failure by itself. */
  | { kind: "notice"; message: string }
  /** detail is the search query or the fetched URL, redacted and cut to 200 characters. */
  | { kind: "web"; action: "search" | "fetch"; detail: string }
  /** Claude Code's system/init (the resolved model and the CLI version) or Antigravity's init (the model BELL asked for). */
  | { kind: "session"; model: string; cliVersion?: string }
  /** Model IDs present in result.modelUsage; the first entry is not necessarily the main model. */
  | { kind: "usage-by-model"; models: string[] }
  /** retryable: the invocation lost Claude Code's OAuth refresh lock to another process; a rerun usually succeeds. */
  | { kind: "error"; message: string; terminal: boolean; retryable?: boolean };

/** Claude Code reports this when another process holds ~/.claude/.oauth_refresh.lock while the token is expired. */
const oauthRefreshRace = /Failed to refresh OAuth token/;

type Json = Record<string, any>;
const blocks = (event: Json): Json[] =>
  Array.isArray(event.message?.content)
    ? event.message.content.filter(
        (block: unknown) => !!block && typeof block === "object",
      )
    : [];
const isModelId = (value: unknown): value is string =>
  typeof value === "string" && modelId.safeParse(value).success;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * A command or path for the log: first line only, credential shapes masked,
 * at most 300 characters. redact() does not know flag forms such as
 * `--token xyz`, which is why continuation lines are dropped rather than kept.
 */
function summarize(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const line = redact(value).split(/\r?\n/, 1)[0].trim();
  return line ? line.slice(0, 300) : undefined;
}
const withField = <K extends string>(key: K, value: string | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, string>);

/** A search query or URL for the log; absent when the CLI gave none. */
function webEvent(
  action: "search" | "fetch",
  detail: unknown,
): AgentEvent[] {
  const text = summarize(detail);
  return text ? [{ kind: "web", action, detail: text.slice(0, 200) }] : [];
}

/** Explains a non-allowed rate_limit_event in one line; a plain "allowed" status is normal and stays silent. */
function rateLimitNotice(info: unknown): string | undefined {
  if (!info || typeof info !== "object") return;
  const value = info as Json;
  if (typeof value.status !== "string" || value.status === "allowed") return;
  const messages = sm().run.agentCli;
  const windows: Record<string, string> = messages.rateLimitWindows;
  const type = value.rateLimitType;
  return messages.rateLimit({
    status: value.status,
    window:
      typeof type === "string"
        ? Object.hasOwn(windows, type)
          ? windows[type]
          : type
        : undefined,
    used: finite(value.utilization)
      ? Math.round(value.utilization * 100)
      : undefined,
    // resetsAt is Unix time in seconds (observed 1791439800 for a same-day reset).
    resetsAt: finite(value.resetsAt)
      ? formatters(currentLocale()).dateTime(value.resetsAt * 1000)
      : undefined,
  });
}

/** Tool denials from the permission settings; tool_input is never logged. */
function denialNotice(denial: unknown): AgentEvent | undefined {
  if (!denial || typeof denial !== "object") return;
  const value = denial as Json;
  if (typeof value.tool_name !== "string" || !value.tool_name) return;
  const reason =
    typeof value.decision_reason === "string" && value.decision_reason
      ? value.decision_reason
      : typeof value.message === "string" && value.message
        ? value.message
        : "";
  return {
    kind: "notice",
    message: sm().run.agentCli.deniedTool({
      tool: value.tool_name,
      reason: reason || undefined,
    }),
  };
}

function systemNotice(value: Json): AgentEvent[] {
  if (value.subtype === "api_retry") {
    const attempt = finite(value.attempt) ? value.attempt : undefined;
    return [
      {
        kind: "notice",
        message: sm().run.agentCli.apiRetry({
          attempt,
          maxRetries:
            attempt !== undefined && finite(value.max_retries)
              ? value.max_retries
              : undefined,
          reason:
            typeof value.error === "string" && value.error
              ? value.error
              : undefined,
          delaySeconds: finite(value.retry_delay_ms)
            ? Math.max(0, Math.round(value.retry_delay_ms / 1000))
            : undefined,
        }),
      },
    ];
  }
  if (value.subtype === "permission_denied") {
    const notice = denialNotice(value);
    return notice ? [notice] : [];
  }
  return [];
}

/** agy's tools that edit files, as its step updates name them (write_file and edit_file seen with 1.5.0). */
const antigravityEditTools = new Set([
  "write_file",
  "edit_file",
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
  "sed_file",
  "notebook_edit",
]);

/** agy's own words for an action that no rule allowed or a rule denied (1.5.0). */
const antigravityDenial = /permission check failed|denied permission/i;

/** The first string among a tool's parameters under one of `keys`. */
function parameter(parameters: unknown, keys: string[]): unknown {
  if (!parameters || typeof parameters !== "object") return undefined;
  const value = parameters as Json;
  return keys.map((key) => value[key]).find((item) => typeof item === "string");
}

/**
 * The Antigravity CLI's stream-json events (agy 1.5.0): `init`, then
 * `step_update` for each step and `result` at the end. A command's outcome
 * is the exit code agy puts first in its output ("Command exited with code
 * 1."); nothing else of a tool's output is read. Text arrives as
 * `text_delta` and is returned when its step is done. The result repeats
 * the last text as the answer; a final answer with the same content keeps
 * that text, so it is logged once. A denied action fails its step and is
 * listed again in the result, which adds a notice only when no step
 * showed it; a result without an answer after a denial is a failure, even
 * when text came before the denial.
 */
function antigravityEventReader() {
  const texts = new Map<unknown, string>();
  let last: string | undefined;
  let stepDenials = 0;
  const finished = (text: string | undefined): AgentEvent[] => {
    const trimmed = text?.trim();
    if (!trimmed) return [];
    last = trimmed;
    return [{ kind: "message", text: trimmed }];
  };
  return (value: Json): AgentEvent[] => {
    if (value.event === "init") {
      const model = value.init?.model;
      return isModelId(model) ? [{ kind: "session", model }] : [];
    }
    if (value.event === "step_update") {
      const step = value.step_update;
      if (!step || typeof step !== "object") return [];
      if (typeof step.text_delta === "string" && step.text_delta)
        texts.set(step.step_index, (texts.get(step.step_index) ?? "") + step.text_delta);
      if (step.state !== "DONE" && step.state !== "ERROR") return [];
      const events = finished(texts.get(step.step_index));
      texts.delete(step.step_index);
      if (step.step_type !== "tool") return events;
      const name = String(step.tool_name ?? step.tool_info?.name ?? "");
      const info = step.tool_info && typeof step.tool_info === "object" ? step.tool_info : {};
      const failure =
        step.state === "ERROR"
          ? String(info.error?.message ?? sm().run.agentCli.commandFailed)
          : undefined;
      if (failure && antigravityDenial.test(failure)) {
        stepDenials += 1;
        events.push({
          kind: "notice",
          message: sm().run.agentCli.deniedTool({ tool: name, reason: summarize(failure) }),
        });
        return events;
      }
      if (name === "run_command") {
        const command = parameter(info.parameters, ["CommandLine", "command"]);
        const exit = /^Command exited with code (-?\d+)\./.exec(
          typeof info.output === "string" ? info.output : "",
        )?.[1];
        events.push({
          kind: "command",
          outcome: failure
            ? sm().run.agentCli.commandFailed
            : exit === undefined
              ? sm().run.agentCli.commandUnreported
              : exit === "0" && typeof command === "string" && exitStatusCanHideFailure(command)
                ? sm().run.agentCli.commandUnverified({ outcome: "exit 0" })
                : `exit ${exit}`,
          ...withField("command", summarize(command)),
        });
      } else if (antigravityEditTools.has(name) && !failure) {
        events.push({
          kind: "file-change",
          ...withField("path", summarize(parameter(info.parameters, ["Path", "TargetFile", "AbsolutePath", "path"]))),
        });
      } else if (name === "search_web") {
        events.push(...webEvent("search", parameter(info.parameters, ["query", "Query"])));
      } else if (name === "read_url" || name === "read_url_content") {
        events.push(...webEvent("fetch", parameter(info.parameters, ["Url", "url", "URL"])));
      }
      return events;
    }
    if (value.event === "result") {
      const result = value.result && typeof value.result === "object" ? value.result : {};
      const denied: Json[] = (Array.isArray(result.denied_actions) ? result.denied_actions : [])
        .filter((item: unknown): item is Json => !!item && typeof item === "object")
        .slice(0, 20);
      const events: AgentEvent[] = stepDenials
        ? []
        : denied.flatMap((item) => {
            const tool = item.display_name || item.action;
            return typeof tool === "string" && tool
              ? [{ kind: "notice" as const, message: sm().run.agentCli.deniedTool({ tool }) }]
              : [];
          });
      for (const text of texts.values()) events.push(...finished(text));
      texts.clear();
      if (result.status !== "SUCCESS") {
        events.push({
          kind: "error",
          terminal: true,
          message:
            typeof result.error === "string" && result.error
              ? result.error
              : sm().run.agentCli.antigravityTurnFailed({ status: String(result.status ?? "unknown") }),
        });
        return events;
      }
      const response = String(result.response ?? "").trim();
      const text =
        result.structured_output == null
          ? response
          : response && response === last
            ? last
            : JSON.stringify(result.structured_output);
      if (text) events.push({ kind: "final", text });
      // Text written before the denial is not the answer.
      else if (denied.length || stepDenials)
        events.push({
          kind: "error",
          terminal: true,
          message: sm().run.agentCli.antigravityEndedOnDenial,
        });
      return events;
    }
    return [];
  };
}

/**
 * Maps one parsed JSONL event to the documented events BELL uses. Command
 * strings and edited paths are kept (summarized); raw tool output, Codex
 * aggregated_output and tool_result content are never returned.
 */
export function agentEventReader(provider: AgentProvider = "codex") {
  const antigravity = provider === "antigravity" ? antigravityEventReader() : undefined;
  // Claude Code reports a tool's input on tool_use and its outcome on a later tool_result, keyed by id.
  const tools = new Map<
    string,
    { name: string; summary?: string; hidesFailure?: boolean }
  >();
  return (event: unknown): AgentEvent[] => {
    if (!event || typeof event !== "object") return [];
    const value = event as Json;
    if (antigravity) return antigravity(value);
    if (provider === "codex") {
      const item = value.item;
      if (value.type === "item.completed" && item?.type === "agent_message")
        return [{ kind: "message", text: String(item.text ?? "") }];
      if (value.type === "item.completed" && item?.type === "command_execution")
        return [
          {
            kind: "command",
            outcome:
              item.exit_code === 0 &&
              typeof item.command === "string" &&
              exitStatusCanHideFailure(item.command)
                ? sm().run.agentCli.commandUnverified({ outcome: "exit 0" })
                : `exit ${item.exit_code ?? "?"}`,
            ...withField("command", summarize(item.command)),
          },
        ];
      if (value.type === "item.completed" && item?.type === "file_change") {
        const paths = (Array.isArray(item.changes) ? item.changes : [])
          .slice(0, 20)
          .map((change: Json) => summarize(change?.path))
          .filter((path: string | undefined): path is string => !!path);
        return paths.length
          ? paths.map((path: string) => ({ kind: "file-change", path }))
          : [{ kind: "file-change" }];
      }
      if (value.type === "item.completed" && item?.type === "web_search") {
        // Codex 0.159: item.query may be empty; the action then carries the query (observed as a
        // string in action.query, documented as action.queries). Results are never read.
        const action = item.action && typeof item.action === "object" ? item.action : {};
        const queries = (
          Array.isArray(action.queries) ? action.queries : [action.query]
        ).filter((query: unknown) => typeof query === "string" && query);
        return webEvent("search", item.query || queries.join(" / "));
      }
      if (value.type === "error" || value.type === "turn.failed") {
        const terminal = value.type === "turn.failed";
        return [
          {
            kind: "error",
            terminal,
            message: String(
              value.message ??
                value.error?.message ??
                (terminal
                  ? sm().run.agentCli.codexTurnFailed
                  : sm().run.agentCli.codexError),
            ),
          },
        ];
      }
      return [];
    }
    if (value.type === "system") {
      if (value.subtype === "init" && isModelId(value.model))
        return [
          {
            kind: "session",
            model: value.model,
            ...(typeof value.claude_code_version === "string" &&
            value.claude_code_version
              ? { cliVersion: value.claude_code_version.slice(0, 100) }
              : {}),
          },
        ];
      return systemNotice(value);
    }
    if (value.type === "rate_limit_event") {
      const message = rateLimitNotice(value.rate_limit_info);
      return message ? [{ kind: "notice", message }] : [];
    }
    if (value.type === "assistant") {
      const events: AgentEvent[] = [];
      for (const block of blocks(value)) {
        if (block.type === "text" && block.text)
          events.push({ kind: "message", text: String(block.text) });
        if (block.type === "tool_use" && typeof block.id === "string") {
          const name = String(block.name);
          const input = block.input && typeof block.input === "object" ? block.input : {};
          // Web tools are logged when requested: their tool_result holds page content, which is never read.
          if (name === "WebSearch") events.push(...webEvent("search", input.query));
          if (name === "WebFetch") events.push(...webEvent("fetch", input.url));
          tools.set(block.id, {
            name,
            summary: summarize(
              name === "Bash"
                ? input.command
                : name === "Edit" || name === "Write"
                  ? input.file_path
                  : undefined,
            ),
            // The whole command, not only the summarized first line, decides.
            hidesFailure:
              name === "Bash" &&
              typeof input.command === "string" &&
              exitStatusCanHideFailure(input.command),
          });
        }
      }
      return events;
    }
    if (value.type === "user") {
      const events: AgentEvent[] = [];
      for (const block of blocks(value)) {
        if (block.type !== "tool_result") continue;
        const tool = tools.get(block.tool_use_id);
        if (tool?.name === "Bash")
          events.push({
            kind: "command",
            outcome: block.is_error
              ? sm().run.agentCli.commandFailed
              : tool.hidesFailure
                ? sm().run.agentCli.commandUnverified({
                    outcome: sm().run.agentCli.commandSucceeded,
                  })
                : sm().run.agentCli.commandSucceeded,
            ...withField("command", tool.summary),
          });
        else if (
          (tool?.name === "Edit" || tool?.name === "Write") &&
          !block.is_error
        )
          events.push({ kind: "file-change", ...withField("path", tool.summary) });
      }
      return events;
    }
    if (value.type === "result") {
      // Denials are listed on the result even when the turn succeeded; log them before the outcome.
      const events: AgentEvent[] = (
        Array.isArray(value.permission_denials) ? value.permission_denials : []
      )
        .slice(0, 20)
        .map(denialNotice)
        .filter((item): item is AgentEvent => !!item);
      if (value.is_error || value.subtype !== "success") {
        const detail =
          typeof value.result === "string" && value.result
            ? value.result
            : Array.isArray(value.errors)
              ? formatters(currentLocale()).list(value.errors.map(String), {
                  type: "unit",
                })
              : "";
        const retryable =
          (value.is_error === true || value.terminal_reason === "api_error") &&
          oauthRefreshRace.test(detail);
        events.push({
          kind: "error",
          terminal: true,
          message:
            detail ||
            sm().run.agentCli.claudeTurnFailed({
              subtype: String(value.subtype ?? "unknown"),
            }),
          ...(retryable ? { retryable: true } : {}),
        });
        return events;
      }
      const models =
        value.modelUsage && typeof value.modelUsage === "object"
          ? Object.keys(value.modelUsage).filter(isModelId).slice(0, 20)
          : [];
      if (models.length) events.push({ kind: "usage-by-model", models });
      const text =
        value.structured_output !== undefined
          ? JSON.stringify(value.structured_output)
          : String(value.result ?? "");
      if (text) events.push({ kind: "final", text });
      return events;
    }
    return [];
  };
}

/**
 * Records what Claude Code or Antigravity reported into execution.reported. Returns true when the main
 * model is new, so callers log it once. modelsUsed is a union: a second model is more
 * likely a Claude Code helper call than a fallback, since BELL never passes --fallback-model.
 */
export function applyReportedModel(
  execution: ModelExecution,
  item: AgentEvent,
): boolean {
  if (item.kind === "session") {
    const changed = execution.reported?.model !== item.model;
    execution.reported = {
      ...execution.reported,
      model: item.model,
      ...(item.cliVersion ? { cliVersion: item.cliVersion } : {}),
    };
    return changed;
  }
  if (item.kind === "usage-by-model" && execution.reported) {
    execution.reported.modelsUsed = [
      ...new Set([...(execution.reported.modelsUsed ?? []), ...item.models]),
    ].slice(0, 20);
  }
  return false;
}

/** Waits before the second and third attempt of a turn that lost the OAuth refresh race. */
export const transientRetryDelays: readonly number[] = [15_000, 45_000];

export type TransientSleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface TransientRetryOptions {
  signal: AbortSignal;
  /** Receives the notice, in the locale in effect, before each wait. */
  onRetry?: (notice: string) => void;
  /** Test seam; the default waits for real and rejects with the 409 cancellation on abort. */
  sleep?: TransientSleep;
}

const waitFor: TransientSleep = async (ms, signal) => {
  try {
    await delay(ms, undefined, { signal });
  } catch {
    throw new AppError(cancelled(), 409);
  }
};

/**
 * Runs one CLI invocation and repeats it while it ends with a retryable
 * terminal error, up to two more times. Every attempt is a separate
 * invocation: the caller acquires and releases its process slot and records
 * efficiency inside attempt(), so nobody is blocked during the wait. The last
 * result is returned as is; the caller decides what a failure means.
 */
export async function retryTransientAuth<T extends { retryable?: boolean }>(
  attempt: () => Promise<T>,
  options: TransientRetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? waitFor;
  const total = transientRetryDelays.length + 1;
  for (let index = 0; ; index++) {
    const result = await attempt();
    const ms = transientRetryDelays[index];
    if (!result.retryable || ms === undefined || options.signal.aborted)
      return result;
    options.onRetry?.(
      sm().run.agentCli.authRetry({
        seconds: Math.round(ms / 1000),
        attempt: index + 2,
        total,
      }),
    );
    await sleep(ms, options.signal);
    if (options.signal.aborted) throw new AppError(cancelled(), 409);
  }
}
