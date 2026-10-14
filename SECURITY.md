# BELL PR Security Policy

> **DRAFT, pending owner review.** This policy describes BELL PR 1.0 as
> released. Fill in the owner placeholder below before you publish it.

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

<!-- claim:SEC-01 -->

Security fixes ship as new releases. <!-- claim:SEC-02 -->
A Pro license covers the releases published within its update period. A
release published after that period runs with the Free feature set unless
you renew, but you can still install it to get the fix. <!-- claim:SEC-03 -->

## Reporting a vulnerability

Report vulnerabilities privately to [OWNER: security contact]. Do not open a
public issue, pull request or discussion about a vulnerability. <!-- claim:SEC-04 -->

Please include:

- the BELL PR version (`bell-pr --version`), your operating system, and the
  versions of the agent CLIs involved (`bell-pr doctor` lists them);
- the steps to reproduce the problem, and what an attacker gains;
- whether and when you plan to publish your findings. <!-- claim:SEC-05 -->

Do not include real tokens, license keys or private data; use test values.

What happens next:

- We acknowledge your report within 5 business days and keep you informed
  while we investigate and fix it. <!-- claim:SEC-06 -->
- We credit you in the release notes, unless you prefer not to be named. <!-- claim:SEC-07 -->
- **Disclosure:** please wait 90 days after your report, or until a fix is
  released if that is sooner, before you publish details. If we need more
  time, we explain why and agree on a date with you. <!-- claim:SEC-08 -->

We will not take legal action against good-faith research that follows this
policy, stays within your own installation and accounts, and does not harm
other people's data, privacy or services. <!-- claim:SEC-09 -->

## Threat model

BELL PR is a single-user tool. It runs on your computer as your user
account, and it drives AI coding agents in copies of other people's
repositories. These are the safeguards it relies on, and their limits.

### The local server

- BELL PR listens on the loopback interface (127.0.0.1) by default. <!-- claim:SEC-10 -->
- To listen on another address you set `--host` or `BELLPR_HOST`. Unless
  that address is another loopback address or covers every interface, you
  also set `BELLPR_PUBLIC_URL`. A public URL or
  allowed origin other than this computer must use HTTPS, through a reverse
  proxy that you secure yourself. <!-- claim:SEC-11 -->
- The server answers only requests for its own host names and allowed
  origins, refuses cross-site requests, accepts changes only as JSON, and
  sends a strict content security policy with every page. <!-- claim:SEC-12 -->
- Listening on every interface (`0.0.0.0`, as the Docker image does inside
  its container) lets anyone who can reach the port reach the sign-in page.
  Publish such a port on 127.0.0.1 only. <!-- claim:SEC-13 -->

### The session token and sign-in links

- At every start, BELL PR creates a random 32-byte session token. It is kept
  in the server's memory and never written to a file, an environment
  variable or a command line. A restart signs every browser out. <!-- claim:SEC-14 -->
- BELL PR prints a sign-in link that holds this token, and works until the
  next restart. Keep that link, and any terminal scrollback or service log
  that shows it, as private as a password. <!-- claim:SEC-15 -->
- When BELL PR opens your browser for you at start, it opens a one-time
  sign-in link, not the printed one. That link goes to your system's `open`
  or `xdg-open` command, whose command line other user accounts on the same
  computer may be able to see, so the token itself never appears there.
  Someone who reads the one-time link there could still use it before your
  browser does, which would leave your browser on the sign-in page. On a
  computer that you share with other users, start BELL PR with `--no-open`
  and open the printed link yourself. <!-- claim:SEC-16 -->
- Opening a sign-in link stores the token in an HttpOnly, SameSite=Strict
  cookie that lasts 30 days. Every request except the health check and the
  sign-in page itself needs that cookie. <!-- claim:SEC-17 -->
- `bell-pr open` asks the running server for a one-time sign-in link. Each
  link works once and expires after 120 seconds, at most 5 can be open at a
  time, and the server keeps only a digest of each. <!-- claim:SEC-18 -->
- The server passes the link to `bell-pr open` through a file in the data
  directory that only your user account can read, and `bell-pr open`
  deletes that file as soon as it has read it. <!-- claim:SEC-19 -->
- Any program that runs as your user account can ask for such a link, just
  as it can read your other files. Every program you run as that user is
  therefore trusted. <!-- claim:SEC-20 -->

### Imported repositories are untrusted

The code, scripts, git configuration and agent instruction files of a
repository you import may be hostile. BELL PR:

- clones a repository you import from your own disk into its data
  directory instead of working in your own copy; <!-- claim:SEC-21 -->
- runs git with overrides for programs a repository could configure, and
  refuses a repository whose local git configuration sets filters, diff or
  merge drivers, credential helpers, includes or similar programs; <!-- claim:SEC-22 -->
- does not let agents load the project's own agent instructions and
  settings, such as `AGENTS.md`, `CLAUDE.md` or `.claude/settings.json`, as
  instructions; <!-- claim:SEC-23 -->
- passes agent reports, diffs and maintainer feedback to other agents as
  untrusted data; <!-- claim:SEC-24 -->
- checks pull request text for secrets and local paths, and asks you to
  confirm changes to CI workflow files, before it publishes anything. <!-- claim:SEC-25 -->

### The agent sandbox and its limits

- Agents that change code also run the project's builds and tests. <!-- claim:SEC-26 -->
- Claude Code agents that change code run every command inside Claude
  Code's sandbox (bubblewrap and socat on Linux, the built-in sandbox on
  macOS): those commands can write only in the run's working copy, and
  they have no network access. <!-- claim:SEC-27 -->
- Every Claude Code agent is denied reading common credential files, such
  as SSH keys, the GitHub CLI's sign-in, cloud credentials and the agent
  CLIs' own sign-ins, and BELL PR's data outside the current working copy. <!-- claim:SEC-28 -->
- Claude Code agents that only read, such as the Reviewer, the Test
  analyst and the mentor, cannot run commands and can read only their
  working directory. <!-- claim:SEC-29 -->
- Codex CLI agents run in the Codex sandbox, which limits writing to the
  working copy and turns network access off, but lets them read any file
  your user account can read. <!-- claim:SEC-30 -->
- BELL PR passes no agent your GitHub token or a BELL PR license key: each
  agent CLI's environment holds only the basics and its own sign-in
  settings. <!-- claim:SEC-31 -->
- With web access on (Pro), agents can search the web, and Claude Code
  agents may open pages on github.com, docs.github.com and
  raw.githubusercontent.com only. Search results and pages are treated as
  untrusted data. <!-- claim:SEC-32 -->
- If the Claude Code sandbox is not available, BELL PR refuses to start
  Claude Code agents that change code, unless you turn on unsandboxed
  agents in Settings or set `BELLPR_ALLOW_UNSANDBOXED_AGENTS=1`. The app
  marks every run that used unsandboxed agents. <!-- claim:SEC-33 -->
- Unsandboxed agents run with all the permissions of your user account,
  including your files, credentials and network. <!-- claim:SEC-34 -->
- A sandbox depends on the agent CLI version and on the operating system,
  and it can have flaws. Do not run BELL PR as root or an administrator, and
  run it under a user account whose data you are willing to expose to the
  projects you import. <!-- claim:SEC-35 -->
- In Docker, the container adds another boundary, but the agents' sandbox
  cannot start under Docker's default security options; the Docker
  documentation describes the options that let it start, and what they
  relax. <!-- claim:SEC-36 -->

### Out of scope

- Attacks that need code already running as your user account, or
  administrator access to your computer.
- Vulnerabilities in GitHub, OpenAI, Anthropic, the GitHub CLI, the Codex
  CLI or Claude Code. Report those to their vendors.
- Effects of a hostile repository that stay within the limits described
  above, such as changes to its own working copy.
- Pull requests that you approved and published.
- Runs with unsandboxed agents, which you chose to trust fully. <!-- claim:SEC-37 -->
