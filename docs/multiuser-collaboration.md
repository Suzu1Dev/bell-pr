# Multi-person collaboration: the coordination core

Status: design, and its first phase in code. The core is not reachable from
the app, the CLI or any listener yet, so BELL PR still has no protection
between people working on one project. Overlap warnings for one person's own
contributions (group mode) are unchanged.

## Decision

- **One coordinator per data directory** owns every participant's tasks,
  claims and the project's integration branch. It runs in the BELL PR
  process that holds the data-directory lock, so it is the only writer of
  its file. Participants never write coordination state themselves: no
  shared directory that each person's account writes to, and no link-file
  ledger. Several people, and later several machines, reach the same
  coordinator.
- **Identity comes from a token.** Each participant has a random `bpc_`
  token; only its SHA-256 is stored. Requests carry it in
  `x-bell-participant`, and the coordinator alone decides who is asking.
  Request bodies are strict, so a body cannot name an owner or holder.
- **BELL integrates into a dedicated branch.** It moves the branch forward
  one change at a time, and a person decides when that branch merges into
  `main`.

## What phase 1 guarantees

`server/coordination.ts`, with path rules in `server/scope-paths.ts` shared
with the group-mode overlap check.

- **Claims are all or nothing.** A claim names a project, task, participant
  and normalized scopes. Arbitration and persistence run in one serial
  queue. A claim exists only once it is written durably. Non-overlapping
  claims coexist.
- **Overlap** means the same path, or a directory above another path, in
  any ASCII case. A rename counts on both sides, and so does a file that is
  changed and then changed back.
- **Scopes that cannot be compared reliably are refused**, never guessed at:
  - non-ASCII text;
  - `.` and `..` segments, backslashes, empty segments;
  - segments with leading or trailing spaces, or ending in a dot;
  - Windows short names (`~1`) and characters Windows cannot store;
  - `.git` in any case, files BELL PR holds back, and the whole repository.
- **Dependencies:** a task's dependencies must be integrated before it can be
  claimed, authorized or integrated. A failed or unknown dependency refuses
  outright, until an admin reopens the failed one.
- **Only an admin reopens a failed task**
  (`POST /projects/:project/tasks/:task/reopen`, with an optional `reason`
  of at most 500 characters). Nothing changes when it is refused:
  - anyone else gets `403` `adminOnly`, before the task is even looked up;
  - an open or integrated task gets `409` `notFailed`; an integrated task
    never reopens.

  The task keeps its id, creator and dependencies, and every claim it had
  keeps its status, reason and fence. An ended claim stays ended, and the
  next claim takes a higher fence. That claim still needs integrated
  dependencies and free scopes. Reopening claims nothing, and leaves the
  tasks that depend on it as they are, failed ones included. Each
  reopening is kept on the task with who reopened it, when, and any
  reason given. A reopening runs in the same serial queue as claims and
  failures, so for the same task one always happens after the other.
- **Widening a claim** is arbitrated in one step while the old scopes stay
  held. A conflict changes nothing.
- **Claims never lapse.** Time, disconnects and restarts release nothing;
  claims come back from the file as they were.
  - Only the holder releases a claim, and only an admin revokes one.
  - Each grant takes a higher fence. An ended claim's fence authorizes
    nothing, including integration.
- **Integration** checks four things:
  - the holder and the fence;
  - integrated dependencies;
  - the branch is still where coordination left it, and at the participant's
    base;
  - every file of every commit, as a linear series of at most 200 commits.

  Each commit is compared with its parent, so a file added in one commit
  and removed in a later one still counts, and a rename counts as the old
  name removed and the new one added. File names are read exactly as Git
  stores them, from its NUL-separated output, never trimmed. Output in any
  other shape refuses with `503` and `details.reason: "unreadableChange"`.
  A name that cannot be compared reliably refuses with `400`
  `unreliablePath`, and one outside the claim with `403` `outOfScope`.
  Adding, changing or removing any of these refuses with `403`
  `needsManualHandling`, with `details.path` and `details.kind`, before
  the branch moves:
  - a file BELL PR holds back from publishing, such as `.env` or `*.pem`,
    in any ASCII case (`sensitive`); the examples it allows, such as
    `.env.example`, integrate;
  - a symbolic link (`symlink`) or a submodule (`submodule`);
  - any other file mode (`mode`).

  Every Git command coordination runs passes `--no-replace-objects` and
  `-c core.commitGraph=false`, so neither replace refs pushed into the
  repository nor a commit-graph file can change what a commit, its parents
  or its files are, even where the repository's config turns the
  commit-graph on.

  It saves its intent, moves the branch with `git update-ref <ref> <new>
  <old>` (a compare-and-swap), and then saves the outcome. A stale base is
  refused with the current head, so the participant syncs and retries.
  Nothing is overwritten.
- **Refuses what does not fit before anything changes.** One file holds
  at most 1,000 participants and 100 projects. Each project holds at most
  10,000 tasks and 100,000 claims, of which at most 1,000 are held at once,
  with 20,000 scopes together, each task keeps at most 100 reopenings, and
  each project keeps its latest 10 settlements. One participant holds at
  most 100 claims at once across all projects, with 2,000 scopes together.
  An addition leaves the whole file at most 8 MiB with the room below
  still free.
  - An addition (a participant, project, task, claim, scope or
    reopening) must also leave room for every held claim to end, every
    open task to close and every project to save an integration intent
    and keep 10 settlements, each at its longest.
  - Past a limit the addition is refused with `409` and
    `details.reason: "full"`. Memory, the file and the branch stay as they
    were, and the coordinator keeps answering. A task's 101st reopening is
    refused this way (`details.limit: "reopenings"`); no earlier one is
    dropped.
  - Releasing, revoking, failing a task, integrating, recovering and
    settling only spend that room, so they still work at the limit.
  - 8 MiB holds for a file whose additions all kept that room. A file an
    earlier build wrote kept none for settlements, so one near 8 MiB
    takes no additions after the upgrade until the room is free, and
    settling there can take it past 8 MiB by the settlement room (about
    5 KB a project). That still stays within the reader's limit (32 MiB,
    see [File format](#file-format)); nothing is written past it, and no
    rule about unknown keys or newer versions is loosened.
  - Every write is first read back by the same reader `open()` uses. An
    integration also checks that its outcome can be written before it
    moves the branch.
  - Overlap among held claims, and between a claim and the held ones, is
    found by sorting their scopes once, not by comparing each pair. The
    reader checks a file a build with higher limits wrote the same way.
    Reading and writing still take time in proportion to the file, and a
    write runs in the BELL PR process without yielding.
- **Fails closed.** These stop the coordinator, and it refuses everything
  until it opens again:
  - a failed write or a lost lock;
  - an integration whose branch update it cannot account for;
  - a missing, unreadable or newer file;
  - a file that breaks an invariant, such as overlapping held claims or an
    unknown holder.

  An integration that was cut off settles when the coordinator reopens. If
  the branch is at the change, the integration happened; if it is at the
  base, it did not.
- **An integration the branch cannot settle closes only its project.** If
  the branch is at any other commit, or cannot be read, when the
  coordinator opens, the intent stays in the file as it was, and that
  project refuses every change with `409` and
  `details.reason: "recoveryUndecided"`: defining, claiming, widening,
  releasing, revoking, failing and reopening tasks, authorizing,
  integrating and adopting a baseline. Its claims stay held, no fence is
  given out again, and nothing counts the integration as done. Any
  participant can still read the project, which shows the intent as
  `undecided`. Other projects keep working. The failures above still stop
  every project.

  Only opening closes a single project. While the coordinator runs, an
  integration whose branch update it cannot account for, or a write that
  fails, still stops every project, as above; nothing is closed one
  project at a time then. Opening again settles or closes each project
  from its own intent.
- **An admin settles it from the branch.** `settleRecovery()` (on the
  router, `POST /projects/:project/recovery/settle`) takes the intent as
  the project shows it, `{ claimId, fence, from, to, startedAt }`, and the
  `head` the admin saw. It runs in the same order as that project's
  integrations and writes the same durable way. It checks, in order:
  - the participant is an admin (`403` `adminOnly`);
  - the project is waiting on that exact intent (`409` `nothingToSettle`,
    or `409` `stalePending` with `details.pending`);
  - the branch, read again now: unreadable is `503` `branchUnreadable`;
    neither `from` nor `to` is `409` `branchElsewhere` with
    `details.current`; anything other than `head` is `409` `staleBase`.

  At `to`, the integration is completed as reopening would complete it. At
  `from`, the intent is cleared and its claim stays held under the same
  fence, so it authorizes and integrates again. Settling never chooses a
  commit, moves or deletes a ref, releases or revokes a claim, or adopts a
  baseline. Each settlement is kept on the project as
  `{ by, at, claimId, fence, from, to, startedAt, outcome }`.

## What it does not guarantee

- **No write-time enforcement.** `authorize()` is the check each managed
  operation must call before it writes. Nothing stops a shell, an editor, an
  agent's own tools or a direct push from writing outside a claim.
  - The integration check is the only enforced guard, and it applies
    afterwards. A diff checked afterwards is not a write guard.
  - An authorization holds only for its moment. Guaranteeing every write
    needs a confined execution environment that checks the fence where the
    write lands.
- **No semantic conflicts.** Disjoint files can still break each other.
- **One coordinator host, on its local file system.** The lock is a local
  lock; a network file system is not supported, and neither is a data
  directory that several containers or machines write. People on other
  machines are to reach that one host (phase 4), which is not the same as
  several hosts writing its data directory.
- **A single writer under the strict rule, not a fence.** Coordination takes
  the data-directory lock under a strict rule (`acquireWriterLock` in
  `server/index.ts`), and opens only with the lock that rule issued
  (`server/writer-lock.ts`) while it is still held on the same directory.
  - The lock is written aside and linked into place, so no start reads it
    half written, and it is marked strict.
  - A strict lock is never replaced because it was not renewed, however
    long ago that was. Nor, under the strict rule, is a lock written in
    another PID namespace (another container or machine), one with no
    namespace (an older build) or one that cannot be read. It stays until
    a person who knows its holder has stopped removes it; the refusal names
    the file.
  - In the same namespace a lock is replaced once its process is shown to
    have stopped: gone, written before the machine last booted, or not a node
    process. A host that crashed restarts; one that is paused, suspended or
    blocked keeps the directory.
  - An ordinary BELL PR start never replaces a strict lock. Its own locks
    keep the earlier rule: one written elsewhere counts as held while it is
    renewed (every 10 seconds, for a 30-second lease).
  - A host whose lock was replaced or removed refuses every write with
    `503` and `details.reason: "notSingleWriter"`, renews nothing and
    removes nothing. It finds out by reading the lock before each write and
    before moving the branch. That is a check, not a fence: a write already
    past it still lands.
  - Outside the rule: a person who removes a lock while its holder still
    runs; builds older than this one, which still replace a lock written
    elsewhere after its lease; two machines with the same host name and PID
    namespace id. On systems other than Linux there is no namespace to
    compare, so every lock counts as written on this machine.
- **No idempotency key.** A client whose reply was lost reads the project to
  learn the outcome.
- **Manual repair before a branch at a third commit is settled.** If a
  branch was moved elsewhere mid-integration, or cannot be read, nothing in
  coordination repairs it: a person puts it back at the base or the change
  by hand, and then an admin settles it. Until then that project stays
  closed. Whether the repair was the right one is that person's call.
  - A change to the ref made outside coordination is not ordered with
    its own steps. Finish the repair first, then settle; never settle
    while the repair is under way.
  - Settling, like opening, reads the branch and then writes. That read
    is a check, not a fence: a push or `update-ref` landing in between is
    not stopped, and the settlement then records a head the branch has
    already left.
- **Settlements are kept as a window, not a permanent audit log.** Each
  project keeps its latest 10; the next one drops the oldest, so settling
  is never refused for room.
- **The repository's files on the coordinator host are trusted.** They
  are assumed to be controlled only by whoever runs that host. Every
  coordination Git command ignores replace refs (`--no-replace-objects`),
  graft files (`GIT_GRAFT_FILE` set to the null device, so `info/grafts`
  is never read) and commit-graph files (`-c core.commitGraph=false`,
  which the repository's config cannot turn back on), and every check
  sees each commit's own parents. A shallow history shows a commit without
  its parent, which is refused. In the tests, a commit-graph Git wrote and
  that was then edited, as one file (`objects/info/commit-graph`) or a
  split chain of one layer (`objects/info/commit-graphs/`), to hide a
  commit outside the claim, a merge's second parent or a non-fast-forward,
  or to give the base another tree, is refused with the branch, the claims
  and the file left as they were; a chain of several layers is not
  tested. Writing these files takes write access to the repository's own
  directory, which a push does not give. Nothing here protects against a
  process that can change files there directly, such as object files,
  packs or `objects/info/alternates`, and what such changes do to the
  checks has not been tested. Mounting coordination in the product has to
  keep that directory out of reach of everyone but the host.
- **Names shown inexactly.** Scopes are printable ASCII and a path's ASCII
  parts decide every rule, so decisions are exact. A name that is not
  UTF-8, or a multibyte name split between two reads of Git's output, can
  still show U+FFFD in a refusal's message and in `details.path`, which is
  then not the file's exact name.
- **The file keeps every ended claim and every reopening.** Compaction
  comes later. Until then, a project that reaches its claim limit, or a
  file that reaches its byte limit, takes no new additions; nothing is
  deleted automatically. Each held claim keeps about 3 KB free so that it
  can end with the longest reason. At 8 MiB, that allows roughly 2,200
  claims held at once, each with its own task and one short scope.
- **Team runs do not share these rules yet.** Their scope check
  (`team.ts scopeContains`) is still case-sensitive.

## File format

`coordination.json` in the data directory:
`{ format: "bellpr-coordination", version: 1, revision, participants, projects }`.

- It is written with `writeDurable` and read with `lenientRead`.
- The reader takes up to four times each writer limit, the file's size
  included (32 MiB). A file that a build with higher limits wrote still
  opens and settles. A larger file refuses to open.
- Keys a newer build adds survive this build's writes.
- A task may have `reopenings`, oldest first, each
  `{ by, at, reason? }`. The key is optional: a file without it reads as
  before, and an older build keeps it on the task when it writes. An
  older build has nothing to enforce about it, so `version` stays 1.
- A project may have `recoveries`, oldest first, at most 10, each
  `{ by, at, claimId, fence, from, to, startedAt, outcome }` with
  `outcome` `integrated` or `notIntegrated`. The key is optional and an
  older build keeps it when it writes.
- An undecided project is not written down as such: it is a project
  whose `pending` intent the branch cannot settle when the file opens. An
  older build that opens such a file finds the same intent and refuses
  to open at all, as before, so it skips no protection, and `version`
  stays 1.
- An unknown status, role or version refuses to open.
- A newer build that adds a field this build would have to enforce must
  raise `version`.

## Phases

1. **Core, behaviour tests, this document.** The router
   (`server/coordination-routes.ts`) exists but is not mounted.
2. **Wire it into the app.**
   - Mount the router in `createApp` behind the existing app authentication.
   - Give admins participant management in the CLI.
   - Make each managed write call `authorize` and carry the fence:
     - `POST /api/runs/:id/plan/approve` (agents start), `/team/retry` and
       `/split`;
     - `/sync`, `/sync/resolve` and `/sync/undo`;
     - `/approve`, `/publish` and `/publish/recover`;
     - the by-hand steps;
     - follow-ups.
   - Move team runs onto the shared scope rules.
   - Before the router is mounted:
     - Any member may claim an open task, as now. Done in the core: a
       failed task reopens only through an admin's step, an integrated
       task never reopens, and a reopen keeps the task's history and
       fences. Like the rest of the core, nothing reaches it yet.
     - An undecided recovery closes only its own project. Done in the
       core: an admin settles it through an audited step, while other
       projects stay available, and the undecided project stays closed
       until then. Nothing resets a branch or clears an intent on its own.
       Like the rest of the core, nothing reaches it yet.
     - The process that mounts the router takes the lock with
       `acquireWriterLock` itself and gives that lock to the coordinator.
       Today nothing outside the tests calls either, and an ordinary
       start's lock is refused.
     - Tests cover the window between the last lock check and
       `update-ref`, and a lock written in a real other PID namespace, not
       only a simulated one.
     - Large files are handled: on one Linux machine a write took about
       0.3 seconds at 8 MiB and an integration about 0.6, and near the
       reader's 32 MiB about 1.1 and 2.4 seconds with about 900 MB of
       memory. Each write runs in the BELL PR process without yielding.
   - Until phase 5, nothing describes writing together as protected.
3. **Show it in the interface** in both languages: claims, conflicts,
   dependency state and the integration queue.
4. **Reach it from other machines** through a reviewed remote listener.
5. **A confined write environment** that enforces claims on every file
   write.

## Phase 1 is complete when

`server/coordination.test.ts` and `server/coordination-race.test.ts` pass.
They race real client processes against one host process, on temporary
directories and repositories, and cover:

- one winner per contested scope, while disjoint claims coexist;
- dependency refusals;
- a failed widening that keeps the claim;
- holder-only release and admin-only revoke;
- forged identities;
- failed writes that grant nothing;
- a host killed mid-race that never grants twice after restart;
- revoked fences that authorize nothing;
- reopening a failed task: by an admin only, refused for members, forged
  identities and open or integrated tasks without changing anything; old
  claims and fences kept and ended; dependencies still refusing; one claim
  winning when clients race for the reopened task; failed writes, its
  limits and a restart;
- one winner when two integrations start from the same base;
- recovery at each integration step;
- an integration the branch cannot settle on one of two projects, across a
  killed host: every change to that project refused without changing
  anything while the other project claims, authorizes and integrates; a
  settlement refused for members, forged identities, extra fields, stale
  intents, a third commit and an unreadable branch without changing
  anything; two admins racing to settle with one winner; the claim kept
  under its fence or the integration completed; a failed write and a lost
  lock; the latest settlements kept up to their limit, with room for them
  kept free, within the byte limit; and both kept across restarts;
- each limit refusing the next addition without changing anything, while
  held claims still end, integrate and recover, and the file reopens;
- replace refs, graft files, shallow lists and commit-graph files (one
  file or a split chain of one layer, even with the repository's config
  turning them on) that would hide a file, a merge or a non-fast-forward;
- a paused host keeping its lock however old it looks, against starts in
  its own and in another (simulated) PID namespace, and giving it up when
  closed;
- a host whose lock was replaced refusing every write, and one start
  winning a lock that a killed host left;
- secrets, links, submodules and names with control characters, in any
  commit of a change, refused while the branch and other claims stay as
  they were, and ordinary files integrating;
- conflicts naming exactly the held claims a pair-by-pair comparison names.

`server/scope-paths.test.ts` checks that the sorted overlap check agrees
with the pair-by-pair rule.

Typecheck, lint, i18n and docs checks pass.
