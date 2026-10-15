# Configuration

BELL PR needs no configuration to start. This page lists what you can
change: the command-line options, the `BELLPR_*` environment variables and
the settings in the app.

## Where settings come from

- **Command-line options** of `bell-pr start`, such as `--port`, win over
  the environment variable of the same setting.
- **Environment variables** (`BELLPR_*`) are read when BELL PR starts. Set
  them in your shell, load them from a file with
  `bell-pr start --env-file <file>` (variables already set in the
  environment win over the file), put them in
  `~/.config/bell-pr/environment` for the [systemd service](self-hosting.md),
  or pass them with `docker run -e` ([Docker](docker.md)). BELL PR never
  loads a `.env` file by itself. [.env.example](../.env.example) lists them
  all with comments.
- **The app's Settings page** keeps its values in `<data dir>/app-settings.json`
  and applies a change at once. Where an environment variable sets the same
  value, the variable wins: the setting shows "Set by environment" and can
  only change there, followed by a restart.

## Commands

`bell-pr` and `bellpr` are the same command. Started with `npx`, write
`npx bell-pr` instead of `bell-pr`.

| Command | What it does |
| --- | --- |
| `bell-pr` or `bell-pr start` | Starts BELL PR and prints the sign-in link |
| `bell-pr open` | Asks the running BELL PR for a one-time sign-in link and opens it; `--print` only prints it |
| `bell-pr doctor` | Checks Node.js, Git, the GitHub CLI, the agent CLIs, the sandbox and the data directory; `--json` for scripts |
| `bell-pr license` | Shows or changes the license: `status [--json]`, `activate <key>`, `deactivate`, `trial` ([Licensing](licensing.md)) |
| `bell-pr version` | Shows the version, its release date, Node.js, the platform and the data directory |
| `bell-pr help` | Lists the commands and options |

Options of `bell-pr start`:

| Option | Variable | Default |
| --- | --- | --- |
| `--port <port>` | `BELLPR_PORT` | `4311` |
| `--host <host>` | `BELLPR_HOST` | `127.0.0.1` |
| `--data-dir <dir>` | `BELLPR_DATA_DIR` | `~/.bellpr` |
| `--no-open` | `BELLPR_NO_OPEN=1` | opens the browser when it can |
| `--env-file <file>` | | none |

`--data-dir` and `--env-file` work with every command, so `open`, `doctor`,
`license` and `version` find the data directory of the BELL PR you mean.

## Environment variables

| Variable | Default | What it sets |
| --- | --- | --- |
| `BELLPR_PORT` | `4311` | Port of the web interface and the API, 1024 to 65535. Also `--port`. |
| `BELLPR_HOST` | `127.0.0.1` | Address to listen on. Also `--host`. The default accepts connections from this computer only. `0.0.0.0` or `::` listen on every address (the Docker image uses this inside the container) but still answer only requests addressed to this computer or to `BELLPR_PUBLIC_URL`. Any other address needs `BELLPR_PUBLIC_URL`. |
| `BELLPR_PUBLIC_URL` | none | The address browsers use when BELL PR sits behind a reverse proxy or a different published port, without a path, such as `https://bell.example.com`. BELL PR accepts requests for it and prints its sign-in links for it. It must be `https` unless it points to this computer. |
| `BELLPR_ALLOWED_ORIGINS` | none | Extra exact origins to accept, separated by commas. Rarely needed: `BELLPR_PUBLIC_URL` already adds its own. Plain `http` only for loopback addresses. |
| `BELLPR_DATA_DIR` | `~/.bellpr` | Where repositories, worktrees, run records and settings live. Also `--data-dir`. An absolute path is safest. |
| `BELLPR_NO_OPEN` | not set | Any value other than `0` or `false` stops BELL PR from opening a browser at start and for `bell-pr open`. It also stays closed in CI, in containers and when the output is not a terminal. Also `--no-open`. |
| `BELLPR_LOCALE` | `en` | Language of server and command-line messages when nothing else decides: `en` or `zh-TW`. The language chosen in the app wins. |
| `BELLPR_LOG_LEVEL` | `info` | How much the server logs: `debug`, `info`, `warn` or `error`. |
| `BELLPR_LICENSE_KEY` | none | A Pro license key. It wins over a key saved with `bell-pr license activate`, and the app then shows the license read-only. Never commit it. |
| `BELLPR_MAX_AGENT_PROCESSES` | `3` | Agent CLI processes at the same time across all runs, analyses and discovery, 1 to 32. Lower it when your AI plan has tight usage limits. Locks **Settings → Performance**. |
| `BELLPR_MAX_ACTIVE_RUNS` | `2` | Contribution runs executing at the same time, 1 to 8; Free runs one. Running, queued and plan-approval runs together are capped at 8 or twice this value, whichever is larger. Locks **Settings → Performance**. |
| `BELLPR_AGENT_TIMEOUT_SCALE` | `1` | Multiplier for the time limit of one agent turn, 0.5 to 10 (see below). Locks **Settings → Performance**. |
| `BELLPR_ALLOW_UNSANDBOXED_AGENTS` | not set | `1` lets Claude Code agents that edit files run without the operating-system sandbox when it is unavailable. They then have your full user rights, and their runs are marked "Ran without sandbox". Locks **Settings → Agent safety**. |
| `BELLPR_REQUIRE_UNDERSTANDING_CHECK` | not set | `1` keeps the understanding check on (you explain each change back before you approve it) and locks **Settings → Learning**. Any other value locks nothing and is reported as a warning at start; no value turns the check off. |
| `BELLPR_RETENTION_DAYS` | `14` | Days after which the working files of a cancelled or failed run are removed, 1 to 365. Records, reports and notes stay; published runs are never removed automatically. Locks **Settings → Data & privacy**. |
| `BELLPR_DEV` | not set | Development mode, for working on BELL PR itself: sign-in is off and the API trusts the Vite dev server. `npm run dev` sets it; it only works on `127.0.0.1`. |
| `BELLPR_FRONTEND_PORT` | `4310` | Port of the Vite dev server that the API trusts, in development mode only. |
| `BELLPR_STATIC_DIR` | the `dist/` folder of the package | The built web interface to serve. |

An invalid port, address, origin or limit stops BELL PR at start with a
message that names the variable. An invalid `BELLPR_RETENTION_DAYS` or
`BELLPR_LOG_LEVEL` is ignored and the default applies. The variables used
only by BELL PR's own tests and tools are in
[Development](development.md#test-and-tool-variables).

### Agent time limits

One agent turn may take 240 seconds for project analysis and discovery,
600 seconds for read-only turns (the Lead, Reviewer, Test analyst,
explanations, PR drafts and questions) and 1,800 seconds for turns that
write code. Claude Code turns get 2.5 times as long, reasoning effort xhigh
1.5 times and max 2 times, up to 2 hours. `BELLPR_AGENT_TIMEOUT_SCALE` (or
the agent timeout multiplier in **Settings → Performance**) multiplies all
of them. When a turn times out, its message says how long it waited.

## Settings in the app

| Section | What you set there |
| --- | --- |
| **General** | The language of the interface and of new work; the sample project, and resetting it |
| **AI provider** | Which agent CLI is ready, with its setup commands, and the agent, model, reasoning effort and web access (Pro) every project shares |
| **Agent safety** | The Claude Code sandbox status, allowing unsandboxed Claude Code agents, and the AI-assistance note on pull requests |
| **Performance** | Runs at the same time, agent processes at the same time, the agent timeout multiplier |
| **Environment** | The environment check with fix commands, the GitHub CLI sign-in, and what each environment variable does |
| **Data & privacy** | The data directory, disk use per run and freeing it, automatic cleanup, deleting all data, and what leaves this computer |
| **License** | Your plan, the trial and the license key |
| **About** | The version, and the About dialog with the data directory, the legal documents, help links and **Copy diagnostics** |

The model settings (agent, model, reasoning effort, web access) are shared
by every project and saved in `<data dir>/model-settings.json`. Each new
run records the settings it started with, so later changes do not affect
runs that already exist. A project's contribution direction, team size,
plan approval and efficiency mode (Lean, Full or Off) are saved per
project, in the contribution settings of that project.

## Language

BELL PR speaks English and Traditional Chinese (Taiwan). The language
chosen in the app (Welcome or **Settings → General**) sets the interface
and the language agents write their reports, explanations and answers in.
A run keeps the language it started in. Pull request titles and
descriptions stay in English unless the target project's own rules ask for
another language. `BELLPR_LOCALE` only sets the default for server and
command-line messages before a language is chosen.

## Ports

BELL PR serves the web interface and the API on one port, 4311 by
default, on `127.0.0.1`. The session cookie is named after the port in the
browser's address (`bellpr_session_4311`), so two BELL PR servers on one
computer, for example one from `npx` and one in Docker, keep their
sign-ins apart.

## Logs

The server writes one log file per day to `<data dir>/logs/`
(`bell-pr-YYYY-MM-DD.log`, one JSON line per entry), keeps at most 7 files
and 50 MB, and redacts secrets. Prompts and page contents are never
logged. In a terminal it also prints every entry in a readable form; under
a service manager or in a container it prints warnings and errors only.
