# Coordination phase 2: acceptance test plan

Status: plan only, written before any wiring. Base: `origin/main` at
`3d727ae7`. No product code changes with this document.

Phase 2 of [multiuser-collaboration.md](multiuser-collaboration.md) ("Wire it
into the app") mounts the coordination router in `createApp` behind app
auth, adds participant management to the CLI, makes every managed write call
`authorize` and carry its fence, moves team runs onto the shared scope rules,
and has the mounting process take the strict writer lock and hand it to the
coordinator. This plan says what must be tested before that ships, where each
test belongs, and which gaps block it.

Every row below cites code read at `3d727ae7`. Rows marked **Unconfirmed**
rest on code that was not read to the end, or on a design choice phase 2 has
not made yet.

## 1. What the plan rests on

These are facts of the code as it stands. Several of them are P0 gaps by
themselves (section 5).

| # | Fact | Where |
| --- | --- | --- |
| F1 | The router is mounted only by the test host, on a bare Express app with no guard and no app token. Nothing in `server/` mounts it. | `test/coordination-host.ts`; `server/coordination-routes.ts:53` |
| F2 | `createApp` runs `localhostGuard` (app token or device token for `/api`, 415 for a non-JSON write, 403 for a bad host or origin), then parses every body with `express.json` before any route. The router's own order, "who is asking is settled before a body is even read", would no longer hold under `/api`. A catch-all `/api` 404 comes after the route modules, so the router has to be mounted before it. | `server/app.ts:176`, `:193`, `:230`; `server/coordination-routes.ts:55-60` |
| F3 | The router's error bodies carry `reason` (`invalidRequest` for zod and JSON errors, the coordinator's details otherwise). The app's error handler sends no `reason` for invalid JSON or an oversized body. | `server/coordination-routes.ts:126-166`; `server/app.ts:298-306` |
| F4 | `authorize` is synchronous and reads the in-memory state. It checks `#broken`, the actor, `recoveryUndecided`, the holder, the fence, the dependencies and every path. It does not call `holdsLock` and does not go through `#serial`. It answers "for this moment only". | `server/coordination.ts:1318-1337`, `:952` |
| F5 | `revoke` runs in `#serial("integrate:<project>")` and `#mutate`, so the state `authorize` reads changes only after the revoke is saved. | `server/coordination.ts:1236-1255` |
| F6 | The only participant method is `addParticipant(id, role)`. It returns the token once and stores its SHA-256. There is no remove, rotate, role change or list. | `server/coordination.ts:1022-1036` |
| F7 | `authenticate` accepts only `bpc_` plus 43 base64url characters, compared in constant time, else 401 `unauthenticated`. Actors are tracked in a WeakSet, so a body or a copied object cannot stand in for one. | `server/coordination.ts:1039`, `:957` |
| F8 | A `Run` has no claim, task, fence, project or participant field. Grep for `fence`, `claimId`, `participant` and `coordination` in `server/types.ts` and `server/store.ts` finds nothing. A managed write has nothing to carry yet. | `server/types.ts`, `server/store.ts` |
| F9 | `startServer` takes the ordinary lock with its port, host and URL. `acquireWriterLock` takes the strict lock in the same file with port 0. Both use `bellpr.lock`, so one process cannot hold both. | `server/index.ts:630`, `:320-327`, `:294` |
| F10 | `bell-pr open`, the reuse path of `bell-pr start` and `bell-pr doctor` read `lock.port` and `lock.host` to reach the running instance. A strict lock with port 0 leaves them no address. | `server/cli.ts:235-272`, `:305-307`, `:356-361`, `:576-583` |
| F11 | `redact` covers device tokens (`bpd_`), Bearer, X-Bell-Token and 64-hex strings, but not participant tokens (`bpc_`). | `server/secrets.ts:80-81`, `:128` |
| F12 | Team runs use `team.ts` `scopeContains`: a scope ending in `/` is a case-sensitive prefix, anything else an exact match. Coordination and group-mode overlap warnings use `scope-paths.ts`, which folds ASCII case and contains by directory. `claimableScope` refuses non-ASCII, `:*?"<>\|{}`, empty, `.` and `..` segments, trailing dots or spaces, `~N` short names, `.git` and sensitive files. `parseTeamPlan` allows non-ASCII scopes. | `server/team.ts` `scopeContains`, `scopesOverlap`, `parseTeamPlan:298`, `directoryScopes:382`; `server/team-workspace.ts:160`; `server/scope-paths.ts` |

## 2. Managed write endpoints

### 2.1 Refusals every managed write must make

The table in 2.2 says which of these apply to each endpoint. Each refusal
needs the unchanged-state check in 2.3, not just the status code.

| Id | Case | Expected answer | Source of the answer |
| --- | --- | --- | --- |
| R1 | No `x-bell-participant` header, with a valid app token | 401 `unauthenticated` | `authenticate`, `coordination.ts:1039` |
| R2 | A claim held by another participant | 403 `notHolder` | `assertHeldBy`, `coordination.ts:760` |
| R3a | A released or revoked claim | 409 `ended` | `coordination.ts:758` |
| R3b | An old fence after the files were granted again | 409 `staleFence` | `coordination.ts:762` |
| R4 | A forged header: malformed, unknown, another participant's token, the app token in `x-bell-participant`, or a participant token only in `Authorization` | 401; the app token alone never makes a participant | `authenticate`; `http-guard.ts:182` reads only Authorization and X-Bell-Token |
| R5 | Extra body fields that name a holder, participant, role, owner or fence the server should derive | 400 `invalidRequest` and nothing written; never stripped and ignored | strict zod bodies; see 2.2 for which routes are not strict |
| R6 | A project whose integration recovery is undecided | 409 `recoveryUndecided`; another project still works | `#openProject`, `coordination.ts:966` |
| R7 | A path the claim does not hold, or one that cannot be compared | 403 `outOfScope` or 400 `unreliablePath` | `#assertHolds`, `coordination.ts:1340` |
| R8 | The coordinator has lost or never held the strict lock | 503 `notSingleWriter` | `#mutate`, `coordination.ts:904`; `holdsLock:298`. Not checked by `authorize` today (F4) |
| R9 | A task whose dependencies are unknown, failed or not integrated | 409 `dependencyUnknown`, `dependencyFailed` or `dependencyPending` | `assertDependenciesIntegrated`, `coordination.ts:742-750` |

### 2.2 Endpoint table

"Route" is the Express handler in `server/routes/`. "Handler" is the function
that does the work; every route goes through a one-line `Workbench` method in
`server/workbench.ts`. "Paths to authorize" is what the fence has to cover;
phase 2 has not decided where those paths come from (F8), so that column is
the minimum this plan expects.

| Endpoint | Route | Handler | Body today | What it writes | Paths to authorize | Refusals |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /api/runs/:id/plan/approve` | `runs.ts:19` | `team-plan.ts` `approvePlan:61`; Learn by hand goes to `confirmByHandPlan:94` | strict `{overlapDigest?}` | run status to `queued` (agent plan) or `review` (by hand), `team.approvedAt`, log lines, `store.save`, `ctx.enqueue` starts agents | every task's `files` (agent plan); every step's files (by hand) | R1-R9. The overlap 409 (`planOverlap`, `overlapChanged`) must still come first or last consistently; decide and test the order |
| `POST /api/runs/:id/team/retry` | `runs.ts:51` | `team-retry.ts` `retryTeam:24` | strict `{message?}` | re-queues failed members; `claimReadyTasks` at `team-retry.ts:72` | files of every task it re-queues | R1-R9 |
| `POST /api/runs/:id/split` | `runs.ts:97` | `split-run.ts` `splitRun:298` | strict `{contributions:[{title, paths}]}` | new runs, branches and checkouts, one per part | every part's `paths`, and the original run's claim | R1-R9; R7 per part |
| `POST /api/runs/:id/sync` | `sync.ts:10` | `sync-runs.ts` `syncRun:87` | none parsed | `read-tree -u --reset` into the run's checkout (`sync-runs.ts:152`); a published run gets a sync round, pushed later | the files the merge changes. **Unconfirmed**: the merge result is known only after the merge, so either authorize after computing it and before `read-tree`, or authorize the whole claim | R1-R4, R6-R9; R5 needs a body schema first |
| `POST /api/runs/:id/sync/resolve` | `sync.ts:13` | `sync-runs.ts` `resolveConflicts:370` | none parsed | an agent edits the conflicted files in the checkout | the conflicted files | as sync |
| `POST /api/runs/:id/sync/undo` | `sync.ts:16` | `sync-runs.ts` `undoSync:316` | none parsed | resets the checkout to before the sync | the files the sync changed | as sync |
| `POST /api/runs/:id/approve` | `review.ts:138` | `publish.ts` `approve:305` | **not strict**: `z.object({draft: z.object(...)})` | records approval of the draft it was shown. **Unconfirmed**: read to line 330; no repository write seen there | the run's changed files | R1-R9; R5 fails today, since an unknown key is stripped silently |
| `POST /api/runs/:id/publish/recover` | `review.ts:160` | `publish.ts` `recoverPublish:406` | strict `{commit}` | adopts a commit as the published one | the commit's changed files | R1-R9 |
| `POST /api/runs/:id/publish` | `review.ts:167` | `publish.ts` `publish:621` | **not strict** at the top level (the `overrides` items are) | `commit-tree` and `git push` (`publish.ts:834`, `:894`, `:1099`, `:1125`); `localPublishChecks` at `:192` | the run's changed files | R1-R9; R5 fails today; R8 must hold until the push, not just at the start |
| `POST /api/runs/:id/follow-ups` | `follow-ups.ts:17` | `followup-runs.ts` `startFollowUp:96` | strict | starts an agent round on the published run | the files the round may change. **Unconfirmed**: the round's scope is not declared before it starts | R1-R9 |
| `POST /api/runs/:id/follow-ups/discard` | `follow-ups.ts:49` | `followup-runs.ts` `discardFollowUp:371` | none parsed | `git reset --hard` in the checkout (`followup-runs.ts:413`) | the round's changed files | R1-R4, R6-R9; R5 needs a body schema first |
| `PUT /api/runs/:id/by-hand/plan` | `by-hand.ts:115` | `by-hand.ts` `savePlan:178` | strict (`by-hand.ts:15`: every schema is strict) | the person's plan in the run record | the steps' files | R1-R9 |
| `POST …/by-hand/plan/reveal` | `by-hand.ts:118` | `revealOutline:213` | strict `{mode}` | run record only | none; decide whether it is managed | R1, R4 at most |
| `POST …/by-hand/plan/questions` | `by-hand.ts:121` | `by-hand-guide.ts` `planQuestions:314` | strict empty | an agent turn, run record only | none | R1, R4 at most |
| `PATCH …/by-hand/steps/:stepId` | `by-hand.ts:125` | `updateStep:243` | strict | run record; a step's files can change | the step's new files | R1-R9 |
| `POST …/by-hand/guide` | `by-hand.ts:129` | `by-hand-guide.ts` `guide:257` | strict | an agent answer in the run record | none | R1, R4 at most |
| `POST …/by-hand/check-ins` | `by-hand.ts:132` | `checkIn:280` | strict | run record | none | R1, R4 at most |
| `PUT /api/repos/:id/test-command` | `by-hand.ts:138` | `by-hand-tests.ts` `confirmTestCommand:179` | strict | the repository's test command; a repository, not a run | none; this is per project, so it is an admin question, not a claim | decide: admin only, or not managed |
| `POST …/by-hand/tests` | `by-hand.ts:141` | `by-hand-tests.ts` `runTests:205` | strict | runs the test command in the checkout; it can write files | the claim's whole scope. **Unconfirmed** which files a test run writes | R1-R9 |
| `POST …/by-hand/tests/stop`, `…/tests/report` | `by-hand.ts:147`, `:151` | `stopTests:389`, `reportTests:401` | strict | run record | none | R1, R4 at most |
| `POST …/by-hand/ready` | `by-hand.ts:154` | `by-hand.ts` `ready:308` | strict `readySchema` | reads the diff and its fingerprint, records ready, starts review | the diff's files: a file outside the claim must be refused here, since the person's own edits happen outside BELL (phase 5) | R1-R9 |
| `POST …/by-hand/leave` | `by-hand.ts:157` | `by-hand.ts` `leave:401` | strict empty | run record only | none; leaving should release or keep the claim by an explicit rule | R1, R4 |

Write routes the brief did not list, which phase 2 must classify as managed
or not: `POST /api/runs` (`runs.ts:62`), `…/cancel` (`runs.ts:94`, no body),
`…/plan/revise` (`runs.ts:34`, not strict), `…/team/messages` (`runs.ts:42`,
not strict), `…/review/rerun`, `…/draft/prepare`, `PATCH …/draft`,
`…/pr/feedback` (`review.ts:68-157`).

### 2.3 Unchanged-state check

After every refusal, compare before and after:

1. The run record: `JSON.stringify` of `workbench.store.data.runs` entry,
   and the store file's bytes.
2. The checkout: `git rev-parse HEAD`, `git status --porcelain=v2 -z`, and the
   index file's hash.
3. Refs: the run's branch, the publish branch, and on the fake GitHub
   (`test/fake-github.ts`) the remote refs and the PR list.
4. The coordination file's bytes and the project view from
   `GET /api/coordination/projects/:project`.
5. No agent started: the queue is empty and no agent slot was taken.
6. No log line added to the run.

A refusal that changes any of these fails, even with the right status.

## 3. Lock handoff

### 3.1 Cases and the tests that cover them

| Case | Expected | Covered by | Gap |
| --- | --- | --- | --- |
| The mounting process takes the strict lock and opens the coordinator | coordinator opens; no other start runs | `coordination.test.ts:506` (only the strict lock this process holds on the same directory opens coordination) | Covers the coordinator, not `startServer`. Nothing tests `startServer` with the strict lock |
| An ordinary start while a coordinator host holds the lock | refused | `coordination-race.test.ts:720` (`startHere` is an ordinary `startServer`, refused alongside `acquireWriterLock`), `:903`, `:1118` | none for the refusal itself |
| The coordinator host after an ordinary start already holds the lock | refused, not replaced | `startup.test.ts:688` (under the strict rule a lock whose holder cannot be shown to have stopped stays, though an ordinary start replaces it) | No test for an ordinary `startServer` already running when coordination is turned on in the same data directory |
| A second coordinator host | does not start | `coordination-race.test.ts:516`, `:832` (racing for a killed host's lock, exactly one starts) | none |
| A paused holder (SIGSTOP), however old its lock looks | keeps the lock; resumes and writes; gives it up when closed | `coordination-race.test.ts:720` | Only for a coordinator host. No test pauses an ordinary `startServer` that holds the strict lock (depends on P0-9) |
| A person removes a paused host's lock | another host starts; the resumed one is refused when it writes | `coordination-race.test.ts:804` | The resumed host's `authorize` would still answer yes until its next write sets `#broken` (F4). Not tested |
| A replaced lock | the host refuses every write with 503 and leaves the other lock | `coordination-race.test.ts:768`; `coordination.test.ts:479` | same `authorize` gap |
| A killed holder | its lock is replaced once it is shown to have stopped; in-flight claims never grant a file twice | `startup.test.ts:757`; `coordination-race.test.ts:459`, `:526`, `:560` | none |
| Held between the last lock check and `update-ref` | keeps every start out, then lands | `coordination-race.test.ts:903` (Linux only) | none; runs only on Linux |
| Outside the rule (lock removed or replaced by hand during an integration) | documented as not guaranteed | `coordination-race.test.ts:964`, `:1016` | none; keep as documentation tests |
| A real other PID namespace | never taken over | `coordination-race.test.ts:1118`, `:1186`; `startup.test.ts:663` | skipped where `bwrap` is missing; CI coverage **Unconfirmed** |

### 3.2 What the handoff itself needs

Today `startServer` writes the ordinary lock with an address, and
`acquireWriterLock` writes the strict lock without one (F9, F10). Phase 2 has
to pick one of these, and the tests below follow the pick:

- `startServer` takes the strict lock itself, with its port, host and URL,
  when coordination is on, and hands that `WriterLock` to the coordinator; or
- `acquireWriterLock` takes an address, and `startServer` calls it instead of
  `acquireLock` when coordination is on.

Either way one process holds one lock. The tests: `bell-pr open`, `start`
reuse and `doctor` still find the instance; an ordinary start is refused
while the strict lock is held; turning coordination off and restarting goes
back to the ordinary rule; `release` on shutdown (SIGHUP, SIGTERM, as in
`startup.test.ts:1162`) removes the one file.

## 4. Regression risks and CLI cases

### 4.1 One-person and existing group-mode users

| Risk | Test | Where |
| --- | --- | --- |
| With coordination off, a request without `x-bell-participant` must work as today, byte for byte | run the existing route suites unchanged with coordination off; add one test that a header sent anyway is ignored, not an error | `server/api-auth.test.ts`, `server/workbench-api.test.ts` |
| Mounting adds a body parser or error shape to every `/api` route | invalid JSON, a 161 KB body and a zod error on a non-coordination route keep today's body (no `reason`) | `server/api-auth.test.ts` |
| Group-mode overlap warnings change when team runs move to `scope-paths.ts` | `group-local.test.ts:101`, `:115`, `:209`, `:284`, `:372` pass unchanged; add: the digest `GET /api/runs/:id/overlaps` returns is the same before and after the migration for the same plan and checkouts | `server/group-local.test.ts` |
| Plan-approval overlap confirmation | `team.test.ts:1194` (a plan meeting another contribution needs the overlap confirmed) passes unchanged; the overlap 409 comes before or after `authorize` by a stated rule | `server/team.test.ts` |
| Non-ASCII scopes (for example a zh-TW file name) | `parseTeamPlan` accepts them today; `claimableScope` refuses them. A team plan with one must either stay out of coordination with a clear message, or the rule must change. Today's plan must not start failing silently | `server/team.test.ts`, `server/scope-paths.test.ts` |
| Case folding | `src/App.ts` and `src/app.ts` in two tasks: today they run in parallel (`scopesOverlap` is case-sensitive); under the shared rules they are serialized. Decide, then pin the behaviour | `server/team.test.ts:642` area |
| Out-of-scope member edits | `team.test.ts:1157` passes; add: an edit to `SRC/a.ts` under scope `src/` is kept in isolation or accepted by one stated rule, the same in `team-workspace.ts:160` and in `authorize` | `server/team.test.ts` |
| Scope without a slash | `team.ts` `directoryScopes:382` reads `src` as `src/` when it is a directory; `scope-paths.ts` contains by directory without that step. Pin both readings to the same answer | `server/team.test.ts`, `server/group-local.test.ts:209` |

### 4.2 CLI participant management

The core has `addParticipant` only (F6), and the CLI has no participant
command (`server/cli.ts:634-652`: start, open, token, pair, devices, doctor,
version, help). So these cases need core work before CLI tests can pass.

| Case | Expected |
| --- | --- |
| Add a member and an admin | prints the token once; a second add with the same id is 409 `participantExists`; the token is never written to a log (needs `bpc_` in `redact`, F11) |
| The CLI while the host runs | it goes through the running host (the coordinator is the only writer); it never takes the strict lock itself |
| The CLI while no host runs | it takes the strict lock, writes and releases it; a host starting meanwhile is refused or waits, never both write |
| List participants | ids and roles only; no token, no hash |
| Remove a participant | its token is refused at once (401); its held claims are revoked or kept by a stated rule, and an in-flight write under them is refused at its next fence check |
| Rotate a token | the old token is refused at once, the new one works; like `bell-pr token rotate` (`api-auth.test.ts:316`) it is not printed to a log |
| Change a role | an admin-only route (revoke, reopen, settle) follows the new role on the next request |
| The last admin | removing or demoting it is refused, so recovery can still be settled |
| Limits | participants stop at their limit before anything changes (`coordination.test.ts:1968` covers the core) |

## 5. Tests to add

### P0: block the wiring

| # | Test | File |
| --- | --- | --- |
| P0-1 | Under `createApp`, with the app token: R1 and R4 on every coordination route, including the app token in `x-bell-participant`, a participant token in `Authorization` only, and a device token plus a participant token. Decide and pin whether a paired device may present a participant token | `server/coordination-app.test.ts` (new) |
| P0-2 | Under `createApp`: a request without the app token is 401 from the guard before the participant is read; a non-JSON write is 415; error bodies keep `reason` (F2, F3). Mount order: the router answers before the `/api` 404 | `server/coordination-app.test.ts` (new) |
| P0-3 | Body before identity: invalid JSON or an oversized body with no participant token. Either the answer stays 401 (parse after identity) or the plan records that 400 is acceptable; a body never decides who is asking | `server/coordination-app.test.ts` (new) |
| P0-4 | For each endpoint in 2.2 that writes the checkout, a ref or the remote: R2, R3a, R3b, R5, R6, R7, R8, R9, each with the unchanged-state check of 2.3. Start with `publish`, `follow-ups/discard`, `sync`, `split` and `plan/approve` | `server/coordination-app.test.ts` (new), one `describe` per endpoint; fixtures in `test/coordination-fixtures.ts` |
| P0-5 | R5 on `approve` and `publish`: an extra top-level key is 400 and changes nothing. Today it is stripped (not strict) | `server/workbench-api.test.ts` |
| P0-6 | R5 on `sync`, `sync/resolve`, `sync/undo`, `follow-ups/discard` and `cancel`: they parse no body today, so a fence or claim field sent there is ignored. Once they carry a fence, a body that names a holder is 400 | `server/sync-routes.test.ts`, `server/followups.test.ts` |
| P0-7 | `authorize` after the lock is lost and before any write: 503 `notSingleWriter`, not authorized (F4). Today it answers yes until `#mutate` sets `#broken` | `server/coordination.test.ts` (next to `:479`) |
| P0-8 | `authorize` racing a `revoke` in flight: a managed write authorized just before the revoke is saved must be refused where it lands (the fence is checked again before the push, `update-ref`, `read-tree` or `reset`). The design accepts that an authorization holds only for its moment; this test proves the second check exists | `server/coordination-race.test.ts` |
| P0-9 | `startServer` with coordination on holds one strict lock with its address; `bell-pr open`, `start` reuse and `doctor` still find it; an ordinary start is refused; the coordinator opens with that lock and no other | `server/startup.test.ts`, `server/cli.test.ts` |
| P0-10 | A paused host whose lock was removed by hand: after it resumes, `authorize` and every managed write are refused before they write | `server/coordination-race.test.ts` (extends `:804`) |
| P0-11 | Coordination off: every existing route suite passes unchanged, and a stray `x-bell-participant` header changes nothing | `server/api-auth.test.ts`, `server/workbench-api.test.ts` |
| P0-12 | Group-mode overlap warnings and their digest are unchanged by the scope migration, including a case that differs only in letter case and a scope written without a slash | `server/group-local.test.ts` |
| P0-13 | Team runs on the shared scope rules: non-ASCII scope, case-only difference, `src` vs `src/`, symlink and blocked file (`team-workspace.ts` sends them to manual handling). Each pinned to one stated answer, the same in `claimReadyTasks`, `team-workspace.ts:160` and `authorize` | `server/team.test.ts`, `server/scope-paths.test.ts` |
| P0-14 | A run maps to one project, task and claim, and the mapping survives a restart and a store reload (F8). Without it none of P0-4 can be written | `server/store.test.ts`, `server/persisted-schema.test.ts` |

### P1: before phase 2 is called done

| # | Test | File |
| --- | --- | --- |
| P1-1 | `redact` removes `bpc_` tokens from logs, error bodies and stderr ends (F11) | `server/secrets.test.ts` |
| P1-2 | CLI participant add, list, remove, rotate and role change, through the running host and with no host; the last admin cannot be removed (4.2). Needs the core methods first | `server/cli.test.ts`, `server/coordination.test.ts` |
| P1-3 | A removed participant's token is refused on the next request, and its claims end by the stated rule | `server/coordination.test.ts` |
| P1-4 | The by-hand `ready` refuses a diff with a file outside the claim, with the unchanged-state check | `server/by-hand-routes.test.ts` |
| P1-5 | Classification of the unlisted write routes (2.2, last paragraph): each is either managed with R1-R9, or a test pins that it needs no participant | `server/coordination-app.test.ts` |
| P1-6 | `recoveryUndecided` on one project leaves another project's managed writes working end to end under `createApp`, not just in the core (`coordination.test.ts:1456`) | `server/coordination-app.test.ts` |
| P1-7 | The relation between the coordination integration branch and the GitHub publish is stated and tested: a publish of a claim that was revoked after integration, and a publish whose run has no claim | `server/publish-recovery.test.ts` or a new `server/coordination-publish.test.ts` |
| P1-8 | Leaving a Learn-by-hand run and cancelling a run end or keep their claim by a stated rule | `server/by-hand-routes.test.ts`, `server/workbench-api.test.ts` |

### P2: later or nice to have

| # | Test | File |
| --- | --- | --- |
| P2-1 | The PID namespace tests (`coordination-race.test.ts:1118`, `:1186`) run in CI rather than skip | CI config |
| P2-2 | Timing: `authorize` per managed write adds no noticeable delay with 200 scopes and 1000 paths (`maxScopes`, `maxPaths`) | `server/coordination.test.ts` capacity block |
| P2-3 | UI for claims and refusals (phase 3) | `src/` |
| P2-4 | `test-command` as an admin-only project setting under coordination | `server/coordination-app.test.ts` |

## 6. Not confirmed

- Where a managed write gets its claim and fence: a field on the run (F8), the
  request body, or both. P0-4 and P0-14 assume the run holds it and the body
  never names a holder.
- Whether `syncRun` pushes during the sync or only in the next publish; the
  comment at `sync-runs.ts:4` says the round is "pushed later". Read only to
  the `read-tree` steps.
- Whether `approve` writes to the repository after `publish.ts:330`.
- Which files a by-hand test run (`runTests`) and a follow-up round write
  before they finish, so what their authorization must cover.
- Whether paired devices may act as participants; the guard sets
  `res.locals.deviceId` and the coordinator does not read it.
- Whether the PID namespace tests run in CI.
- No test was run for this plan; it is a reading of the code at `3d727ae7`.
