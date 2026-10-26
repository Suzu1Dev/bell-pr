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

- **A failed split no longer leaves a stray branch.** When git failed while
  checking out a split part, for example on a timeout or a full disk, the
  part's new fix/ branch and any files already written stayed in BELL PR's
  copy of the repository, with nothing left to remove them. A failed checkout
  now removes both.

- **A task that changed nothing no longer merges the split parts.** A
  finished plan task that changed no file, such as a build check scoped to
  a whole folder, was credited with every changed file in that folder. This
  joined independent fixes into one part, so the split suggestion found
  nothing to split and a split copied the task into every new
  contribution. Such a task now owns no file.

- **Split offered with a held-back file.** With two changed files, one of
  them held back (binary, sensitive path or a secret), the Draft tab still
  offered "Split into contributions", but the dialog could never be
  submitted. The split is now offered only when two files or more can move.

- **Keyboard focus in the split dialog.** Removing a contribution, or adding
  the eighth, sent keyboard focus out of the dialog to the page. Focus now
  moves to the next (or previous) contribution's title after a removal, and
  to the new contribution's title after an add.

- **Screen readers announce analysis notices.** During an analysis, a
  sign-in retry or rate-limit notice from the CLI was often not read
  aloud. Its status region only appeared together with its text, and on
  a first analysis it sat inside a section marked busy until the analysis
  ended. The region now stays on screen and only its text changes, and the
  section stops being marked busy once the progress steps show.

- **Links from other sites open BELL PR.** Following a link to BELL PR from
  another site, or arriving through a sign-in proxy's redirect from its
  identity provider, showed a raw "Cross-origin requests are not allowed"
  error instead of the interface. The page now opens. Other sites still
  cannot call the API, load its files or put it in a frame.

- **A repository's signing program no longer runs when you view commits.**
  If a run repository's own Git config turned on signature display and
  named a signing program, opening the run's commit list (or retrying a
  publish) ran that program for every signed commit, such as the ones
  GitHub creates when you apply a suggestion. BELL PR's Git commands now
  never verify signatures in logs, and BELL PR refuses a repository whose
  own config names a signing program, as it already did for filters and
  credential helpers.

- **Deleted projects no longer come back through a settings save.** If you
  deleted a project, or used Delete all data, while that project's
  settings were still saving (for example while the model list loaded),
  the save wrote the project's analysis file again. Its notes then
  outlived the deletion and still counted toward storage use. The save
  now stops with "not found" and writes nothing.

- **Stop during the lead's last save.** Clicking Stop just as the lead
  finished its plan could leave the run waiting for plan approval instead
  of stopped. Stopping during the lead's last coordination turn could move
  the run to review and start the explanations and the PR draft. A
  Learn-by-hand orientation could end waiting for your plan the same way.
  The run now ends cancelled. A plan or outline that was already written
  is kept, so Retry takes you back to the approval step.

- **Retried tasks no longer carry the discarded attempt's checks.** When a
  failed team task was retried, the commands BELL had seen its first attempt
  run (such as "npm test -> exit 0") stayed on the board. The lead and the
  test analyst were shown them as evidence for the new diff, and a first
  attempt that had hit the 40-command limit kept the retry from recording
  any commands. A retried task now shows only the commands the new attempt
  runs. Completed tasks keep theirs.

- **Limit errors in the chosen language.** An out-of-range
  BELLPR_MAX_AGENT_PROCESSES, BELLPR_MAX_ACTIVE_RUNS or
  BELLPR_AGENT_TIMEOUT_SCALE stopped `bell-pr start` with an English message
  even when BELL PR was set to Traditional Chinese. The message now follows
  the language in effect, like the other configuration errors.

- **Damaged state file reported in the chosen language.** When state.json
  was valid JSON but not a state BELL PR could read, and no backup could
  replace it, the startup error contained the English phrase "Invalid state
  format" even in Traditional Chinese. That reason is now translated too.

- **A created PR no longer takes over another run.** If you left the publish
  dialog while the PR was being created and opened another run, the answer
  replaced that run: the workspace showed the published run with the other
  run's files, and unsaved draft edits on it were lost. Now the open run
  stays as it is, and you still get the "PR created" notice.

- **Starting a new task asks before dropping unsaved PR draft edits.**
  Submitting the New task dialog for a real project replaced the open run
  and threw away unsaved edits to its PR draft without a word. Now it first
  asks whether to discard them, the way opening another run already does;
  keeping them leaves the dialog open.

- **Guide options stay with the R3 hint.** In a run fitted to a project's
  rules that leave out planning help, an R1 hint or a question could still
  come with ways forward and their trade-offs. That is planning help, but
  the run recorded it as an answer, and choosing one of those options always
  failed. Now only an R3 hint and questions on your plan keep options, and
  you can only choose from an R3 hint's options.

- **The guide's tool now appears in the facts list for Codex runs.** In a
  Learn-by-hand run on Codex, the default, the "Your words" facts list left
  out the line naming the tool the guide ran on, so your AI note had no
  tool to cite. A Claude Code run did show that line. The list now says
  "The guide ran on Codex; the CLI didn't report its model."

- **The premise check no longer covers the mobile navigation drawer.** In a
  narrow window, an open premise check in Code changes drew its evidence
  over the navigation drawer and its backdrop, hiding the drawer's links
  and catching clicks meant for them. The drawer now opens above it.

- **Closing the split dialog mid-split.** Cancel, Escape, the close button
  or the backdrop could close the dialog while "Splitting…" showed, but the
  split went on anyway: on success the app jumped to the first part, and a
  failure was never shown. The dialog now stays open until the split ends.

- **Split links to deleted runs.** After a split, deleting a part left it
  in the original's banner, where it opened a "not found" error, and once
  every part was gone the original could never be split again. Deleting the
  original also left a dead "Open the original" link in each part. A deleted
  run now leaves those links, and the original can be split again.

- **Retrying a run whose checkout failed.** If making a run's worktree timed
  out, was cancelled or hit a folder that was already there, the run kept its
  base commit and its branch. Every retry then started the agents in a
  missing or half-made folder. Now a failed or cancelled checkout removes its
  branch and files, and the next attempt makes the worktree again.

- **Sync and Undo no longer leave a run stuck.** If the run's checkout could
  not be updated, for example because your editor or terminal Git held the
  index lock, Sync or Undo moved the run's branch anyway. After that, Sync,
  Undo and Publish all refused to go on. Now the branch and files stay as
  they were, and you can press Sync or Undo again once the lock is gone.

- **Checkouts created during a long agent turn stayed readable.** A Claude
  write agent's sandboxed commands were kept out of BELL's data directory
  only for the runs, tasks and clones that existed when its turn started,
  so another project's checkout created during the turn could be read.
  The sandbox now closes the whole data directory and opens only the
  agent's own checkout and its clone's Git data.

- **A finished run's changes show up even if you save the draft just then.**
  Saving the PR draft while BELL was loading a finished team's changes
  threw them away. A failed load was also never retried. The Changes tab
  stayed empty or out of date until you pressed Refresh. Now the changes
  are shown after a save, and a failed load is tried again on the next
  poll.

- **The open premise check folds again when you move on.** In Code
  changes, the premise check's evidence stayed open over the code, so
  pressing Tab past the diff tools put the focus on Whole file, the
  Reviewed checkbox and the code lines, all hidden under it. It now folds
  when the focus moves elsewhere on the page or you click outside it.
  Escape also folds it and puts the focus back on its heading, without
  also leaving focus mode.

- **Retrying a publish finds the PR it already opened.** If GitHub opened
  the draft PR but BELL PR never got the answer (for example, gh timed out
  or the server stopped), every retry failed with "a pull request for branch
  ... already exists" and the run never got the PR's link. A retry now finds
  that open PR on the pushed branch and records it, and does not try to
  open a second one.

- **Code in spaced braces got through the Learn-by-hand filter.** The filter
  removed an object like "{retries:3}" from a guide answer, review finding
  or chat answer, but kept "{ retries: 3 }", "{ break; }" or
  "{ throw err }". So the agent could hand you an options object or a
  statement block it wrote itself. These are now removed unless they are
  copied exactly from the project's files. Sets like "{1, 2, 3}" and
  placeholders like "{ name }" stay.

- **More spaced code in braces is caught by the Learn-by-hand filter.** A
  key with a space before its colon ("{ retries : 3 }"), a quoted or computed
  key ('{ "Content-Type": … }', "{ [key]: 3 }"), a statement without a
  semicolon ("{ if (done) break }") or a call ("{ retry() }") still got past
  the filter when written with spaces, while the same code without spaces
  was removed. These are now removed too, unless the project's files have
  them word for word.

- **Closing the new-task dialog while a task starts.** Cancel, Escape, the
  close button, the backdrop, **Import another project** or **See
  AI-recommended directions first** could leave the dialog while the run was
  being created, but the request went on anyway: on success the app jumped
  to the new run, and a failure was never shown. The dialog now stays open
  until the request ends, as the split dialog does.

- **Code in learning note titles.** On the Learning page, a concept title
  with an identifier in backticks, such as "`AbortController` cancellation",
  showed the backticks literally, while the explanation panel showed the
  same name as code. The note's heading now shows it as code too.

- **Discovery no longer leaks a token from an issue title.** When an issue
  title held something that looked like a credential, the warnings naming
  that issue (masked credentials, truncated or unreadable source) kept it
  unmasked. It then reached the Agent, the saved discovery results and the
  card's rules details, and could make the whole search fail. These
  warnings now show the masked title, and every candidate warning is masked
  before it is passed on or saved.

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
