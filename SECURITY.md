# BELL PR Security Policy

> **DRAFT, pending owner review.** This policy describes the intended
> behavior of BELL PR 1.0. Check it against the release and fill in the
> owner placeholder below before you publish it.

## Owner placeholders

Fill in each item, then delete this list. Each item appears exactly once in
the text below, as a bracketed placeholder that starts with OWNER.

- [ ] **Security contact** (Reporting a vulnerability): the private address
  for security reports. Use `securityEmail` from `shared/product.ts` once
  the owner sets it.

---

## Supported versions

| Version | Security fixes |
| --- | --- |
| Latest 1.x release | Yes |
| Earlier 1.x releases | No: update to the latest release |
| Pre-releases (beta and release candidates) | No |

Security fixes ship as new releases. A Pro license covers the releases
published within its update period. A release published after that period
runs with the Free feature set unless you renew, but you can still install
it to get the fix.

## Reporting a vulnerability

Report vulnerabilities privately to [OWNER: security contact]. Do not open a
public issue, pull request or discussion about a vulnerability.

Please include:

- the BELL PR version (`bell-pr --version`), your operating system, and the
  versions of the agent CLIs involved;
- the steps to reproduce the problem, and what an attacker gains;
- whether and when you plan to publish your findings.

Do not include real tokens, license keys or private data; use test values.

What happens next:

- We acknowledge your report within 5 business days and keep you informed
  while we investigate and fix it.
- We credit you in the release notes, unless you prefer not to be named.
- **Disclosure:** please wait 90 days after your report, or until a fix is
  released if that is sooner, before you publish details. If we need more
  time, we explain why and agree on a date with you.

We will not take legal action against good-faith research that follows this
policy, stays within your own installation and accounts, and does not harm
other people's data, privacy or services.

## Threat model

BELL PR is a single-user tool. It runs on your computer as your user
account, and it drives AI coding agents in copies of other people's
repositories. These are the safeguards it relies on, and their limits.

### The local server

- BELL PR listens on the loopback interface (127.0.0.1) by default. Another
  address needs an explicit `--host` setting. Origins other than loopback
  must use HTTPS, through a reverse proxy that you secure yourself.
- The server accepts requests only from allowed origins and hosts, and its
  pages carry a strict content security policy.

### The session token and `bell-pr open` sign-in links

- At every start, BELL PR creates a random 32-byte session token. It exists
  only in the server's memory: never in a file, an environment variable or
  a command line. A restart signs every browser out.
- The sign-in link that BELL PR prints at start stores the token in an
  HttpOnly, SameSite=Strict cookie that lasts 30 days. Every API request
  except the health check needs that cookie.
- `bell-pr open` asks the running server for a one-time sign-in link. Each
  link works once and expires after 120 seconds, and at most 5 can be open
  at a time. The server passes the link through a file in the data
  directory that only your user account can read, and `bell-pr open`
  deletes that file as soon as it has read it.
- Any program that runs as your user account can ask for such a link, just
  as it can read your other files. Every program you run as that user is
  therefore trusted.

### Imported repositories are untrusted

The code, scripts, git configuration and agent instruction files of a
repository you import may be hostile. BELL PR:

- clones a local repository into its data directory instead of working in
  your own copy;
- runs git with overrides for programs a repository could configure, and
  refuses a repository whose local git configuration sets filters, diff or
  merge drivers, credential helpers, includes or similar programs;
- does not let agents load the project's own agent instructions and
  settings, such as `AGENTS.md`, `CLAUDE.md` or `.claude/settings.json`, as
  instructions;
- passes agent reports to other agents as untrusted data, and checks pull
  request text for secrets and local paths before it publishes anything.

### The agent sandbox and its limits

- Agents that change code also run the project's builds and tests. Claude
  Code agents with write access run inside Claude Code's sandbox
  (bubblewrap and socat on Linux, the built-in sandbox on macOS): they can
  write only in the run's working copy, and network access is off by
  default. Claude Code agents are also denied reading common credential
  files, such as SSH keys, the GitHub CLI's sign-in and cloud credentials,
  and BELL PR's data outside the current working copy.
- Codex CLI agents run in the Codex sandbox, which limits writing to the
  working copy and turns network access off, but lets them read any file
  your user account can read.
- If the Claude Code sandbox is not available, BELL PR refuses to start
  Claude Code agents with write access, unless you turn on unsandboxed
  agents in Settings. The app marks every run that used unsandboxed agents.
  Unsandboxed agents run with all the permissions of your user account,
  including your files, credentials and network.
- A sandbox depends on the agent CLI version and on the operating system,
  and it can have flaws. Do not run BELL PR as root or an administrator, and
  run it under a user account whose data you are willing to expose to the
  projects you import.
- In Docker, the container adds another boundary, but the Codex sandbox may
  not work under Docker's default security profile; the Docker
  documentation describes the workaround.

### Out of scope

- Attacks that need code already running as your user account, or
  administrator access to your computer.
- Vulnerabilities in GitHub, OpenAI, Anthropic, the GitHub CLI, the Codex
  CLI or Claude Code. Report those to their vendors.
- Effects of a hostile repository that stay within the limits described
  above, such as changes to its own working copy.
- Pull requests that you approved and published.
- Runs with unsandboxed agents, which you chose to trust fully.
