# Changelog

All notable changes to BELL PR are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and BELL PR follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- The browser that BELL PR opens at start gets a one-time sign-in link.
  The session link, which other users of the computer could read on the
  command line of `open` or `xdg-open`, is only printed.

### Changed

- Usage-data opt-outs set in BELL PR's environment reach the agent CLIs:
  `DO_NOT_TRACK` for both, and `DISABLE_TELEMETRY`,
  `DISABLE_ERROR_REPORTING`, `DISABLE_BUG_COMMAND`,
  `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` for Claude Code.
- The refund and delivery policy ships with the app, and About lists it
  with the other legal documents.
- The import dialog suggests `~/projects/repository` as a local path on
  every computer, and tells Windows browsers which path to use when BELL PR
  runs inside WSL2.
- The plan copy says what a key carries: 12 months of updates from the
  date the key is issued.

### Fixed

- A question about selected lines quotes them as a diff block with the
  file and its line numbers, which the chat shows as code instead of one
  paragraph.
- `bell-pr doctor` reports the port of the BELL PR running with the data
  directory, also one started with `--port`.
- A second analysis of the same project, or a second discovery, answers
  with the error code `already_running`.
- At 320 px, the sample badge of presentation mode no longer pushes the
  top bar's buttons off the screen.
- Importing a local path that does not exist, or a folder outside Git,
  says so instead of failing with "Check the local service log".

## [1.0.0-rc.1] - 2026-10-14

The first release candidate of BELL PR 1.0.0: a self-hosted, local-first
workbench for open-source contributions. An AI agent team works on your
computer with the coding CLIs you already use, explains every change in
plain language, and drafts a pull request that you review and approve.
There is no BELL PR cloud, no telemetry and no account.

### Added

- **Projects.** Import a GitHub repository (`owner/repo` or a link) or a
  Git folder on your computer; BELL PR works in its own full clone in the
  data directory and can update it to the latest default branch.
- **Project analysis.** What the project does, who uses it, how its parts
  fit together and where to start reading, with up to five recommendations
  whose quoted evidence is checked against the code (Pro: five more at a
  time, up to 30 per project).
- **Agent team runs.** A Lead plans the work, teammates implement it in
  isolated Git worktrees, and a Reviewer and a Test analyst check the
  result. You can approve or revise the plan, message the team and retry
  failed subtasks. Free runs one contribution at a time with a Lead and two
  teammates; Pro allows teams of three or four teammates and parallel runs.
- **Review that teaches.** Every changed file is explained in plain
  language, with an example, alternatives and a self-check question. Ask
  follow-up questions per file, follow the suggested review order, keep
  your own notes, and find everything again on the learning notes page.
  Pro exports a contribution's learning record as Markdown.
- **Pull request drafts that follow the project's rules.** BELL PR reads
  the project's contribution guides and templates, suggests the title,
  description and commit message, and checks the draft before publishing
  (secrets, unfinished text, project rules). An optional line discloses AI
  assistance. Nothing is published until you have reviewed every file and
  approved the draft; publishing opens a Draft PR through the GitHub CLI.
- **After publishing.** Sync a run or its published PR onto the latest
  target branch, with an agent that resolves conflicts for your review.
  Pro adds maintainer-feedback and CI coaching, and follow-up rounds in
  which an agent addresses selected review comments as one more commit.
- **Discovery (Pro).** GitHub-wide suggestions of projects and issues to
  contribute to; Free shows labelled sample results.
- **Your own AI tools.** Works with the OpenAI Codex CLI and the Claude
  Code CLI you installed and signed in to; usage counts against your own
  account. Choose the model and reasoning effort, give agents web access
  to GitHub pages (Pro), pick the Lean, Full or Off efficiency mode (built
  on Ponytail), and see the provider-reported usage of each run.
- **Two languages.** The interface is in English and Traditional Chinese
  (Taiwan). Agents answer in the run's language; PR titles and
  descriptions stay in English unless the project's rules say otherwise.
- **Sample project.** A finished sample contribution that needs no setup,
  with a playable timeline and presentation flags for screen sharing and
  recording.
- **Setup and settings.** A first-start welcome with the license
  agreement, an environment doctor with fix commands (`bell-pr doctor` and
  Settings > Environment), and Settings for the language, the AI provider,
  agent safety, limits, data and privacy, and the license.
- **Plans.** Free covers the whole contribution loop, one contribution at
  a time. Pro is unlocked by a license key that is checked offline
  (`bell-pr license activate`), or by a 14-day trial per data directory.
- **Packaging.** The `bell-pr` (and `bellpr`) command with `start`,
  `open`, `doctor` and `license`; `npx bell-pr`; a Docker image (beta); a
  generic systemd user unit in `contrib/systemd/bell-pr.service`; and docs
  for Docker and self-hosting.
- Draft license terms (EULA), privacy policy, terms of sale, refund policy
  and security policy. They are pending counsel review and not yet in
  force.

### Security

- Sign-in: the server keeps a random session secret in memory only and
  prints a sign-in link at start; `bell-pr open` asks the running server
  for a one-time link. The session cookie is named after the port in
  the browser's address (`bellpr_session_<port>`), so two servers on one
  computer keep their sessions apart.
- Only this computer's addresses (or a configured HTTPS proxy origin) are
  accepted, cross-site requests are refused, and a strict Content Security
  Policy applies.
- Agents get only the environment their CLI needs. Claude Code agents that
  write code run in Claude Code's sandbox (bubblewrap and socat on Linux)
  and are refused without it unless you allow unsandboxed agents; Codex
  agents run in Codex's workspace-write sandbox. Agents are denied the
  GitHub CLI login, SSH keys and BELL PR's sign-in links (Claude Code), and
  never load the target repository's own agent instructions. The release
  candidate's sandbox canary results are in `docs/security-model.md`.
- Secrets are masked in logs and diagnostics; a changed file that holds
  one is held back from review, and a draft that holds one cannot be
  published.

### Changed

- Data written by this release stays readable by older builds: new fields
  are optional and reads ignore fields they do not know.
- `state.json` is written durably with backups and recovered after a
  crash; interrupted work is reported in its own language, and finished
  runs' files can be freed by hand or after a retention period.
- `.env.example` is in English, and the settings that only matter for
  developing BELL PR itself are grouped at the end.

### Removed

- The machine-specific deployment files in `deploy/`.

### Known limitations

- No license public key is configured in this release candidate, so no
  license key can unlock Pro yet; the 14-day trial works.
- Docker support is beta: the agent sandbox needs three `--security-opt`
  options, see `docs/docker.md`.
- This release candidate was verified on Linux. macOS and Windows (WSL2)
  are pending verification.
