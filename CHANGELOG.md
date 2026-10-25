# Changelog

All notable changes to BELL PR are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and BELL PR follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Analysis progress.** While a project analysis or **Generate 5 more**
  runs, the overview lists its steps and shows how long the agent has worked
  against the longest it will wait, with the CLI's notices such as a retry or
  a rate limit. The bar fills with that time, not with how much work is
  left, and only moves while no try is being timed.

### Removed

- **Sign-in.** BELL PR no longer signs anyone in: the session cookie, the
  one-time sign-in links, the `/auth` page and the `auth_required` error code
  are gone. The start line prints the plain address (`http://127.0.0.1:4311`),
  and `bell-pr open` prints that address and opens it (`--print` only prints
  it). BELL PR does not authenticate anyone, so put an authenticating proxy in
  front of it before you reach it from another machine.

### Changed

- **Rejected analysis.** When BELL PR rejects an AI analysis as incomplete,
  the server log's `agent.output_retry` line now names the fields that did
  not fit and why (for example `recommendations: too_big`), never their
  values, so a rejection can be diagnosed without the answer.

## [1.0.0-rc.1] - 2026-10-20

The first public release candidate of BELL PR, open source under the
Apache License 2.0. BELL PR is a self-hosted, local-first workbench for
open-source contributions. An AI agent team works on your computer with the
coding CLIs you already use, explains every change in plain language, asks
you to explain it back, and drafts a pull request that you review and
approve. There is no BELL PR cloud, no telemetry and no account. It is
community-maintained software, provided "as is". The BELL PR name and logo
are not under the Apache license; see `TRADEMARKS.md`.

### Added

- **Projects.** Import a GitHub repository (`owner/repo` or a link) or a Git
  folder on your computer. BELL PR works in its own full clone in the data
  directory and can update it to the latest default branch.
- **Project analysis.** What the project does, who uses it, how its parts
  fit together and where to start reading, with up to five contribution
  directions per analysis whose quoted evidence is checked against the code.
  **Generate 5 more** adds five at a time, up to 30 per project.
- **Agent team runs.** A Lead plans the work, teammates (two, three or four,
  as you choose) implement it in isolated Git worktrees, and a Reviewer and
  a Test analyst check the integrated result. You can approve or revise the
  plan, message the team and retry failed subtasks. Several contributions
  can run at once, up to the configured limit of 1 to 8.
- **Learn by hand.** You write the change yourself: a guide plans with you,
  gives hints without code and reviews your change when you are ready. BELL
  PR runs your tests, and its agents cannot edit your files in these runs.
- **Review that teaches.** Every changed file is explained in plain language
  with an example, alternatives and a question to test yourself. **Try
  first** asks for your answer and how sure you are before it shows the
  reference. Ask follow-up questions per file or per line, follow the
  suggested review order, keep your own notes, and open the unchanged code
  around each change or a step-by-step code walkthrough.
- **Explain it back.** A short closed-book check before approval: your own
  explanation, answers about the riskiest files and what you did not test,
  graded by you against AI-written references. No AI model grades you. It is
  on by default and can be turned off in Settings → Learning; runs approved
  without it are marked "Check off".
- **Pull request drafts that follow the project's rules.** BELL PR reads the
  contribution guides, AI policies, templates and agent guides, suggests a
  title, description and commit message with the source of each rule, and
  checks the draft before publishing (credentials, unfinished text, local
  paths, CI changes, public e-mail addresses). AI assistance is disclosed
  only when the project requires it or you choose to. Publishing pushes a
  branch (to your fork when needed) and opens a **Draft** PR through the
  GitHub CLI; nothing is force-pushed.
- **Respect the maintainer's time.** The project overview quotes the
  project's own rules with their file and line, says whether it takes pull
  requests from you, and checks again at publish: pull-request access, a
  closed or reserved issue, competing work, and your open pull requests in
  the repository. A skipped, deleted or loosened test needs a written
  reason. These checks apply to everyone and cannot be skipped.
- **After publishing.** Sync a run or its pull request onto the latest
  target branch with an agent that resolves conflicts for your review. Read
  maintainer feedback once, on request, and compare it with what you
  predicted. Let an agent address selected comments in a follow-up round,
  pushed as one more commit.
- **Discovery.** GitHub-wide suggestions of projects and issues that match
  your interests, language and difficulty, with their contribution rules and
  the first step. Newcomer-labelled issues are marked "Learn by hand".
- **Learning page and practice.** Every explanation and note in one searchable
  place, a practice deck that brings your questions back after 1, 3, 7 and
  21 days, a coach debrief from your own records, and Markdown export of a
  contribution's learning record.
- **Your own AI tools.** Works with the OpenAI Codex CLI and the Claude Code
  CLI you installed and signed in to; usage counts against your own account.
  Choose the model, the reasoning effort (including `xhigh`, `max` and
  `ultra`) and the Lean, Full or Off efficiency mode (built on Ponytail).
  Web access for agents is a setting that is off until you turn it on.
- **Two languages.** The interface and the agents' explanations are in
  English or Traditional Chinese (Taiwan). Pull request titles and
  descriptions stay in English unless the project's rules say otherwise.
- **Sample project.** A finished sample contribution that needs no setup and
  makes no AI call, with a playable timeline and presentation flags for
  screen sharing.
- **Setup and settings.** A first-start Welcome (language, environment,
  provider), an environment doctor with fix commands (`bell-pr doctor` and
  Settings → Environment), and Settings for the AI provider, agent safety,
  limits, learning, data and privacy.
- **Packaging.** The `bell-pr` (and `bellpr`) command with `start`, `open`
  and `doctor`; `npx bell-pr`; a Docker image (beta); a generic systemd user
  unit in `contrib/systemd/bell-pr.service`; and documentation for Docker
  and self-hosting.
- **Community files.** `LICENSE` (Apache-2.0), `NOTICE`,
  `THIRD_PARTY_NOTICES.md`, `TRADEMARKS.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and pull request templates.

### Security

- Sign-in: the server keeps a random session secret in memory only and
  prints a sign-in link at start. The browser that BELL PR opens gets a
  one-time link instead; `bell-pr open` asks the running server for another
  one. The session cookie is named after the port in the browser's address
  (`bellpr_session_<port>`), so two servers on one computer keep their
  sessions apart.
- Only this computer's addresses (or a configured HTTPS proxy origin) are
  accepted, cross-site requests are refused, and a strict Content Security
  Policy applies.
- Agents get only the environment their CLI needs. Claude Code agents that
  write code run in Claude Code's sandbox (bubblewrap and socat on Linux)
  and are refused without it unless you allow unsandboxed agents; Codex
  agents run in Codex's workspace-write sandbox. Claude Code agents are
  denied the GitHub CLI login, SSH keys and BELL PR's sign-in links, and no
  agent loads the target repository's own agent instructions. The sandbox
  canary results are in `docs/security-model.md`.
- Secrets are masked in logs and diagnostics; a changed file that holds one
  is held back from review, and a draft that holds one cannot be published.
- Usage-data opt-outs set in BELL PR's environment reach the agent CLIs:
  `DO_NOT_TRACK` for both, and `DISABLE_TELEMETRY`,
  `DISABLE_ERROR_REPORTING`, `DISABLE_BUG_COMMAND`,
  `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY` and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` for Claude Code.

### Known limitations

- Unit tests, the build and the package check run on Linux and macOS with
  Node.js 22 and 24. The browser tests and real agent runs were done on
  Linux only; Windows (WSL2) has not been tested.
- Publishing a Draft PR, Discovery, reading maintainer feedback and
  follow-up rounds have been exercised only against a stand-in GitHub CLI,
  not against live GitHub. Reports from real use are welcome.
- Only two agent CLIs are supported (Codex and Claude Code), and only GitHub
  for publishing. A local Git repository can be analyzed and worked on but
  not published.
- Docker support is beta: the agent sandbox needs three `--security-opt`
  options, see `docs/docker.md`.
- Several real-agent checks used small JavaScript projects; larger and
  multi-language projects are not yet covered.
