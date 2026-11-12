# Changelog

All notable changes to BELL PR are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and BELL PR follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Group work for the people who share one BELL PR, from the command
  line and the API.** `bell-pr start --group` (or `BELLPR_GROUP=1`) turns
  it on. The person at the host sets the group up with
  `bell-pr group setup` and invites each person by name with a one-time
  code (`bell-pr group invite <name> [--admin]`); `bell-pr group status`
  says whether group work is not set up, ready or stopped. A person joins
  with the code through `POST /api/collab/join` and gets a participant
  token, sent in `x-bell-participant` next to the app token; an admin can
  remove a person and, when asked, unpair the device they joined from.
  Admin and member only decide who may invite and remove people, add
  repositories and revoke a hold (next entry). Without the switch nothing changes, except that a
  participant token is masked (under Changed). `docs/group-work.md`
  describes it.
- **The group's repositories, holds on files and folders, and a live feed,
  through the API.** A group admin adds a repository this BELL PR has
  (`POST /api/collab/projects`), and the group gets its own bare copy of
  its default branch in `collab/` in the data directory. Each person says
  what they are working on by taking a hold: a title and up to 50 files or
  folders (`POST /api/collab/projects/<id>/work`). A folder holds
  everything inside it, and letter case is ignored. BELL PR refuses a hold
  that meets one already held and names who holds what; `check` asks the
  same question without taking anything. The holder releases a hold, an
  admin revokes one, and removing a person ends what they hold.
  `GET /api/collab/projects/<id>/feed` answers with the repository's
  board, the people of the group and what is held now, and waits up to 25
  seconds for the next change. A hold does not stop a tool, an editor or a
  push outside BELL PR from writing to a held path; what BELL PR checks of
  its own writes is in the entry "BELL PR checks its own writes against
  other people's holds" below.
  The group's record keeps every ended hold and nothing cleans it up: once
  it is full (8 MiB) new holds are refused until the host resets group
  storage, which `docs/troubleshooting.md` describes. The paths that
  cannot be held and every limit are in `docs/group-work.md`.
- **With group work on, the data-directory lock is the strict one.** It is
  never replaced because of its age. After a crash that leaves a lock
  whose holder cannot be confirmed (another container or machine, an older
  build, an unreadable file), the next start is refused until a person
  removes the lock file. `bell-pr start --group` never reuses a BELL PR
  that runs without group work: it says to stop that one first and exits
  with 1.
- **The Group page: who holds what, in the app.** With group work on, the
  sidebar has a **Group** item (`#/group`). The page shows one repository
  of the group: its people and who is looking at the board now, and each
  hold with its holder, title, paths and time, kept current from the feed
  without a reload. Under **Start work** you type a title and paths, and
  the page says before you take the hold whether another one is in the way
  and whose; the answer updates by itself when the board changes. You
  release your own holds, and an admin revokes someone else's after one
  question. The person at the host starts group work and adds a repository
  there, an admin invites with a one-time code, and a paired device joins
  by typing it. A chip says whether the board is live, updated every 10
  seconds or reconnecting. Under **Must finish first** you tick the tasks
  that must be finished before yours starts, and your own hold has
  **Finish & release** (the task is done, so work that waits for it can
  start) and **Release only**. Using the same identity on another device
  and removing a person stay API-only. Without the switch the page says
  how to turn group work on, and the sidebar has no Group item.
  `docs/group-work.md` describes it.
- **BELL PR checks its own writes against other people's holds.** In a
  repository of the group, BELL PR publishes no change (first pull request
  or follow-up round) that touches a path someone else holds: the publish
  dialog lists the files and who holds them. A plan that covers such a
  path cannot be approved, Codex and Claude Code turns get other people's
  held paths read-only in the sandbox, and a teammate's change over one is
  not integrated. A turn that still changed such a file stops the run,
  with the change left in the checkout: the run page lists the files with
  **Put these files back** (**Put this file back** for one file; to the
  run's base, after one question; other changed files stay) and **Check
  again**, also
  `POST /api/runs/<id>/holds/restore` and `/holds/recheck`. A run keeps
  who started it (`owners`) and the files that stopped it (`heldPaths`).
  Sync and the first publish report commits on the target branch that
  changed files under your own hold. Work can wait for other work
  (`dependsOn`, releasing with `"done": true`, and
  `GET /api/collab/projects/<id>/tasks`). An editor, a terminal tool or a
  push outside BELL PR is not checked, and nothing is locked in a checkout
  or on GitHub. While group work has stopped, nothing is published and no
  turn that may change files starts in a repository of the group. Without
  the switch nothing is checked. `docs/group-work.md` has the details.
- **A coordination core for several people on one project, its integration
  not reachable yet.** `server/coordination.ts` grants claims on files all
  or nothing, waits for task dependencies, and moves a dedicated branch one
  checked change at a time, as `docs/multiuser-collaboration.md` describes.
  Only group work opens it: to add the people and the repositories of a
  group, and to claim, release and revoke for its holds. Nothing in the
  app, the CLI or any listener reaches its dependencies or its
  integration, and the core itself checks no write against a claim: the
  checks against holds are group work's (the entry above).
- **An admin can reopen a failed coordination task, in the core only.** The
  task keeps its claims, their reasons and fences, and records who reopened
  it and when. Members cannot reopen a task, and an integrated task never
  reopens. Nothing in the app, the CLI or any listener reaches it yet.
- **An interrupted integration the branch cannot settle when the
  coordinator opens closes only its own project, in the core only.** Other
  projects keep working; the closed one refuses every change, keeps its
  claims and fences, and shows the interrupted integration to anyone who
  reads it. An admin settles it once the branch is back at its base or its
  change; settling never moves the branch, and each project keeps its
  latest 10 settlements: who, when and what. While the coordinator runs, a
  failed write or an integration it cannot account for still stops every
  project until it opens again. Nothing in the app, the CLI or any
  listener reaches it yet.
- **Coordination never reads a commit-graph file, in the core only.** Git
  takes the parents and trees of the commits it walks to from that file,
  so one edited by someone with write access to the repository's directory
  could hide a file outside the claim, a merge or a non-fast-forward
  from the checks. Every coordination Git command now turns it off, even
  where the repository's config turns it on. Other files in that
  directory, such as object files, packs and alternates, are still trusted,
  and nothing in the app, the CLI or any listener runs those commands yet.
- **BELL Suite link (contract v1).** `BELLPR_SUITE_LINKS` tells this BELL PR
  where BELL Explain and BELL Personal are, on the same computer or tailnet,
  and a switcher between the BELL products shows once a link is set.
  `GET /api/suite/manifest` and `GET /api/suite/today` describe BELL PR and
  the runs that wait for you or for BELL PR: two counts and, for each run
  listed, its id and route, title, state with a fixed phrase, and time.
  Nothing else about a run is sent. Both stay behind the access token like
  the rest of the API, and no existing protection changes. No other BELL
  product can read the feed yet, because BELL PR has no read-only
  credential to give one. [BELL Suite link](docs/bell-suite.md) has the
  details.
- **Diagrams in the project analysis and the change explanations.** The
  analysis also returns its main flow as up to six short steps, and the
  reading section draws them as a diagram through the modules, under "How
  the modules fit together", with the flow's prose as its caption; a step
  whose path is not in the repository is drawn as outside it. Each file's
  plain-language example also returns its before and after as up to five
  steps each, drawn in the Before and After boxes with the steps that
  differ marked by border, icon and text for screen readers. The learning
  record export lists the same steps. BELL PR draws both from the
  Agent's short fields with its own HTML and CSS; the Agent writes no
  drawing. Analyses and explanations saved earlier load as before and show
  no diagram, and an explanation is not made again for it.

### Changed

- **The data-directory lock is written whole.** Where the file system
  supports hard links, a start writes its lock aside and links it into
  place, so no other start reads it half written. A stale lock is removed
  only after a start claims it, so two starts that find the same stale
  lock cannot remove the lock either of them then writes. A claim left by
  a start that stopped is cleared by the next start once its process is
  gone, and one that names no start, outside coordination, once it is 30
  seconds old;
  a claim that stays, like a lock that cannot be read, is named in the
  refusal. Without hard links, a start gives up a lock it wrote in place
  when another start had claimed it empty, so both cannot run; a leftover
  claim there can refuse a start until it is removed. A lock taken
  for coordination is never replaced until its holder is shown to have
  stopped; group work takes one. Tests now hold an integration after its
  last lock check, and put holders and starts in real separate PID
  namespaces where bubblewrap can make them: no start of this version
  takes such a lock, running, paused or expired. A lock a person removes
  or replaces while its holder runs is still outside that rule: an
  integration already past its last lock check still moves the branch.
- **A participant token is masked like other tokens, in every BELL PR.**
  Text shaped exactly like one (`bpc_` and 43 letters, digits, `-` or `_`)
  is masked in logs, Agent answers and drafts; a changed file that holds
  it is held back from review, and a draft that holds it cannot be
  published. This applies with or without group work. A longer or shorter
  name that starts with `bpc_` is left as it is.
- **Shorter, consistent interface text.** Sentences that differed from
  what BELL PR does are corrected, a fact repeated on the same screen is
  said once, long notices are split into one fact per sentence, and
  strings that were never shown are removed. One word now names one thing
  in both languages: for example "publish" (發布) for sending the PR,
  "working directory" (工作目錄) for where a run works, "repository" in
  Chinese text too (no longer 儲存庫), and "Agent" with a capital letter.
  The roles keep their English names, capitalised in both languages
  ("the Lead", "Reviewer", "Test analyst"), and Chinese text calls the
  command deny rules 指令 deny 規則, as the full access notice does. Several buttons and tabs were renamed: "Activity",
  "Overview", "Explain it back now", "Approve and preview the PR",
  "Publish Draft PR", "Check again" and "Code changes" among them. Saved
  runs and stored messages keep the wording they were saved with.
- **The docs link to the official documentation for outside facts.**
  Statements about Claude Code, Codex, Antigravity, the GitHub CLI,
  GitHub tokens, Ubuntu and Docker now link to the vendor's own page that
  states them, and the docs quote the current interface labels.

### Fixed

- **Sandbox messages name the real Settings section.** They pointed to
  "Settings → Models", which does not exist; they now say "Settings → AI
  provider". When Ubuntu's restriction on user namespaces stops the
  Antigravity sandbox, the error no longer offers signing in to Claude
  Code as a fix, because Claude Code's sandbox can need the same setting.
- **Sideways overflow on the overview and in the publish dialog.** The
  contribution directions stay a sideways row you can scroll (arrow keys,
  previous and next), and that row no longer pushes its section wider than
  the page. The run's tabs, the section links and the file list scroll
  from the keyboard: each is named and shows a focus ring. The diff stays
  one tab stop; the left and right arrow keys scroll its lines sideways.
  The publish description keeps its long lines, scrolls them with the
  arrow keys, and shows a fade on the side that still has more to scroll.
- **Other requests no longer wait while the server starts Git.** Before each
  Git command, the server read the repository's driver settings with a
  synchronous `git config`, so no other request was served until it
  finished. A keep-alive connection whose idle timeout passed during that
  wait was closed with the next request already on it, and a client that
  reuses connections without retrying, such as Playwright's request
  context, got `ECONNRESET`. The read now runs without blocking the server.
- **Every subtask after a failed one is now blocked.** When a subtask
  failed, a subtask that depended on it through another one could still show
  as waiting on dependencies if the plan listed it first. Every pending or
  ready subtask that depends on a failed or blocked one, directly or through
  others, is now blocked in the same step, whatever the plan's order, and
  that step starts no subtask. Subtasks that a restart of BELL PR stopped
  now block the subtasks after them in the same way. A dependency on a task
  the plan does not list, which only an edited data file can hold, no longer
  causes an internal error and never counts as finished: its subtask keeps
  waiting unless another dependency blocks it, and the run stops with "Task
  dependencies or file assignments stop the team from continuing".
- **The task board no longer shows failed subtasks as done.** Done now holds
  only integrated subtasks; a failed one stays in To do with its status. A
  subtask's dependencies used to read "Waits for" with their IDs, finished
  ones included; each is now listed by title with its current status, and a
  task the plan does not list shows as unknown. In a run that failed or was
  cancelled, a subtask whose dependencies are integrated shows "Ready after
  retry" instead of "Ready to claim", since nothing starts it until you
  retry. Long titles and descriptions, even with no space to break at, now
  wrap inside their card.
- **Codex's web search tool is now off while web access is off.** BELL PR
  passed Codex a search setting only with web access on. Codex searches a
  cached index by default, and live in a full access sandbox, so its agents
  could search the web with the switch off, in project analysis and
  discovery too (seen with Codex CLI 0.167). Every Codex turn now states
  the setting: `web_search="live"` with web access on, and
  `web_search="disabled"` otherwise.
- **Codex agents no longer get ChatGPT apps (connectors).** With a ChatGPT
  sign-in, Codex offers its apps to every turn. They include a web search
  tool that stays available with web search disabled (seen with Codex CLI
  0.167), and the run log did not record its queries. Every Codex turn now
  starts with `features.apps=false`, with web access on or off, as BELL PR
  already keeps your own MCP servers away from agents.

## [1.1.0] - 2026-11-04

The first release on npm's `latest` tag since 1.0.0. It also contains two
versions that never reached `latest`; CHANGELOG.md, in the package and the
repository, lists them in full:

- **1.1.0-beta.1**, a prerelease on the `next` tag, added Antigravity
  (Google's Antigravity CLI, `agy`) as a third AI provider, next to the
  Codex CLI and Claude Code. Its known limitations are repeated below.
- **1.0.1**, prepared but never published, added installation with a
  user-local shell script, a Homebrew formula, Bun or mise, and a warning
  when the installed Claude Code is outside the supported versions. It
  fixed Codex commands on Linux when `~/.ssh` holds files. It also stopped
  your Claude Code hooks from running in BELL PR's agent turns, and kept
  Codex from reading credential files that are symbolic links in `~/.aws`
  or the GitHub CLI config directory.

### Added

- **A warning when two of your contributions to one project change the
  same files.** Before a plan is approved, BELL PR compares the files it
  covers with your other unfinished contributions to that project: their
  plans while still to be carried out, what their checkouts changed, and
  what their pull requests change until that change is in this run's base
  commit or you read the pull request as merged or closed. Parts of one
  split never count against each other. The plan board then says which
  contributions change files this plan covers, and marks each task that
  touches those files with "Also changed in" and the other contribution's
  title. Approving needs the tick "I know these overlap; approve anyway".
  A plan that would start on its own waits for your approval instead, and
  so does a retried plan that was never approved. "This is my plan" in
  Learn by hand asks for a similar tick, "I know these overlap; confirm
  my plan anyway". The check reads only BELL PR's own records and
  checkouts on this computer and sends nothing.
- **The parts of a split keep their order.** Each part records the parts
  its tasks build on; splitting a part again passes this on, and deleting
  parts points what built on them back at their source. A split that would
  make a part build on more than 64 others is refused.
- **Two publish confirms under "Your other contributions here"**: one when
  another of your contributions to the project changes some of the same
  files, and one when a part of a split builds on parts that are not
  merged yet.
- **Let the agent set this up.** On a Full access run in review or
  approved, the "Setup this machine needs from you" checklist hands the
  commands you tick, at most 10 per turn, to one Collaborate turn. A dialog
  shows them word for word first, and nothing starts until you confirm.
  The turn runs without the sandbox and with your account. The agent is
  told to run only the ticked commands that match the project's
  documentation, changing them at most by adding non-interactive flags,
  running sudo as `sudo -n` and refreshing the package index, and not to
  change code or tests. It is told to rerun the checks the commands
  blocked and to report each item as installed, already present, failed
  or needs you; an item it does not report shows no result, and a turn
  that is stopped or fails reports none. A file the turn changes, such as
  a lockfile an install step rewrites, loses its review mark, and a change
  to the files or to the PR draft's Validation and Limitations returns an
  approved contribution to review. BELL PR refuses to hand over the
  command shapes it knows run fetched code: a downloader (curl, wget,
  aria2c, axel, fetch) that pipes, chains or substitutes, and a pipe into a
  shell or another interpreter. Any other command reaches the dialog as
  written, so read it before you tick it. sudo works only when it needs no
  password, and stopping the turn does not undo installs.

### Changed

- **Antigravity's models are listed once each, with their thinking levels
  as reasoning efforts**, as Claude Code's and Codex's are. The Antigravity
  CLI lists every level as a model of its own (Gemini 4 Argon Low, Medium
  and High), so the model picker showed each model up to three times. agy
  still receives the model IDs it listed. A model saved with its level, as
  1.1.0-beta.1 saved it, reads as that model and effort.

### Fixed

- A plan scope that names a directory of the base commit without its
  trailing slash (`src`) is read as that directory (`src/`), so the plan
  covers the files inside.
- On a Full access run, Antigravity's writing roles were told that curl,
  wget, the GitHub CLI and pushing are denied, though Full access lifts
  those denials; the note now names only what stays denied.

### Known limitations

These are 1.1.0-beta.1's limitations of Antigravity, which still apply:

- The Antigravity CLI cannot skip a project's customizations, so BELL PR
  does not start it in a project with Antigravity hooks, MCP servers,
  plugins, agents or skills. It still reads the project's `AGENTS.md` and
  `GEMINI.md`.
- Its web search cannot be turned off: with Antigravity, every agent can
  search the web, project analysis and discovery included.
- On Ubuntu 24.04 and later its sandbox cannot start
  (`kernel.apparmor_restrict_unprivileged_userns`), so writing roles are
  refused there unless unsandboxed agents are allowed.
- It saves every conversation under `~/.gemini/antigravity-cli/`.
- After you chose Antigravity, a 1.0.x version reports the model settings,
  the analyses Antigravity made and the discovery results as unreadable;
  [Upgrading](docs/upgrading.md#going-back-to-an-older-version) says how to
  recover. 1.1.0-beta.1 reports an Antigravity model chosen in 1.1.0 as
  unknown until you choose it again.

## [1.1.0-beta.1] - 2026-11-04

A prerelease on npm's `next` tag, to try the Antigravity provider before
it is released. The tag v1.1.0-beta.0 was never published: its release
stalled, and this version also gives the Antigravity sign-in check the
time `agy models` needs.

### Added

- **Antigravity as a third AI provider.** Agents can run through Google's
  Antigravity CLI (`agy`, checked with 1.5.0), which serves Gemini models,
  signed in with a Google account, a Gemini API key or Google Cloud
  credentials. The doctor, the setup checklist, onboarding, the settings and
  the model picker list it next to the Codex CLI and Claude Code; `agy models`
  gives the model list and is the sign-in check. Each turn gets permission
  rules for its role: read-only roles may not write, run commands or read
  the home directory off the way to their checkout, and no role may read
  credential files, the Antigravity CLI's own files or BELL PR's data
  outside its checkout, use MCP tools or the browser, or read pages unless
  web access is on. Writing roles run their commands in the Antigravity
  CLI's terminal sandbox, or without it only when you allowed unsandboxed
  agents. Four error codes have their own troubleshooting sections:
  `antigravity_missing`, `antigravity_unauthenticated`,
  `antigravity_sandbox_unavailable` and `antigravity_workspace_config`.

### Known limitations

- The Antigravity CLI cannot skip a project's customizations, so BELL PR
  does not start it in a project with Antigravity hooks, MCP servers,
  plugins, agents or skills. It still reads the project's `AGENTS.md` and
  `GEMINI.md`.
- Its web search cannot be turned off: with Antigravity, every agent can
  search the web, project analysis and discovery included.
- On Ubuntu 24.04 and later its sandbox cannot start
  (`kernel.apparmor_restrict_unprivileged_userns`), so writing roles are
  refused there unless unsandboxed agents are allowed.
- It saves every conversation under `~/.gemini/antigravity-cli/`.
- After you chose Antigravity, a 1.0.x version reports the model settings,
  the analyses Antigravity made and the discovery results as unreadable;
  [Upgrading](docs/upgrading.md#going-back-to-an-older-version) says how to
  recover.

## [1.0.1] - 2026-10-31

### Added

- Install BELL PR with a user-local shell script, a repository-hosted Homebrew
  formula, Bun or mise. A PowerShell helper prepares Ubuntu/Debian on WSL2;
  English and Traditional Chinese READMEs include setup and repeat-launch commands.
- English and Traditional Chinese landing pages offer npx, npm, curl, brew, Bun,
  PowerShell and mise installation tabs with keyboard navigation and copy buttons.
  The website serves matching shell, PowerShell and WSL helper scripts at short URLs.
- Settings → About links to the BELL PR website, which is also the npm
  package's homepage.
- `bell-pr doctor` and the setup checklist warn when the installed Claude
  Code is outside the supported versions (2.1.292 or later, before 2.2).
  Agents still start; the security model says why the version matters.

### Fixed

- **Codex commands start on Linux when `~/.ssh` holds files.** Codex's
  sandbox profile denied both `~/.ssh/` and `~/.ssh/**`. With any file in
  `~/.ssh`, such as `known_hosts` or `authorized_keys`, bubblewrap failed to
  start, so no shell command of a Codex agent ran, in read-only or writable
  roles. The profile now leaves out an entry that repeats another or lies
  inside a denied directory, such as a `credential.helper store --file` path
  inside `~/.ssh`. `~/.ssh` stays denied, file names included. Claude Code's
  rules are unchanged. The sandbox canary now fails a run whose output
  contains `bwrap:`, and checks without a model call that Codex's sandbox
  starts.

- **The npm package keeps the READMEs written for npmjs.com.** The package
  check in CI and in the release workflow packed the package again without
  `prepack`, over the tarball the workflow had just made, so a release would
  have checksummed, uploaded and published a package whose README still had
  links and screenshots npmjs.com cannot show. And `npm publish` may take
  either README as the package's (npmjs.com shows the Chinese one for
  1.0.0, with links into `docs/` that do not work there), while prepack
  readied only `README.md`; it now readies `README.zh-TW.md` the same way.
  `node scripts/check-pack.mjs` now packs into a temporary folder that it
  removes, and with `--tarball` checks the tarball that CI and the release
  workflow packed, as it is, including that no README in it has a relative
  link or image left. A release now publishes only from a pushed `v*` tag
  that matches `package.json`; started by hand, the release workflow only
  runs its dry run. The Docker image is pushed only after npm publish
  succeeded, and the GitHub release is created on the commit that was built.

### Security

- **Codex no longer reads credential files that are symbolic links in
  `~/.aws` or the GitHub CLI config directory.** On Linux, Codex leaves
  out symbolic links when it expands `**`, so a `~/.aws/credentials` or
  `~/.config/gh/hosts.yml` that a dotfile manager or vault links into
  place stayed readable: in every role with Codex CLI 0.159, and in
  read-only roles with 0.166, whose writable roles failed to start
  instead. Codex's profile now denies these directories themselves
  (`~/.aws/`, `~/.config/gh/`, and the directory `GH_CONFIG_DIR` or
  `XDG_CONFIG_HOME` moves gh to), as it already did for `~/.ssh`, so
  their file names are hidden as well and both roles start. A link's
  target outside the directory is still readable at its own path.
  Claude Code's rules are unchanged.
- **Symbolic links in the data directory and moved config directories.**
  When the data directory is reached through a symbolic link (macOS `/var`
  is `/private/var`), run and teammate checkouts keep the Git directory
  BELL PR recorded for them instead of being refused (`worktreeForged`).
  The lookup resolves the checkout and the directories above it, never the
  checkout's own `.git` entry. The credential paths that `GH_CONFIG_DIR`,
  `XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR` or `CODEX_HOME` move are denied
  to Claude Code both as given and at their physical path, also before that
  directory exists. Codex keeps getting the physical path only: on Linux,
  its sandbox does not start with a deny path that passes through a
  symbolic link.
- **Your Claude Code hooks no longer run in BELL PR's agent turns, and auto
  memory is off.** Hooks from your user settings and plugins ran outside the
  sandbox during every Claude turn, and auto memory kept notes about imported
  projects in `~/.claude/projects/` from one run to the next. Each turn now
  also leaves out your own `CLAUDE.md`, rules, output style and language
  setting, and a main-thread `agent` from your settings or a plugin's, which
  would replace BELL PR's system prompt and tools; BELL PR's prompt sets the
  output language. An output style that one of your plugins forces still
  applies to every turn. Your sign-in, `env` and default model still
  apply. BELL PR does not delete notes that earlier versions let Claude
  Code save; Privacy and your data says where to find them. In sandboxed
  turns, single sandbox values in your user settings that would weaken the
  sandbox, such as
  `sandbox.filesystem.disabled`, `sandbox.enableWeakerNestedSandbox` and
  `sandbox.network.allowAllUnixSockets`, are set back to their defaults.
  So is `sandbox.allowNestedUserNamespaces`, which Claude Code 2.1.305 added:
  on Linux it lets sandboxed commands create user namespaces and with them
  undo the sandbox's write denials, such as those on the checkout's `.git`.
  The security model lists the user settings that still widen what agents
  may do, such as `permissions.additionalDirectories`,
  `sandbox.excludedCommands` and your own proxy in
  `sandbox.network.httpProxyPort`. Your plugins' language servers and a
  `sandbox.ripgrep` command in your user settings still run outside the
  sandbox when a writable role works; disable plugins that bring language
  servers or force an output style on a computer that runs BELL PR. The
  sandbox canary checks that hooks and auto memory stay off, that a user
  `agent` is reset and that those sandbox values are set back, and its
  `--decoy-home` links only Claude Code's login file instead of your whole
  `~/.claude`.
- **Where sandboxed commands may also write, now documented.** Besides the
  run's checkout, commands of writable roles may write to the CLI's
  temporary folders: `/tmp` and `$TMPDIR` for Codex (its `:workspace`
  profile), and `/tmp/claude`, `~/.npm/_logs` and `~/.claude/debug` for
  Claude Code 2.1.292. This is not new in 1.0.1. Codex's profile does not
  deny BELL PR's data directory, so keep the data directory out of `/tmp`
  and `$TMPDIR` when Codex agents write code (the security model and the
  configuration guide say so). The READMEs, the FAQ and Settings → Agent
  safety now mention the temporary folders, and that your own Claude Code
  user settings can widen Claude Code's sandbox.

## [1.0.0] - 2026-10-30

Published to npm by hand, without provenance.

### Changed

- Desktop launches pass a private temporary file URL to the browser opener,
  keeping the API token out of opener arguments. Interactive headless starts
  show only `bell-pr open --print --print-token` as an explicit next step.

- Pairing QR codes prefill from a hash fragment, which is cleared before confirmation; query codes are ignored. Paired devices can list and revoke any device.

- Tighten CSP with explicit same-origin scripts and disabled objects; retain inline styles.

- **Reopen with the normal launch command.** `bell-pr` and `bell-pr start`
  reopen an instance already running with the same data directory, before
  checking doctor readiness. Interactive SSH and headless terminals print
  only `bell-pr open --print --print-token` as a hint. Noninteractive service output keeps the
  token private. Explicit `--no-open`, CI and development starts retain
  duplicate-instance protection.
- **`bell-pr start` waits for `bell-pr doctor` before starting a new server.**
  When a required check fails, start exits before it listens and prints the doctor's checklist
  with the command that fixes each one. `bell-pr start --force` starts
  anyway and prints a warning, which is how the sample tour opens when no
  AI provider is signed in. A real agent run is still refused until one is.

### Added

- Pathname `/pair` page with QR-code prefill, header-only device credentials, and Devices settings for revocation.

- **Collaborate before publishing.** A conversation with a writable agent can
  finish checks, fix failures and update the draft's Limitations section.
  Each turn records changed files and observed commands, invalidates reviews
  of changed files, and leaves approval and publication to you. Learn by hand
  remains read-only for agents.
- **Explicit full agent access.** Model settings can give writable roles full
  machine access, with an optional Linux sudo setup. Working directory (default)
  remains the default, and read-only roles keep their existing restrictions.
  Choosing Full access asks for confirmation. Doctor warns when Full access
  is saved and when the passwordless sudo rule file is installed. The sudo
  control is offered only on Linux.
- **Local API token.** The first start writes a random token to
  `<data dir>/api-token` (mode 0600) and later starts reuse it. API requests
  other than `GET /api/health` send `Authorization: Bearer` or
  `X-Bell-Token`. `bell-pr open` gives the token to the browser in the page
  address and prints that address without the token. `bell-pr open --print-token`
  prints the address with the token; add `--print` to only print it.
  `bell-pr token rotate` replaces
  the file; a running BELL PR uses the new token on the next request. The
  token is not in the startup line, the server log, or `bell-pr doctor --json`.
  Listening somewhere other than a loopback address is still an explicit
  `--host` or `BELLPR_HOST`, and BELL PR prints a warning when you do.

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

- **Session sign-in.** The session cookie, the one-time sign-in links, the
  `/auth` page and the `auth_required` error code stay removed. The local
  API token above is what a request must send instead.

### Changed

- **Agent sandbox deny list.** With the sandbox on, Claude Code and Codex
  are denied the GitHub CLI config files, `~/.git-credentials` and
  credential-store files, `~/.netrc`, and `~/.ssh/`. `GH_TOKEN` and
  `GITHUB_TOKEN` are removed from the agent process environment even when
  the sandbox is off. Tokens in the system keyring are not covered: the
  agent can still read a GitHub token via `gh auth token`. With the
  sandbox on, Claude Code also cannot write the checkout's `.git` file,
  the clone's git hooks or config, or a worktree `config.worktree`.
- **Server git.** Git commands BELL PR runs itself ignore repository hooks,
  file monitors, and other config that would run a program. Each checkout's
  git directory is recorded when its worktree is created and passed to git
  as `--git-dir` and `--work-tree`. With the sandbox on, Claude Code
  cannot write the checkout's `.git` path or anything under it.
  `GIT_ASKPASS` and `SSH_ASKPASS` are not passed to server git.
  `GH_TOKEN` is passed to `gh` and to git only when that git command
  talks to GitHub.
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

- **The language notice on Discovery matches the results you see.** When a
  new search found nothing, was stopped or failed, the page kept showing
  the previous results, but the note that they were written in another
  language looked at the new search instead. Chinese results could appear
  with no note, and English results could be labelled as Chinese. The note
  now follows the results on screen, and it no longer appears when there
  are no results.

- **A PR title with a stray space no longer stays unsaved.** If the title
  had a space at the start or end, saving said "Draft saved" but the editor
  kept the space. The server stores the title without it, so the draft still
  showed as unsaved, Approve stayed disabled with "save first", and
  switching runs asked to discard changes. Saving now trims the title and
  shows the saved title in the editor.

- **Ticked numbered checkboxes in a generated draft.** When a project's PR
  template used numbered checkboxes ("1. [ ]"), the generated draft could
  tick them for you, for example claiming you ran the tests or signed the
  CLA, and nothing flagged it before you published. BELL PR now rejects
  those drafts the same way it rejects ticked bulleted checkboxes.

- **Explanations keep the run's language.** After you switched the interface
  language, retrying a failed explanation, explaining a file you edited by
  hand, or asking for a Learn-by-hand explanation wrote the new card, its
  error message and its log entry in the new interface language. The panel
  still said the cards were in the run's language, so one run could end up
  with cards in two languages. Explanations now always follow the language
  the run started in.

- **Explanations follow a changed premise verdict.** If an explanation was
  being written while a premise check ran (for example after a Retry) and the
  check changed its verdict, the explanation written with the old verdict
  was still saved as finished and was never made again. It is now thrown
  away, and the explanation is made again with the new verdict.

- **One walkthrough job when a file is asked for twice at once.** If two
  tabs asked for the same file's walkthrough together, BELL started two
  agent jobs. The first agent could then no longer be stopped, and if one
  job failed, a good walkthrough was thrown away and both tabs showed
  "failed". Now the second request waits for the job already running and
  gets its result.

- **Dependency and build files no longer count as documentation.** A change
  to requirements.txt or CMakeLists.txt was treated as a docs edit, so a
  small dependency bump got no understanding-check question at all, and a
  larger one was never asked "What did you not test, and why?". The
  reviewability snapshot also called such a change docs-only. These files
  are now treated like package.json or a Makefile.

- **The understanding check keeps its questions current.** When a file's
  walkthrough finished, or a re-review changed the reports, while the check
  was open, the panel kept showing the old questions. Lock then failed with
  "Reload the check and answer again", and only a page reload helped, which
  lost the typed explanation and answers. The check is now read again when
  its questions can change. A refused lock also re-reads it, and what you
  typed is kept.

- **Each understanding check is timed from its own opening.** A re-check
  after a follow-up round, or a check after Start over, in the same tab was
  timed from the first time the check opened in that session. A four-minute
  check could be stored as 45 minutes, which pushed up the median check time
  in Settings > Learning. Each check is now timed from when it opens.

- **Claims written with a typographic apostrophe.** A comment such as
  "I’d like to work on this" or "I’m working on it", as GitHub's mobile apps
  and smart punctuation write it, was not recognized as a claim, so the
  confirm before starting never mentioned that someone had taken the issue.
  Those comments now count as claims, the same as with a typed apostrophe.

- **Help channels in reStructuredText guides.** In a CONTRIBUTING.rst, BELL
  read a `~~~` section underline as the start of a code block. It skipped
  the rest of the file, so Zulip, Discord or mailing-list links below the
  first such title never showed up in the card's channels or in the guide's
  "Ask a human". These guides are now read as reStructuredText, and channel
  links after any title are found with their line numbers.

- **One BELL PR per data volume, also across containers.** A second container
  started on the same data volume, for example during a rolling update, could
  take the lock from the running one. Both then wrote the same data. On Linux,
  BELL PR now renews its lock every 10 seconds, and other containers treat it
  as held while it stays fresh. A second container waits up to 30 seconds,
  then exits with a message. After `docker rm -f`, the new container starts
  once the old lock runs out.

- **A clock step no longer hides the running BELL PR.** If the clock jumped
  forward after BELL PR started, `bell-pr open` said nothing was running and
  a second start could take over the data directory. This happens on
  computers without a hardware clock, which set the time after boot. The lock
  now records the uptime and, on Linux, the boot ID. A clock step changes
  neither.

- **`bell-pr doctor` with an empty `--data-dir` or `--env-file`.** Ending the
  command with `--data-dir` and no path crashed it with a stack trace and
  exit code 1. A bare `--env-file` complained about a settings file named
  "true". Both now say "The option ... needs a value." and exit 2, the same
  as the other commands.

- **Freeing a run in Settings now updates the workbench.** If you freed the
  open run's files from Settings > Data & privacy, the workbench kept showing
  its old changes and still offered Explain it back and Split, which the
  server then refused. The run now shows its files as removed right away,
  just as when you free it from the contributions list.

- **Freeing a run's files in Settings keeps your keyboard place.** Confirming
  Free space in Settings > Data & privacy moved the focus to the top of the
  page, whether the free worked or failed. If the storage figures then failed
  to reload, the row stayed on "Freeing..." for good. After a free the focus
  now moves to Measure again. After a failure it goes back to the run's Free
  space button. The row always becomes usable again.

- **About from Settings stays on Settings.** In **Settings → About**,
  **About BELL PR** switched the page behind the dialog to Home, so closing
  it left you on Home with the keyboard focus lost. The dialog now opens over
  Settings and gives the focus back to the link when it closes; a click with
  a modifier key still opens it in a new tab.

- **Deleting a cancelled queued run no longer stops BELL PR.** If you
  cancelled a run that was still waiting in the queue and then deleted it
  (or deleted its project), the server stopped as soon as another run
  finished, and the runs queued behind it never started. Shutdown could
  also fail before stopping the running agents. The queue now skips runs
  that are gone, so the next run starts and shutdown completes.

- **Kept edits from an interrupted follow-up round can be pushed again.** If
  BELL PR stopped while a round's agent had made its own commit, the round
  came back for review but every push was refused because the branch had
  moved, and discarding the round (losing the edits) was the only way out.
  An interrupted conflict resolution left its run on the agent's commit the
  same way. At startup the branch now goes back to where it was before the
  agent ran, with the edits kept uncommitted for review and push.

- **Deeply nested Markdown no longer breaks a panel.** About 1,300 quote
  markers or 800 list markers in an agent's explanation, report or chat
  answer overflowed the stack, so the panel hit its error screen every time
  it opened. Text nested more than 32 levels deep now shows as written (see
  below), and deeper trees that remain show past a hundred levels as plain
  text.

- **Huge Markdown tables no longer freeze the tab.** Short table rows were
  always padded to the header's width, so 8 KB of agent text with a wide
  header over many one-cell rows made two million cells and could freeze or
  crash the tab. A document now adds at most 100,000 empty cells; past that,
  a short row shows only its own cells.

- **Footnotes heading is translated.** With the interface in Traditional
  Chinese, agent text that used a footnote still showed the English heading
  "Footnotes". It now shows "註腳".

- **Regenerating the suggestion no longer lifts the own-words check.** Once
  BELL's suggested description was in the draft, clicking Refresh (or
  regenerating after the diff changed, even if that run failed or was
  stopped) made the checks compare the draft only with the newest
  suggestion. The draft was still the old suggestion word for word, but
  approval and publishing went through on projects that ask for the
  contributor's own words. BELL now remembers the suggestion that is in the
  draft, so the description still counts as unrevised until you rewrite it.

- **Re-indenting Python or YAML is no longer called a whitespace-only
  change.** Moving a line in or out of a block, such as taking commit() out
  of a loop, was skipped by the understanding check like a spacing fix, so
  approval went through with no question about it, and the reviewability
  snapshot listed it as a whitespace-only change. A changed indent in these
  files now counts as a real change. Blank lines and spacing within a line
  still do not.

- **A rule that allows AI help no longer reads as a ban.** A contributing
  guide saying AI-assisted work is "not forbidden", "not prohibited",
  "will not be rejected" or "won't be declined" was taken as a ban of AI
  help. Agent runs on that project were blocked with no override, and
  Learn-by-hand runs lost the quoted confirm. A negated refusal word now
  refuses nothing, and a "not prohibited" sentence next to a real ban
  counts as its carve-out.

- **A failed run deletion is no longer lost.** While the list of all
  contributions deleted a run or freed its disk space, Ctrl+K, Escape or a
  click elsewhere could close the list, and if the request then failed no
  message appeared. The list now stays open until the request ends and shows
  why it failed, and Ctrl+K asks you to wait a moment.

- **Keyboard focus after leaving Home or the palette.** Home's start and
  **Continue where you left off** buttons, and the command palette's
  **Sample project** and **Settings**, left the keyboard and screen reader
  focus on the page body. The focus now moves to the new page's heading, as
  the palette's other commands already did.

- **About no longer closes another dialog.** Going Back to `#/about` (or
  typing it) while another dialog was open laid About over it, and closing
  About closed that dialog too, even while it was splitting a contribution or
  starting a task. About from the address now waits until the other dialog
  has closed.

- **Common AI bans are now found.** Rules such as "Do not send patches
  generated by an LLM", "Do not open pull requests with AI-generated
  code" and "Code must not be generated by AI" gave no finding. An
  agent-written change could be published to a project that refuses it.
  These now count as bans. Encouragement such as "Don't hesitate to open
  a pull request, even if you used AI tools" is no longer misread as one.

- **Free space on a run with an open follow-up round.** Freeing a published
  run's files while its follow-up or sync round waited for review deleted the
  checkout but left the round open. After that the round could not be pushed
  or discarded and no new round could start, so the run stayed in review until
  you deleted it. Freeing is now refused until you push or discard the round,
  and Settings stops offering it. A run already stuck this way can now be
  discarded, which puts it back to published.

- **Deeply nested PR text no longer fails the draft checks.** A PR body or
  a project's guidance nested thousands of quote or list levels deep
  overflowed the stack, so the draft, approval or publish check, and the
  request that ran it, failed. Such text is now checked. A body nested more
  than 32 levels deep is read as written, without parsing, and a disclosure
  or an issue link in it counts only when the text can be read, so a comment
  cannot satisfy the AI-disclosure or issue check.

- **Deeply nested text no longer keeps the page or the server busy.** The
  Markdown parser's time grows with the square of some nesting, so a few
  kilobytes of nested lists, quotes, footnotes, emphasis, strikethrough or
  links in an agent's answer or a PR body took seconds, and 60 KB took
  minutes before it overflowed. Text nested more than 32 levels deep now
  never reaches the parser: it shows as written, and the PR checks read it
  as written. Code counts against a looser limit, so pasted logs, license
  headers and stack traces still render.

- **Other slow Markdown no longer keeps the page or the server busy.** Text
  that does not nest could still take the parser one to twenty seconds at
  60 KB: closers with nothing to close ("a* a* …", "] ] …"), unclosed HTML
  ("<?", "<!--"), long runs of dots or URL punctuation, a bracket left open
  before many words, lists or quotes closing one after another, and long
  paragraphs of short lines. The same check now estimates the parser's
  work in one pass over the text: text it puts past 0.4 seconds shows as
  written, and the PR checks read it as written, as with deep nesting. Real
  Markdown stays well under that, long tables, fenced code and changelogs
  included.

- **An empty AI-assistance section no longer counts as a disclosure.** When a
  project required an AI disclosure and its PR template had a "## AI
  assistance" heading with only a comment under it, the checklist said the
  description already disclosed AI help, and publishing went ahead without
  one. The same happened with an empty "AI assistance:" or "**AI
  assistance**" label. Publishing now waits until the description actually
  says that AI helped: a sentence under the heading, a filled-in field, BELL
  PR's own line, or an Assisted-by trailer.

- **Piped test commands no longer count as passing.** When an agent ran a
  command such as `npm test 2>&1 | tail -40`, BELL PR recorded the exit
  status of `tail` as a successful check, and the suggested PR description
  could say all tests passed. Now, when a pipe, `||`, `;`, a newline or `&`
  could hide a failure, the success is marked "not verified", and the
  draft and the reviewers are told it is no evidence of a pass. A plain
  test command, or one joined with `&&`, still counts.

- **Split warning names the shared file.** When tasks for two different
  issues both changed one file, the split dialog blamed the first task as
  if it cited every issue, and it also said files could not be separated
  when only a dependency joined them. The dialog now names the files that
  hold changes for more than one issue ("src/index.js holds changes for #1
  and #2"). When no file does, it says the plan links the tasks and that
  their files can still be moved apart. The lead's plan no longer promises
  per-task commits or cherry-picks that BELL PR never makes.

- **The PR draft references every issue the task fixes.** A task that fixed
  two issues got a suggested description with "Fixes #1" only, because the
  draft read just the linked issue. The draft now also lists the project's
  issues that the task or its plan cites, with one "Fixes #N" line for each
  issue the change fully addresses and "Refs #N" for one it addresses in part.
  Several links in the issue field now say that it takes one and that the
  others belong in the task description.

- **The suggested commit message carries the AI trailer the project asks
  for.** When a project's rules ask for an `Assisted-by:` or `Generated-by:`
  trailer, the suggested commit message now ends with one naming the agent
  that wrote the change (Claude Code or Codex). Before, it was the PR title
  alone. The trailer reaches your commit message when you use the suggestion,
  and on its own only while the AI-assistance note is on for all drafts.
  Projects that do not ask get no trailer, and a message you wrote is kept.

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

This release candidate was never published to npm; its changes reached npm in
1.0.0.

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
