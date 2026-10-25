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

- **Split a contribution.** When the plan has parts that do not depend on one
  another, the reviewability snapshot and its publish confirm list them, and
  **Split into contributions** on the Draft tab turns chosen files into
  separate contributions. A part is a group of files the plan keeps apart, not
  always one fix: tasks that cite the same issue number are joined, and the
  dialog says so when a part cites several issues, because BELL PR cannot
  separate fixes inside a file.
  Each new contribution gets its own branch, working copy and pull request
  draft from the same base commit, with its files as they are now, the plan
  tasks that changed them, and the explanations, notes and review marks for
  those files. The split is by file, never by hunk. The original run is kept,
  a banner asks you to publish the parts, and BELL PR cannot check that each
  part works on its own.

### Removed

- **Sign-in.** BELL PR no longer signs anyone in: the session cookie, the
  one-time sign-in links, the `/auth` page and the `auth_required` error code
  are gone. The start line prints the plain address (`http://127.0.0.1:4311`),
  and `bell-pr open` prints that address and opens it (`--print` only prints
  it). BELL PR does not authenticate anyone, so put an authenticating proxy in
  front of it before you reach it from another machine.

### Changed

- **Premise check.** In Code changes it sits in the diff's top bar instead
  of a row of its own, and opens as an overlay that scrolls and can be
  reached with the keyboard, so the code keeps its height.
- **Worktree path.** Code changes no longer shows the run's worktree path
  above the diff, so the code keeps that height. The files are still under
  `worktrees/` in the data directory, and a Learn by hand run shows its
  folder in its own panel.
- **Repository and branch.** In the reading layout of a run, a wide window
  shows them beside the title as two short lines, with the export as an
  icon, instead of a line below it. The code gets that line; a narrower
  window and the sample keep the line below.
- **How people use it.** The project overview lists the steps one per row,
  numbered, instead of side by side, so ten steps or a long one no longer
  crowd or break the row.
- **Rejected analysis.** When BELL PR rejects an AI analysis as incomplete,
  the server log's `agent.output_retry` line now names the fields that did
  not fit and why (for example `recommendations: too_big`), never their
  values, so a rejection can be diagnosed without the answer.
- **One fix per proposal.** The prompts for the lead's plan, the
  recommendations and the discovery opportunities now ask for one fix a
  maintainer can review on its own, and the plan names its independent fixes
  so they can be split. The effect on the agents' output is not measured yet.
- **globals 17.13.** The lint setup's lists of browser and Node globals come
  from globals 17.13 (was 17.12). Development only; the package does not
  change.
- **Icons.** The app's icons come from lucide-react 1.59 (was 0.468). An
  icon without a label of its own is now hidden from screen readers
  (`aria-hidden`), and the icons' chunk is 2.5 kB larger (gzip). Lucide's
  license now includes Feather's MIT notice itself, so
  `THIRD_PARTY_NOTICES.md` quotes it from there instead of adding it.
- **ESLint 10.** The lint runs on ESLint 10.13 (was 9.39) with the same
  rules, so developing BELL PR needs Node.js 22.13 or later. Running it
  still needs Node.js 22 or later.
- **Vite 8.** The web app is built with Vite 8.3 and @vitejs/plugin-react 6
  (were Vite 6.4 and plugin-react 4.7), which bundle with Rolldown. The app
  loads as a few more, smaller files, within the same size budgets, and
  `THIRD_PARTY_NOTICES.md` now credits Rolldown, whose runtime helpers ship
  in the bundle instead of those of @rollup/plugin-commonjs.

### Fixed

- **Opening a contribution from a link.** A link or a reload that names a
  contribution showed the sample project's workspace under that address for a
  moment, so a click there, such as on the **Ask** tab, was lost when the
  contribution replaced it. The workspace now says it is opening the
  contribution until it arrives.

- **Splitting no longer gets around open sync conflicts.** A run whose sync
  left conflict markers could be split, and the new parts lost track of the
  conflict, so they could be approved and published with the markers still
  in their files. The split now waits until the conflicts are resolved and
  names the files that still hold markers.

- **Split parts no longer get stuck on an explanation in progress.** Splitting
  a run while its explanations were still being written left those files
  marked as being explained in the new parts forever: Retry did nothing and
  the page kept asking the server again. The new parts now ask for their own
  explanations.
### Security

- **zod 4.** The server validates requests, agent answers and saved files
  with zod 4.6.7 (was 3.25.76). zod 3 has no fix for GHSA-mrhx-c7xc-m3w5,
  where a list with very many invalid items could use up the server's
  memory. A request that fails validation now says why in zod 4's words,
  for example `prompt: Too small: expected string to have >=10 characters`,
  and the server log's `agent.output_retry` line uses zod 4's codes
  (`invalid_value` instead of `invalid_enum_value`). Text lengths count
  Unicode code points instead of UTF-16 units, so most emoji count once.
  Files that earlier builds saved load as before, and saved files are read
  as leniently as before.

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
