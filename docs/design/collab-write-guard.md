# Design: holds that stop writes (group work gap G1)

Status: draft for review. Written against
`feat/collab-work-depends-on` at 9272696. S1 is implemented on
`feat/collab-write-guard` (`server/hold-guard.ts`, tests in
`server/hold-guard.test.ts`), S2 on `feat/collab-write-guard-turns`
(tests in `server/hold-guard-turns.test.ts`), and S3 on
`feat/collab-write-guard-sandbox` (`heldWriteTargets` in
`server/sandbox.ts`, tests in `server/hold-guard-sandbox.test.ts`).

## The gap

With group work on, a hold stops only another hold. A person, an editor or
a BELL PR agent can still change, commit and push a file that someone else
holds ([group-work.md](../group-work.md), "Not promised"; QA of PR #72,
gap G1). The requirement is that several people work at once through
BELL PR, and that a file one person holds cannot be changed by another
person's work through BELL PR at the same time.

This design covers the writes BELL PR makes or controls. It does not try
to stop writes BELL PR never sees. For those it says what can be detected
and where.

## Terms

- **Someone else's hold**: a held claim in the group's project for the
  run's repository whose holder is not one of "you" (next section).
- **Meets**: the rule holds already use for each other (`pathsMeet` in
  `server/scope-paths.ts`). A changed file meets a hold when it is the
  held path or lies below a held folder, in any ASCII case.
- **Changed paths**: every path in the run's diff against its base.
  `readDiff` runs with `--no-renames`, so a rename shows up as a delete
  plus an add, and both paths are checked.

## Who "you" are

Runs do not record who started them today, and the web app sends no
participant token. The guard decides who "you" are like this:

1. If the request carries `x-bell-participant`, "you" is that person. An
   unknown or removed token is answered 403 `notJoined`, as on
   `/api/collab`.
2. Without it, "you" is everyone still in the group who joined from the
   device the request comes from. The host's install token counts as one
   device ("at the host"). A paired device already holds the participant
   tokens of the people who joined from it, so this gives the device no
   power it does not already have.
3. Work with no request behind it (an agent turn, from slice 2 on) uses
   the owner saved on the run when it was started, worked out by rules 1
   and 2. A run started before group work was on, or by a device nobody
   joined from, has no owner. For such a run, every hold counts as
   someone else's.

Roles stay as they are: they are not a security boundary
([group-work.md](../group-work.md)). The guard keeps honest people from
overwriting each other by accident. It does not stop a member who works
around BELL PR on purpose.

## Every write path BELL PR controls

Line numbers are at 9272696.

| Write | Where it happens | What it writes | Where to check | Slice |
| --- | --- | --- | --- | --- |
| First publish: commit and push, then open the PR | `publish()` `server/publish.ts:621`. The diff is read at `:647`. Block-level checks are enforced at `:743` | A commit in the run's checkout, a push to GitHub, a PR | After `ctx.diff(id)` at `:647`, before the follow-up branch at `:665` | S1 |
| Follow-up publish: commit and push to the existing PR | `publishFollowUp` `server/publish.ts:994`, entered from `:665` | A commit and a push | The same place. A follow-up returns at `:665`, before `publishChecks` runs at `:736`, so a check placed only in `publishChecks` would miss follow-ups | S1 |
| Publish dialog (read only) | `GET /api/runs/:id/preflight` `server/routes/review.ts:83`, which calls `publishChecks` `server/publish.ts:142` | Nothing | Add the same result as a `block` check, so the dialog shows it before Publish is pressed | S1 |
| Approve | `approve()` `server/publish.ts:305` | Only the approval fingerprint | Optional early warning. The check that counts is at publish | S2 |
| Agent turns in a solo run | `runAgent` `server/run-executor.ts:105` | Files in the run's checkout | After each write-role turn: compare changed paths with holds | S2 |
| Team teammates | Each teammate's checkout, merged in `server/team-workspace.ts:150-170`, which already refuses files outside the task (`outOfScope`, `:160`) | Files in the teammate's checkout, then in the run's | Next to `outOfScope` at `:160` | S2 |
| Team lead: integration and coordination turns | `server/run-executor.ts` after `executeTeamTasks` | Files in the run's checkout | After each turn, as for solo runs | S2 |
| Plan approval: agents start | `POST /api/runs/:id/plan/approve` (`server/routes/runs.ts:19`), team plans in `server/team-plan.ts:46`, automatic approval at `server/run-executor.ts:803-810` | Nothing yet. It lets agents write | Plan files that meet someone else's hold: refuse to approve, the way `planOverlaps` holds a plan back today | S2 |
| Team retry and split | `/team/retry` `runs.ts:51`, `/split` `runs.ts:97` | Agents write again. A split makes new checkouts from parts of the diff | The same agent-turn and publish checks apply to the new runs | S2 |
| Follow-up rounds | `POST /api/runs/:id/follow-ups` `server/routes/follow-ups.ts:17`, `server/followup-runs.ts:96` | Agent turns in the checkout | After each turn | S2 |
| Session messages | `POST /api/runs/:id/session/messages` `server/routes/session.ts:8`, `server/session-runs.ts:73` | Agent turns in the checkout | After each turn | S2 |
| Sync, sync resolve and undo | `server/routes/sync.ts:10-16` | Sync merges the target branch into the checkout. Resolve is an agent turn. Undo puts the checkout back | Resolve: after the turn. Sync also reports commits on the target branch since the holder's hold was taken (`heldChanges`), and undo clears them | S2 for resolve, S4 for sync |
| Learn-by-hand edits | The person's own editor, in the run's checkout | Files in the checkout, by hand | Plan approval (step files) and publish. Nothing sees keystrokes | S1 publish, S2 plan |
| Recover a failed publish | `recoverPublish` `server/publish.ts:406` | Local only. It releases an unpublished commit and never pushes | None needed | — |

No route takes file contents from a client and writes them into a
checkout. The server itself writes into checkouts only through Git (sync,
undo) and conflict-marker labels (`server/sync.ts:213`).

## The rule

For a run whose repository is in the group (`side.projects[*].repoId ===
run.repoId`):

- Each changed path is compared with every held claim of that project
  (the same data `inTheWay` in `server/collab-board.ts:49` reads).
- Claims whose holder is one of "you" are skipped.
- Any meeting claim is a conflict. The answer lists, for each changed
  path, the hold it meets: `claimId`, holder's name, title and `since`.
- The rule is the same on every branch. A hold covers the repository, not
  one branch, because a change on any branch can reach the default
  branch.
- A changed path that cannot be compared (`comparablePath` is false) is
  refused, the way `authorize` refuses `unreliablePath`. In practice
  `readDiff` already marks such files `blocked`.
- Repositories outside the group, and BELL PR started without `--group`,
  are not checked. The promise that nothing changes without `--group`
  stays true.
- If group work is on but not ready (stopped, `notSingleWriter`,
  damaged), runs of the group's repositories cannot be checked. They are
  refused with 503 `holdsUnknown`, so the guard fails closed. Starting
  without `--group` is the documented way out, and it turns the guard off
  too.

The answer is true at the moment it is given, like `check`. The section
"Races" covers what that leaves open.

The check needs the group's state from inside the workbench, which does
not know about group work today. Add a small port, built from the
`CollabHost` in `server/index.ts:796`, and give it to the workbench only
when group work is on:

```ts
interface HoldGuard {
  /** undefined: the repository is not in the group. */
  conflicts(input: {
    repoId: string;
    paths: readonly string[];
    you: { participantToken?: string; deviceId?: string } | { ownerIds: string[] };
  }): HeldConflict[] | undefined; // throws 503 holdsUnknown when not ready
}
```

It reads `host.coordinator().project(...)` and the side file. It writes
nothing and takes no lock.

## What happens on a conflict: refuse, not warn

| Point | Behaviour | What the person sees |
| --- | --- | --- |
| Publish and follow-up publish | Refused with 409 `heldByOther`. Nothing is committed or pushed. The checkout is left as it is | The publish dialog lists the files, who holds each, the hold's title and since when. Ways out: ask the holder to release, ask an admin to revoke, or take those files out of the change |
| Publish dialog | A `block` check `held-by-other`. It cannot be ticked away, and it is not in `overridableCheckIds` | The same list, before Publish is pressed |
| Agent turn (S2) | The run stops with `heldByOther` after the turn. Nothing is reverted or deleted | The run page lists the files and their holders, with two actions: "Put these files back" (restore them from the run's base, a new step) and "Check again" (after a release) |
| Plan approval (S2) | Approval refused with 409 `heldByOther`. An automatic approval waits instead, as `planOverlaps` does today | The plan lists the held files. Revise the plan, or wait for a release |
| Taking a hold (S4) | Still granted. The answer adds `changing`: other people's unfinished runs whose diffs already meet the new hold | "Ben's run 'Users API' already changes `src/api/users.ts`" |

Why refuse rather than warn:

- The requirement is that conflicting files are stopped.
- A tick-to-continue warning already exists for one person's own runs
  (`group-own-overlap`, `server/group-local.ts:369`). That check stays a
  `confirm`.
- Release and revoke already exist, so a refusal is never a dead end.
  An admin can always unblock.

Draft wording, for Muse to review:

- en: "Someone else holds files this change touches, so nothing was
  published. `src/api/users.ts`: held by Ada for "Users API" since 10:42.
  Ask them to release it, or ask an admin to revoke the hold."
- zh-TW: 「這次的變更動到別人佔用的檔案，所以沒有發布。`src/api/users.ts`：Ada 為「Users API」佔用（10:42 起）。請對方釋出，或請管理員收回這項佔用。」

These use the dictionaries' existing words (佔用 for hold, 釋出 for
release).

## Telling agents their scope (S2, S3)

1. **Prompt (S2).** Every write-role prompt gets one block: "Other people
   hold these paths. Do not create, change, move or delete anything at or
   below them:" followed by the list (paths only, no names or titles). If
   the run's owner holds paths, the block also says "Your own work is
   under:" followed by those paths. The prompt builders are under
   `server/prompts/` (setup, team, followups, sync). The list is read
   again before each turn, so a hold taken mid-run reaches the next turn.
   Names and titles stay out because they are text other people typed,
   and keeping them out keeps them from acting as instructions.
2. **Check after the turn (S2).** This is the guard that counts. A prompt
   is a request, not a rule. The stop it makes keeps names and titles for
   the person; later turns' history, a retried teammate task and the PR
   draft get a line with the paths only (`heldPaths` on the session
   message or the team task), for the reason above.
3. **Sandbox denies (S3, defence in depth).** The sandboxes can already
   deny writes to single paths. Codex profiles mark `.git` as `"read"`
   (`codexSandboxConfig`, `server/agent-cli.ts:202`), and Claude Code gets
   `sandbox.filesystem.denyWrite` (`server/agent-cli.ts:371`,
   `agentGitWriteDenials` `server/sandbox.ts:631`). Held paths could be
   added the same way. Caveats to verify before shipping:
   - bubblewrap fails to start on a deny under an already-denied
     directory, and on a deny through a symbolic link (both noted in
     `server/agent-cli.ts:138-150`).
   - A held path may not exist yet in the checkout.
   - A deny is case-sensitive on Linux, but holds fold ASCII case.
   - Claude Code's Edit and Write tools also need `permissions.deny`
     entries.
   - Antigravity and unsandboxed runs (`run.unsandboxed`) get no deny.

   So S3 makes the agent's write fail on the spot. It never replaces
   step 2.

   What S3 does (verified on Linux, not yet on macOS). A write turn's
   `held` paths are the `others` of the turn's hold scope, read again per
   turn. `heldWriteTargets` looks each one up in the turn's checkout one
   folder at a time, ignoring ASCII case, and names every spelling it
   finds. Codex gets each as `"read"` in its profile; Claude Code gets
   `Edit(//path)` and `Edit(//path/**)` deny rules (Edit, Write and
   NotebookEdit; with or without its sandbox) and, inside its sandbox,
   `denyWrite` for the paths that exist. Antigravity, Codex with full
   access and read turns get nothing. The caveats above, as found:

   - Codex 0.167.0 with bubblewrap 0.11.1 (`codex sandbox`, no model
     call): a read-only file cannot be written, deleted, or renamed over
     ("Device or resource busy"); a read-only folder takes no new file;
     their neighbours stay writable. A folder and a file below it, or
     `X` and `X/**`, both start. A missing file in an existing folder
     starts and cannot be created. A missing folder starts, but Codex
     makes the first missing folder read-only, so other files in it
     could not be created either: such paths are left out. A path through
     a symbolic link, or that is one, stops the sandbox from starting
     ("cannot enforce sandbox read-only path … because it crosses
     writable symlink"): left out. A path with `[` or `]`, which holds
     allow, also stops Codex from starting ("filesystem glob path … only
     supports `deny` access"): left out of the Codex profile only.
   - Case: only spellings that exist when the turn starts are covered. A
     new file in another spelling is found by the check after the turn.
   - Claude Code 2.1.321 (one Haiku turn): the Edit tool on a file in a
     held folder and the Write tool on a missing held file were refused
     ("File is in a directory that is denied by your permission
     settings"); Write on a free file worked. Its Bash sandbox could not
     start on this host at all, with or without held paths
     (`apply-seccomp: write /proc/self/setgroups`, with
     `kernel.apparmor_restrict_unprivileged_userns=1`), so `denyWrite`
     for held paths is unverified and gets only paths that exist.
   - At most 200 paths (`maxHeldWriteTargets`); a path below another one
     in the list, `.git`, and `..` are left out.
   - Renaming a folder above a held path is not refused: the rename needs
     write access only to the folder that contains it, and making that
     read-only would refuse other people's files there too. Each command
     gets a fresh sandbox, so after `mv a a2` the next one no longer
     guards `a2/held.txt` and can change it (found in QA, F-7). The check
     after the turn is the only protection here: `a/held.txt` is gone from
     its held path, so the turn stops.

## What cannot be guarded, and how to detect it

BELL PR cannot stop:

- edits in a person's own clone or editor outside a BELL PR run, and
  pushes from it straight to GitHub;
- edits on GitHub's website, and agents run outside BELL PR;
- Learn-by-hand typing as it happens (only its result, at plan and
  publish);
- writes by unsandboxed or Antigravity agents as they happen (the check
  after the turn still applies).

What can be detected, and where:

- **At publish (S1).** Every change that leaves through BELL PR is
  checked, however it was written (agent, by hand in the checkout, a
  sync).
- **At the holder's sync and publish (S4, implemented).** `POST .../work`
  records `knownBranchTip` for the active hold in `collab.json` (`holds`),
  removing it when the hold ends (`release`, `revoke`, or member removal). At
  `POST /api/runs/:id/sync` (unpublished runs and published PRs) and at
  first `GET /api/runs/:id/preflight` / `POST /api/runs/:id/publish`,
  `heldUpstreamChanges` walks first-parent commits (`--first-parent -m
  --no-renames`) across `<hold base>..<target>` for the caller's own active
  holds, reporting `heldChanges` (`{ path, commits }`, 7-char SHAs only,
  never commit subjects) in `SyncPanel` and the run log, and requiring
  `held-changed-upstream` (`confirm` under **File holds**) before first
  publish.
- **When checking or taking a hold (S4, implemented).** `POST .../check`
  and `POST .../work` return `changing: CollabChanging[]` via
  `changingRuns` (`server/group-local.ts`), listing other people's
  unfinished runs whose checkout diffs, active plans or unmerged PRs meet
  the asked or held scopes, with active group member names in `owners`
  (excluding removed people and the caller's own runs).
- **Opt-in local hook (later, not planned yet).** `bell-pr group hook`
  installs a pre-push hook in a person's own clone that asks `check` about
  the pushed paths. It can be skipped with `--no-verify` and needs the
  device to reach BELL PR, so it only warns.

## Races and limits

- **Check, then push.** A hold taken after the publish check and before
  the push lands is not seen. The window is the push itself, a few
  seconds. Closing it would mean holding the group's lock across a network
  push, which blocks every hold in the group. Not worth it in S1. The S4
  holder-side detection reports such a push afterwards.
- **Holds never expire (G3).** With a refusing guard, a forgotten hold now
  blocks other people's publishes until an admin revokes it. Admin revoke
  already exists. G3 becomes more urgent but stays a separate decision.
- **Holds through a symbolic link.** Git records a change at the real
  path, so a hold on `alias/users.ts`, where `alias` is a committed link to
  `src/api`, never met a change to `src/api/users.ts` (Rigel's QA of #79,
  D-1). Taking a hold now refuses, with 400 `invalidScope`, a path that is
  a symbolic link, or goes through one or into a submodule, on the default
  branch of BELL PR's clone of the repository, in any ASCII letter case:
  on a disk that does not tell case apart, `ALIAS/users.ts` opens `alias`
  (Rigel's QA of #80, F-2). One `git ls-tree` per folder level, since
  ls-tree matches paths in their exact case. A link committed upstream
  after the clone was last updated is not seen. When the branch cannot be
  read, the hold is taken as before and
  the host's log says so: taking a hold writes no file. Resolving the link
  to the real path instead was left out.
- **Costs.** One project read and one pass over the changed paths per
  publish. `scopeParents` makes that one sort. Publish already reads the
  diff, so S1 adds no Git process.

## Tests

S1 (all in-process, with a group set up through `test/collab-fixture.ts`
as in `server/collab-board-routes.test.ts`):

1. Ada holds `src/api/users.ts`. Ben's run changes it. Ben's publish gets
   409 `heldByOther` naming the path, Ada and the title. Nothing is
   committed (`HEAD` unchanged), nothing is pushed (fake `gh` and remote
   see no call), and the run's status is unchanged.
2. The same with a case variant (`SRC/API/Users.ts`), a file below a held
   folder, a deleted held file, and a rename out of a held folder (old
   path). All are refused.
3. Changes next to a hold go through. With Ada holding
   `src/api/users.ts`, Ben's change to `src/api/index.ts` is published.
   With Ada holding `src/api`, Ben's change to `src/apiary/x.ts` is
   published. This is the folder-prefix case from QA H11.
4. Ada publishes her own run over her own hold: allowed, with the
   participant header and, separately, by device only.
5. Two people joined from one device: either one's hold counts as "you"
   from that device. From another device it counts as someone else's.
6. A follow-up publish is refused the same way. This is the regression
   for the `:665` early return.
7. The preflight lists `held-by-other` as `block`. `acknowledged` and
   `overrides` do not lift it (`overrides` with that id gets 400).
8. After Ada releases, Ben's publish goes through. After an admin revoke,
   the same.
9. A repository not in the group, and a server started without
   `--group`: no check, and the publish behaves exactly as before. This is
   the "nothing changes" promise.
10. Group work stopped (`notSingleWriter`): publish of a group repository
    gets 503 `holdsUnknown`. A repository outside the group still
    publishes.
11. Both dictionaries have the new messages (the existing key-parity
    test).

S2 adds agent-turn tests with the fake agent CLI the run tests already
use: a turn that writes a held file stops the run and leaves the file; a
turn that does not, continues; the prompt contains the held paths and not
the titles; a team teammate's diff that meets a hold is refused next to
`outOfScope`; plan approval is refused, and automatic approval waits.

## Slices

- **S1, recommended first slice: refuse publishing over someone else's
  hold.** Add the `HoldGuard` port. Check in `publish()` after `:647` and
  before `:665`, so first publishes and follow-ups are both covered. Add
  the `held-by-other` block check to the preflight. Work out "you" from
  the header or the device. Fail closed when group work is not ready. Add
  messages in both languages, tests 1-11, and update
  [group-work.md](../group-work.md): the "Not promised" item becomes
  "a publish through BELL PR that changes a file someone else holds is
  refused". No data-file change and no new route. It is small: one new
  module, two call sites, two dictionary entries, and docs.
- **S2: agent turns and plans.** Save the run's owner when it is started.
  After each write-role turn, refuse a turn that met someone else's hold.
  Add the prompt block, the plan-approval refusal, the check next to
  `outOfScope` for teammates, and "Put these files back".
- **S3: sandbox denies** for held paths. Done for Codex and Claude Code
  as described under "Telling agents their scope". Still to verify:
  macOS (Seatbelt) for both, and Claude Code's Bash `denyWrite` on a host
  where its sandbox starts.
- **S4: detection (done).** Report changes made outside BELL PR to the
  holder at sync (`heldChanges` on `run.sync`, `round`, and `run`) and
  first publish (`held-changed-upstream` `confirm` check), and return
  `changing` on `check` and `work` (`server/hold-guard-detection.test.ts`).

S1 alone already means no change that BELL PR commits and pushes can
overwrite someone else's held file, whatever wrote it. S2 moves the stop
to the moment of writing, for agents.

## Decisions

Defaults this design takes, each open to change:

1. **Refuse, not warn**, at publish and after agent turns, with no
   tick-to-continue. The way out is release or admin revoke.
2. **Fail closed** when group work is on but stopped: group repositories
   cannot publish until it is fixed, or BELL PR is restarted without
   `--group`.
3. **"You" by device** when no participant header is sent. Everyone who
   joined from that device counts as you.
4. **Blocklist, not allowlist.** Only someone else's hold stops a change.
   Files nobody holds stay free. A per-project "change only what you
   hold" mode (the coordinator's `authorize`) can come later.
5. **Holds cover every branch** of the repository.
6. **G3 (expiry) stays separate.** Admin revoke is the answer to a
   forgotten hold for now.

Stopped teammate retries send held paths to the agent without holder names or
hold titles. Older saved tasks without held paths receive a generic hold-stop
reason in either supported locale; ordinary failure details remain available.
