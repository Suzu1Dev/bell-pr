# Group work

Group work is for several people who already share one running BELL PR: the
person at the host, and teammates who reach it from
[paired devices](self-hosting.md#pairing-devices-on-your-tailnet). With it,
that BELL PR is set up as one group, and each person joins the group under
a name, as a member or an admin.

Today it is switched on, set up, and people are invited from the command
line and the API. Once people have joined, an admin adds repositories to
the group, and each person says which files and folders they are working on
by taking a [hold](#holds). BELL PR refuses a hold that meets one already
held, and everyone who follows that repository's
[live feed](#the-live-feed) hears of each change. All of that is the API
only. The Group page comes later: nothing in the app shows the group yet,
and no page changes when group work is on. Group work **does not protect
anything at write time**: a hold does not stop a tool, an editor or a push
from writing outside it.
[What is promised and what is not](#what-is-promised-and-what-is-not) lists
what you can rely on today.

The design behind it is in
[Multi-person collaboration](multiuser-collaboration.md).

## Switch it on

Start BELL PR with `--group`, or set `BELLPR_GROUP=1` (in the environment
or in an `--env-file`):

```sh
bell-pr start --group
```

Without the switch nothing changes: there is no `/api/collab` route (the
API answers its usual 404), `GET /api/status` has no `collab` field, the
data directory's lock is the ordinary one, and no new file is written.
One thing is the same in every BELL PR, with or without the switch: text
shaped exactly like a participant token (`bpc_` and 43 letters, digits,
`-` or `_`) is masked like any other token, and a changed file that holds
it is held back from review.

Group work is chosen when BELL PR starts. `bell-pr start --group` never
passes off a BELL PR that runs without group work as one: when it finds
one with the same data directory it prints "BELL PR is already running at …
without group work. Stop it first, then start it with
`bell-pr start --group`." and exits with 1. A plain `bell-pr start` or
`bell-pr open` that finds a BELL PR with group work uses it as usual.

## What changes when it is on: the lock

One BELL PR runs per data directory and holds `<data dir>/bellpr.lock`.
With group work the lock is taken under a strict rule, so the group's files
have one writer:

- **A strict lock is never replaced because of its age.** An ordinary lock
  written elsewhere counts as free once it is no longer renewed. A strict
  one does not, however long ago it was renewed.
- **After a crash on the same computer, the next start replaces the lock**
  once it has shown that the process that wrote it has stopped. There is
  nothing for you to do.
- **After a crash that leaves a lock whose holder cannot be confirmed, the
  next start is refused** until a person removes the lock file. That is a
  lock written in another container (another PID namespace) or on another
  machine, by an older build that does not record where it ran, or one
  that cannot be read. The message begins "BELL PR cannot tell whether the
  process holding the data directory … has stopped" and names the file
  (`dataDirHolderUnconfirmed` in the dictionaries); see
  [BELL PR does not start](troubleshooting.md#bell-pr-does-not-start). A
  start without `--group` is refused in the same way: no start replaces a
  strict lock it cannot confirm.
- **A lock that is removed or replaced while its BELL PR runs stops group
  work** in that BELL PR, with the reason `notSingleWriter`. It writes
  nothing more to the group's files until it is restarted.

Stopping BELL PR (Ctrl+C, or a service stop) removes the lock. The data
directory has to be on a local file system
([the design](multiuser-collaboration.md#what-it-does-not-guarantee) says
why), and one that supports hard links: a strict lock is written aside and
linked into place.

## Set it up

On the computer that runs BELL PR:

```sh
bell-pr group status
bell-pr group setup
```

`bell-pr group status` prints whether group work is not set up yet, is set
up and ready, or has stopped and why. `bell-pr group setup` creates the
group: it writes `coordination.json` and `collab.json` in the data
directory. Running it again changes nothing and says that group work is
already set up.

Only the person at the host can set group work up: the request needs the
install token, and a paired device is answered 403. The `group` commands
accept `--data-dir <dir>` and `--env-file <file>`, like `bell-pr open`.
They print what to do when no BELL PR runs with that data directory, and
when it runs without group work.

## Invite people

```sh
bell-pr group invite "Ada" --admin
bell-pr group invite "Ben"
```

The command prints a one-time invite code and the time it stops working.
Give the code to that person over a channel you trust.

- The inviter types the name (1 to 40 characters, no control characters).
  The person who joins types only the code, so nobody joins under someone
  else's name.
- A code works once and lasts 10 minutes. At most 20 codes wait at a time.
  BELL PR keeps only their SHA-256, in memory: restarting it voids every
  code.
- `--admin` makes the person a group admin. The person at the host can
  always invite, which is how the first admin joins. After that an admin
  can also invite through the API, with their own participant token.

## Join

There is no page for joining yet. Joining is one API request from the
device that joins, with the app token that device already uses (on the
host, the install token in `<data dir>/api-token`):

```sh
curl -X POST http://127.0.0.1:4311/api/collab/join \
  -H "Authorization: Bearer <app token>" \
  -H "Content-Type: application/json" \
  -d '{"code":"<invite code>"}'
```

The answer (201) is `{ "groupId", "id", "name", "admin"?, "token" }`.
`token` is the person's participant token (`bpc_…`). It is given here,
and again only when the person redeems a code for themself
([below](#use-the-same-identity-on-another-device)). On disk BELL PR
stores only its SHA-256, so keep it like a password. Every later group
request sends it in the `x-bell-participant` header, next to the app
token. `GET /api/collab` with that header answers with `me`: the id, the
name and whether the person is an admin.

A group holds at most 1000 people, removed ones included, because a
person cannot be deleted. After that, joining answers 409 with
`reason: "full"`.

Ten wrong codes in 15 minutes lock that caller (one paired device, or the
host) out of joining for 15 minutes. Other people's codes stay valid.

## Use the same identity on another device

A person who has joined asks for a code for themself:
`POST /api/collab/invites` with the body `{ "self": true }` and their
participant token. Sending that code to `POST /api/collab/join` from the
other device answers with the same id, name and token. No person is added.
One such code waits per person: asking again replaces the earlier one.
While the code waits, at most 10 minutes, the host keeps the token in
memory with it.

## Remove a person

A group admin sends `POST /api/collab/people/<id>/remove` with the body
`{}`, or `{ "unpair": true }`.

- The person is marked as removed, and their participant token is answered
  403 (`notJoined`) from then on. The invite codes they gave out, and a
  code they made for themself, stop working.
- Whatever the person holds ends, in every repository of the group: each
  [hold](#holds) is revoked in the admin's name, and its task is free to
  take again. `revoked` in the answer counts them. Their requests waiting
  on a [live feed](#the-live-feed) end at once. Sending the removal again
  is harmless: it ends whatever that person still holds.
- Removing does not unpair anything by itself: a removed person on a
  paired device can still use everything else in that BELL PR. With
  `"unpair": true`, the paired device the person joined from is unpaired
  too, when one was recorded; the answer says so (`"unpaired": true`).
  Two devices are never unpaired this way (`"unpaired": false`): the one
  the request comes from, and one that a person still in the group joined
  from. A device added with a code for oneself is not recorded. Revoke
  such a device with `bell-pr devices revoke <id>`.
- An admin cannot remove themself (409), and a removal cannot be undone.
  Invite the person again; they join as a new person with a new id.
- A person's id is in the answer to their join, in `collab.json` on the
  host and, once the group has a repository, in `people` of its board
  (the [live feed](#the-live-feed)).

## The group's repositories

Holds are taken in a repository of the group. An admin adds one that this
BELL PR already has (imported on the Repositories page).
`GET /api/collab/projects` lists the group's repositories (`projects`).
For an admin the answer also names the repositories of this BELL PR that
can still be added (`addable`, each with its `repoId`) and how full the
group's record is (`storage`; see [Limits](#limits)).

```sh
curl -X POST http://127.0.0.1:4311/api/collab/projects \
  -H "Authorization: Bearer <app token>" \
  -H "x-bell-participant: <participant token>" \
  -H "Content-Type: application/json" \
  -d '{"repoId":"<repoId>"}'
```

Adding a repository makes the group its own bare copy of it, in
`<data dir>/collab/<project id>.git`: the default branch of BELL PR's clone
as it is at that moment, with that branch's commits and files, and no other
branch and no tag. The answer (201) is `{ "project": { "id", "name" } }`;
every later request names the repository by that `id` (`p-…`).

- The copy is made once and never refreshed. Nothing reads it after the
  repository is added: a hold is a record of paths, and a path that is not
  in the repository yet can be held.
- A copy that fails, or takes more than 3 minutes, is answered
  `cloneFailed` (500, or 504 when it took too long). Git's own words go to
  the log on the host only, the folder is deleted again, and the
  repository is not in the group.
- A repository cannot be taken out of the group again, and it keeps the
  name it had when it was added. Deleting it from BELL PR (**Delete
  repository**, or **Delete all data**) leaves it in the group under that
  name, with its holds and its bare copy.

What cannot be added:

- a repository this BELL PR does not have (400 `unknownRepository`); import
  it first;
- a repository that is already the group's, or is being copied right now
  (409 `alreadyAdded`);
- a repository whose default branch is not in BELL PR's clone: it is not in
  `addable`, and adding it is answered `cloneFailed`;
- a repository beyond the 100 a group can have (409 `full`).

## Holds

A hold says that one person is working on these files and folders of a
repository, for one task. Everyone in the group can take one, in any of the
group's repositories.

### Take a hold

```sh
curl -X POST http://127.0.0.1:4311/api/collab/projects/<project id>/work \
  -H "Authorization: Bearer <app token>" \
  -H "x-bell-participant: <participant token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix pagination","scopes":["src/api","docs/api.md"]}'
```

- `title` says what the work is: 1 to 120 characters. A control or
  text-direction character in it becomes a space.
- `scopes` are the paths: 1 to 50 files or folders, each relative to the
  top of the repository, with `/` between its parts, at most 300
  characters. A leading `./` and one trailing `/` are dropped.
  [Paths that cannot be held](#paths-that-cannot-be-held) lists what is
  refused.
- `runId`, when given, is the id of a contribution of that repository in
  this BELL PR. It is kept with the task and shown on the board, and
  nothing else follows from it.

The answer (201) is
`{ "hold": { claimId, taskId, title, runId?, holder, scopes, fence, since } }`.
Keep `claimId` and `fence`: releasing the hold needs both.

**A folder holds everything inside it.** A hold of `src/api` meets a hold
of `src/api/users.ts`, of `src/api` and of `src`. **Letter case is
ignored** (for the letters A to Z): `SRC/API/Users.ts` meets `src/api`.

A hold has no time limit. It stays, across restarts of BELL PR, until it is
released or revoked, or the person who holds it is removed.

### When a path is already held

BELL PR refuses a hold that meets one already held: 409 `conflict`, with
`conflicts` naming, for each held path in the way, the path, the holder's
name, the title and since when. A hold is taken whole or refused whole:
when one path is in the way, nothing is held. A person's own hold is in the
way too. To hold more paths for the same task, release the hold and take
the task again with all of them.

When two people ask for paths that meet at the same moment, one gets the
hold and the other is refused. The task of the refused one can stay on the
board as one that was never held, free to take.

### Check first

`POST /api/collab/projects/<project id>/check` with `{ "scopes": […] }`
asks the same question and takes nothing. The answer (200) is
`{ asOf, invalid, meets }`: `meets` lists each held path in the way with
its `claimId`, `taskId`, title and the holder's name, and `invalid` lists
the asked paths that cannot be held. The answer is true at `asOf`; someone
can take a path a moment later.

### Release, revoke, take again

- **Release.** The person who holds it sends
  `POST /api/collab/projects/<project id>/holds/<claimId>/release` with
  `{ "fence": <fence> }`. Someone else's hold is answered 403 `notHolder`,
  a fence that is not this hold's 409 `staleFence`, and a hold that has
  already ended 409 `ended`.
- **Revoke.** An admin ends anyone's hold with
  `POST /api/collab/projects/<project id>/holds/<claimId>/revoke` and the
  body `{}` or `{ "reason": "…" }` (at most 500 characters). The board
  shows who revoked it and the reason. A member is answered 403
  `adminOnly`.
- **Take again.** A hold that ended leaves its task on the board, free for
  anyone to take: `POST …/work` with `{ "taskId": "<taskId>", "scopes": […] }`.
  That is a new hold, with another `claimId`, a higher `fence` and the
  paths named now, which need not be the earlier ones. A task that someone
  holds is answered 409 `taskClaimed`, or `conflict` when the paths meet a
  hold.

### What a hold does not do

A hold is a record the group can see, and the reason a second hold that
meets it is refused. It **does not stop a tool, an editor or a push from
writing outside it**, or inside someone else's. BELL PR's agents do not
read the holds, a contribution's changes are not compared with them, and
nothing is locked in a checkout or on GitHub. A hold says nothing about a
path nobody named, and nothing about two changes in different files that do
not work together.

## The live feed

`GET /api/collab/projects/<project id>/feed` answers with one repository's
board: the people of the group, what is held (oldest first), the 20 tasks
released most recently (`moreReleased` counts the rest) and the ids of the
people looking at that board now (`present`). Each answer carries `epoch`,
`version` and `seen`. A caller that sends them back with `wait=<seconds>`
(0 to 25) is answered as soon as the board or `present` changes, and with
204 when nothing changed in that time, so asking again in a loop follows
the board as it changes. A person counts as present while a request of
theirs waits and for 40 seconds after their last one; presence is best
effort. One person can have 2 requests waiting, over all repositories, and
the group 64; one more is answered 429 `tooManyWaiters`, while a request
with `wait=0` is still answered. After BELL PR restarts the `epoch` is
another one, and the next answer has the whole board again.

## Paths that cannot be held

A hold names files and folders inside the repository. These are refused
with 400 `invalidScope`, and `invalid` in the answer lists them as they
were sent:

- the whole repository: an empty path, `.` or `/`;
- an absolute path, and a path with `..`, `.` or nothing between two `/`;
- a backslash, a control character, any character outside printable ASCII
  (an accented or a Chinese letter, for example), and any of
  `: * ? " < > | { }`;
- a part that begins or ends with a space, ends with a dot, or has `~`
  before a digit (a Windows short name such as `PROGRA~1`);
- `.git` as a part, in any letter case;
- the files BELL PR holds back from review, in any letter case: `.env` and
  `.env.*` (but not `.env.example`, `.env.sample` or `.env.template`),
  `.npmrc`, `.pypirc`, `id_rsa`, `id_ed25519`, `credentials` and
  `credentials.*`, `.DS_Store`, a path that ends in `.pem`, `.p12`, `.pfx`
  or `.key`, and anything in `node_modules`, `.bellpr`, `.ssh`, `.aws` or
  `.codex`;
- a part named exactly `prototype`, `constructor` or `__proto__`. A file
  under such a folder cannot be named by itself; hold a folder above it;
- a path of more than 300 characters. Such a path is not repeated in
  `invalid`.

These rules are about spelling only. They exist so that two spellings of
one file always meet, on every file system a person in the group may use.

## Limits

| What | Limit | Past it |
| --- | --- | --- |
| Paths in one hold, or in one `check` | 50 | 400 `tooManyScopes` |
| Length of a path | 300 characters | 400 `invalidScope` |
| Title of a task | 120 characters | 400 |
| Reason of a revoke | 500 characters | 400 |
| `work` requests of one person | 30 in 10 minutes, taken or refused | 429 `slowDown`; `retryAfter` is the seconds to wait |
| `check` requests of one person | 120 in a minute | 429 `slowDown`, the same way |
| Feed requests waiting | 2 for one person, 64 for the group, over all repositories | 429 `tooManyWaiters` |
| Holds one person has at a time, in all repositories | 100, with 2000 paths | 409 `full` |
| Holds in one repository at a time | 1000, with 20 000 paths | 409 `full` |
| Tasks in one repository, ended ones included | 10 000 | 409 `full` |
| Holds in one repository, ended ones included | 100 000 | 409 `full` |
| Repositories in the group | 100 | 409 `full` |
| People in the group, removed ones included | 1000 | 409 `full` |
| The group's record, `coordination.json` | 8 MiB | 409 `full` |

The two request limits are counted in memory, so a restart of BELL PR
starts them again. A request the limit refused is not counted.

**The record keeps every hold that has ended**, with its paths, and every
task. Releasing or revoking deletes nothing, and no clean-up is built. An
admin reads how full the record is in `storage` of
`GET /api/collab/projects`: `used` and `max`, in bytes.

On a built BELL PR, a hold of one path took about 0.6 KB of the record once
it had ended: about 0.2 KB for its task and 0.4 KB for the hold. Each
further path adds a little more than its own length, and a task taken
again adds only the hold. A small group that takes a few holds each
working day uses well under 1 MB a year: three a day come to about 0.5 MB,
and ten a day to about 1.6 MB. The record has room for more than 10 000
such holds. The limits above slow a person down; they do not keep someone
in the group from filling the record on purpose.

When the record is full, every new hold, task, person and repository is
refused with 409 `full` ("The group's record is full. Ask the host to
reset group storage."), for everyone, and still after a restart. Holds can
still be released and revoked: BELL PR keeps room for that, about 3 KB for
each hold held now and 0.1 KB for each task, which is why `full` comes
before `used` reaches `max`. The way out today is to start the group
again:
[Group storage is full](troubleshooting.md#group-storage-is-full). The
other limits answered `full` use the same sentence; where the limit is on
what is held at a time, releasing a hold makes room again.

## The API in short

Every request carries the app token as any other request does (the install
token, or a paired device's). The routes exist only with the switch.

| Request | Who | Answer |
| --- | --- | --- |
| `GET /api/collab` | anyone with the app token | `{ state, reason?, groupId?, host, me? }`; `host` is true for the install token |
| `POST /api/collab/setup` with `{}` | the install token | 201 `{ state: "ready", groupId }`; 403 `hostOnly`; 409 `exists`, or `missing` when group work has stopped |
| `POST /api/collab/invites` with `{ name, admin?: true }` | the install token, or an admin | 201 `{ code, expiresAt }`; 403 `adminOnly`; 429 `tooManyInvites` |
| `POST /api/collab/invites` with `{ self: true }` | anyone who joined | 201 `{ code, expiresAt }` |
| `POST /api/collab/join` with `{ code }` | anyone with the app token | 201 `{ groupId, id, name, admin?, token }`; 400 `invalidCode`; 429 `joinLocked`; 409 `full` |
| `POST /api/collab/people/<id>/remove` with `{ unpair?: true }` | an admin | 200 `{ revoked, unpaired }`; 409 `self`; 404 `unknownPerson` |
| `GET /api/collab/projects` | anyone who joined | 200 `{ projects: [{ id, name }], addable?, storage? }`; `addable` (`[{ repoId, name }]`) and `storage` (`{ used, max }`) for an admin only |
| `POST /api/collab/projects` with `{ repoId }` | an admin | 201 `{ project: { id, name } }`; 403 `adminOnly`; 400 `unknownRepository`; 409 `alreadyAdded`, `full`; 500 or 504 `cloneFailed` |
| `GET /api/collab/projects/<project id>/feed?epoch=&version=&seen=&wait=` | anyone who joined | 200 `{ epoch, version, seen, asOf, board?, present }`; 204 when nothing changed; 404 `unknownProject`; 429 `tooManyWaiters` |
| `POST /api/collab/projects/<project id>/check` with `{ scopes }` | anyone who joined | 200 `{ asOf, invalid, meets }`; 400 `tooManyScopes`, `invalidScope`; 404 `unknownProject`; 429 `slowDown` |
| `POST /api/collab/projects/<project id>/work` with `{ title, scopes, runId? }` or `{ taskId, scopes }` | anyone who joined | 201 `{ hold }`; 400 `invalidScope`, `tooManyScopes`, `unknownRun`; 404 `unknownProject`, `unknownTask`; 409 `conflict`, `taskClaimed`, `full`; 429 `slowDown` |
| `POST /api/collab/projects/<project id>/holds/<claimId>/release` with `{ fence }` | the person who holds it | 200 `{ ok: true }`; 403 `notHolder`; 404 `unknownProject`, `unknownClaim`; 409 `staleFence`, `ended` |
| `POST /api/collab/projects/<project id>/holds/<claimId>/revoke` with `{ reason? }` | an admin | 200 `{ ok: true }`; 403 `adminOnly`; 404 `unknownProject`, `unknownClaim`; 409 `ended` |

- `state` is `notSetUp`, `ready` or `stopped`. `GET /api/status` carries
  the same `collab: { state, reason? }`.
- While group work is not ready, every request but `GET /api/collab` and
  the set-up answers 503 with `reason` `notSetUp` or `stopped`. The one
  request whose write stops group work can answer 503 with the reason
  itself, `notSingleWriter` or `unavailable`.
- A missing, unknown or removed participant token is answered 403 with
  `reason: "notJoined"`, never 401. A 401 still means what it meant before:
  the app token is missing or wrong.
- A refusal is `{ reason, error }`: `reason` is the word in the table and
  `error` a sentence in the language of the request's `x-bell-locale`
  header (English or Traditional Chinese). Three refusals say more:
  `conflict` carries `conflicts`, `invalidScope` carries `invalid`, and
  `slowDown` carries `retryAfter`, in seconds.
- A body of the wrong shape (a missing or unknown field, a wrong type, a
  title or a reason that is too long) is answered 400 with `error` only.
- `work` can also answer 409 `taskClosed` and 409 `recoveryUndecided`.
  Nothing in group work closes a task or leaves a repository in that state
  today, so neither is seen yet.

## When group work stops

Group work stops when its files cannot be trusted or written: one of them
is missing or damaged, a write to `coordination.json` failed, or the lock
is no longer this process's. A stopped group stays stopped until the cause
is fixed and BELL PR is restarted. BELL PR never creates either file again
by itself and never repairs one: nothing is assumed about a group whose
record is gone. The rest of BELL PR keeps working. At that moment every
request waiting on a [live feed](#the-live-feed) is answered 204, and a
repository being copied for the group is given up.

A failed write to `collab.json` after set-up does not stop group work: the
request fails and the file keeps what it held. When that happens in a
join, the invite code is spent and the person is not in the group (no
token was given out), but they count toward the 1000. Invite them again.
When it happens while a repository is added, the answer is `cloneFailed`,
the copy is deleted and the repository is not in the group, but it counts
toward the 100. Add it again.

`bell-pr group status` prints the reason;
[Group work has stopped](troubleshooting.md#group-work-has-stopped) says
what each one means and what to do.

## The files it writes

All are in the data directory, only with group work: the two files from
`bell-pr group setup` on, the folder from the first repository added.

| File | What it holds |
| --- | --- |
| `coordination.json` | Each person's id, role (admin or member), the time they were added and the SHA-256 of their participant token; never the token. Each repository of the group, with the folder of its bare copy and the commit it was copied at. Each task, with who made it and when, and every hold, ended ones included: its paths, who holds it, when it was taken and when and by whom it ended, and the reason of a revoke |
| `collab.json` | The group's id and set-up time, and for each person: name, the time they joined, whether they are an admin, the time they were removed, and the id of the paired device they joined from. For each repository: its name, its id in this BELL PR and the time it was added. For each task: its title, the id of its contribution when one was given, and the time it was made |
| `collab/<project id>.git` | The group's bare copy of a repository: the commits and files of its default branch, as they were when it was added |

The lock file `bellpr.lock` also carries `"strict": true`. Back the two
files and the folder up and restore them together: one of the two files
without the other stops group work. Deleting the data directory deletes the
group. **Delete all data** in Settings does not: it leaves the two files
and the folder as they are.

## What is promised and what is not

Promised:

- Without `--group` and `BELLPR_GROUP`, nothing changes, except that
  text shaped exactly like a participant token is masked.
- A stopped or damaged group is never recreated or repaired silently.
- A problem with group work never unpairs a device. Only a removal that
  asks for it (`"unpair": true`) does.
- Invite codes work once and are short-lived.
- Two holds that are held at the same time in one repository never meet:
  BELL PR refuses the second. A hold is taken whole or refused whole.
- No participant token and no invite code is put in a URL or written to a
  log.
- Group work adds no listener, no dependency, no account, no cloud call and
  no telemetry.

Not promised:

- **Writing is not protected.** A hold records who says they work on which
  files, and it stops nobody: an agent, an editor or a push can change any
  file, held or not. Holds are not compared with what a contribution
  changes, and BELL PR's agents do not read them.
- **A hold covers only the paths it names.** Two people who hold different
  files can still make changes that do not work together.
- **Who is looking at a board (`present`) is best effort.** It is kept in
  memory, and a person stays listed for up to 40 seconds after they left.
- **Nothing is cleaned up.** The record keeps every ended hold
  ([Limits](#limits)), and BELL PR never deletes a bare copy.
- **People cannot be deleted or renamed, and a token cannot be changed.**
  Remove the person and invite them again.
- **A repository cannot be taken out of the group or renamed there.**
- **Roles are not a security boundary.** Everyone in the group uses a
  paired device (or sits at the host), and a paired device can use
  everything in that BELL PR: start agents, read every project, publish.
  Admin and member only decide who may invite and remove people, add
  repositories to the group and revoke someone else's hold.
- **One host.** If the BELL PR on the host is down, the group is down.
- **No Group page yet.** Until it ships, the command line and the API are
  the only way to use group work.
