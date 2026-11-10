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
held, and one whose work
[waits for other work](#work-that-waits-for-other-work) that is not done
yet. Everyone who follows that repository's
[live feed](#the-live-feed) hears of each change. All of that is the API
only. The Group page comes later: nothing in the app shows the group yet.
Two things change in the app: BELL PR
[publishes no change that touches someone else's hold](#publishing-over-someone-elses-hold),
and [its agents are held to the same holds](#bell-prs-agents-and-someone-elses-hold).
A hold still **does not stop a tool outside BELL PR, an editor or a push**
from writing inside it or outside it.
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
  work** in that BELL PR, with the reason `notSingleWriter`. So does one
  that could not be read at a moment BELL PR checked it. It writes nothing
  more to the group's files until it is restarted.

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
person cannot be deleted. After that, a join that would add a person
answers 409 with `reason: "full"`. A code a person made for themself still
works, because it adds nobody.

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
  403 (`notJoined`) from then on. The invite codes they gave out with
  their participant token, and a code they made for themself, stop
  working. A code made at the host with the install token is the host's,
  whoever typed the command, and keeps working.
- Whatever the person holds ends, in every repository of the group: each
  [hold](#holds) is revoked in the admin's name. `revoked` in the answer
  counts them. Their requests waiting on a [live feed](#the-live-feed) end
  at once. A hold they were taking at that moment does not stay: it is
  revoked with the others, or refused with 403 `notJoined`. Sending the
  removal again is harmless: it ends whatever that person still holds.
- Removing does not unpair anything by itself: a removed person on a
  paired device can still use everything else in that BELL PR. With
  `"unpair": true`, the paired device the person first joined from is
  unpaired too, when one was recorded; the answer says so
  (`"unpaired": true`). Two devices are never unpaired this way
  (`"unpaired": false`): the one the request comes from, and one that a
  person still in the group first joined from. A device added with a code
  for oneself is not recorded: it is not unpaired with its person, and it
  is not kept when another person who first joined from it is removed.
  Check with `bell-pr devices list`, and revoke a device with
  `bell-pr devices revoke <id>`.
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
  name it had when it was added (its first 200 characters). Deleting it
  from BELL PR (**Delete repository**, or **Delete all data**) leaves it
  in the group under that name, with its holds and its bare copy.

What cannot be added:

- a repository this BELL PR does not have (400 `unknownRepository`); import
  it first;
- a repository that is already the group's, or is being copied right now
  (409 `alreadyAdded`);
- a repository whose default branch is not in BELL PR's clone, or has a
  name the group's record does not take (more than 200 characters, a first
  character that is not a letter or a digit, or any character but letters,
  digits, `.`, `_`, `/` and `-`): it is not in `addable`, and adding it is
  answered `cloneFailed`;
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

- `title` says what the work is: 1 to 120 characters. A control character
  in it becomes a space, and so does a character that embeds, overrides or
  isolates the direction of text (U+202A to U+202E, U+2066 to U+2069). A
  direction mark (U+200E, U+200F, U+061C) stays as it is.
- `scopes` are the paths: 1 to 50 files or folders, each relative to the
  top of the repository, with `/` between its parts, at most 300
  characters. A leading `./` and one trailing `/` are dropped.
  [Paths that cannot be held](#paths-that-cannot-be-held) lists what is
  refused.
- `dependsOn` is optional: the tasks of this repository that must be done
  before this work starts, at most 50 task ids (each the `taskId` of an
  earlier hold). [Work that waits for other work](#work-that-waits-for-other-work)
  says when it is refused.

The answer (201) is
`{ "hold": { claimId, taskId, title, holder, scopes, fence, since, dependsOn? } }`.
Keep `claimId` and `fence`: releasing the hold needs both. Each hold makes
its own task, and `taskId` names it. `dependsOn` is there only when the
work named tasks: each as `{ taskId, title }`.

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
way too. To hold more paths, release the hold and take a new one with all
of them; between the two, anyone else can take them.

When two people ask for paths that meet at the same moment, one gets the
hold and the other is refused. A task made for the refused one can stay in
the group's record ([Limits](#limits)); no board shows it.

### Check first

`POST /api/collab/projects/<project id>/check` with `{ "scopes": […] }`
asks the same question and takes nothing. The answer (200) is
`{ asOf, invalid, meets }`: `meets` lists each held path in the way with
its `claimId`, `taskId`, title and the holder's name, and `invalid` lists
the asked paths that cannot be held. The answer is true at `asOf`; someone
can take a path a moment later.

### Release and revoke

- **Release.** The person who holds it sends
  `POST /api/collab/projects/<project id>/holds/<claimId>/release` with
  `{ "fence": <fence> }`. Someone else's hold is answered 403 `notHolder`,
  a fence that is not this hold's 409 `staleFence`, and a hold that has
  already ended 409 `ended`. With `"done": true` as well, the release also
  says that the hold's task is done, so work that
  [waits for it](#work-that-waits-for-other-work) can start. A refused
  release marks nothing done.
- **Revoke.** An admin ends anyone's hold with
  `POST /api/collab/projects/<project id>/holds/<claimId>/revoke` and the
  body `{}`. A member is answered 403 `adminOnly`.

A hold that ended is no longer on the board, and neither is its task: the
board shows only what is held now. Its paths are free for a new hold.

### Work that waits for other work

A `work` request can name, in `dependsOn`, tasks of the same repository
that must be done before its work starts. A task is done once the person
who held it released it with `"done": true`. A hold released without it,
or revoked, leaves its task not done for good: a task is never held again,
and nothing else marks it done. Releasing a hold to take a wider one makes
a new task too. Work that waits for such a task has to name the new one.

- An id that is not a task of this repository (a task of another
  repository, or an id nobody made) is refused with 400
  `dependencyUnknown`, and `unknown` lists those ids.
- A task that is not done yet is refused with 409 `dependencyPending`, and
  `pending` lists each one with its `taskId`, its `title` and `held`:
  whether someone holds it now.
- Both are asked after the paths' shape and before a `conflict`. When
  either refuses, nothing is made or held, and the request still counts
  toward the `work` limit.
- An id named twice counts once.

Once every task it names is done, the same request is taken. Nothing tells
the person who waits, but the [live feed](#the-live-feed) changes when the
hold they wait for ends.

Tasks cannot wait for each other in a cycle. Each hold makes a new task,
it can name only tasks made before it, and what a task waits for never
changes. Done is what the task's holder said, nothing more: BELL PR does
not check that the work was merged, pushed or integrated. A hold that was
taken stays held when something it waited for changes.

### Publishing over someone else's hold

BELL PR publishes no change that touches a path someone else in the group
holds: neither a run's first pull request nor a follow-up round. It asks
right before anything is committed or pushed, about every file the change
adds, changes or deletes (a moved file counts at both of its paths), with
the rules between two holds: a folder holds everything inside it, and
letter case is ignored. The publish dialog shows the files as a block,
each with the holder, the hold's title and since when.
`POST /api/runs/<id>/publish` is answered 409 with `reason: "heldByOther"`
and `held`, a list of `{ path, claimId, holder, title, since }`. The block
cannot be ticked or overridden. Once the holder releases the hold, or an
admin revokes it, the same change publishes.

Only repositories of the group are checked, and only someone else's hold
stops a change. Who you are:

- With the `x-bell-participant` header, the person whose token it is. An
  unknown token, or one of someone removed, is answered 403 `notJoined`.
- Without it (the app sends none yet), everyone in the group who joined
  from the device that asks. The install token counts as one device:
  everyone who joined at the host.

While group work [has stopped](#when-group-work-stops), BELL PR cannot
tell who holds what, so nothing in a repository of the group is
published: the dialog shows a block, and the publish request is answered
503 with `reason: "holdsUnknown"`. A repository outside the group
publishes as before, as long as `collab.json` still says which
repositories are in the group. Fix group work and restart BELL PR, or
start it without `--group`: then nothing is checked.

### BELL PR's agents and someone else's hold

A run belongs to the people who started it, worked out as for publishing:
the person of the `x-bell-participant` token, or else everyone in the
group who joined from the device that started it. BELL PR keeps them with
the run, so they stay its owners after a restart. A run nobody in the
group started (a device where nobody joined) has no owners, and then
every hold counts as someone else's. An unknown token, or one of someone
removed, is answered 403 `notJoined` and no run is started.

In a repository of the group, a run's agents are held to the holds of
everyone else:

- **The agents are told.** Every turn that may change files gets the
  paths other people hold, and the paths its own people hold, read again
  for each turn. Only the paths: not who holds them or why.
- **A plan over someone else's hold waits.** A plan that would start on
  its own waits for approval instead, with a notice that it covers files
  someone else holds. Approving a plan that covers such a file is
  answered 409 with `reason: "heldByOther"` and `held`, as for
  publishing. Send the plan back with feedback, or approve it once the
  hold is released.
- **A teammate's change is checked before it is added.** When a
  teammate's task is integrated, its changed files are compared with the
  holds right after the check that they stay inside the task. A change
  over someone else's hold is not added: the run stops with the files,
  and the teammate's own checkout keeps the change.
- **A turn in the run's checkout is checked after it ends.** After a
  turn from the **Collaborate** tab, a follow-up round or a turn that
  resolves sync conflicts, every file the run changed since its base (new
  files too, and a moved file at both of its paths) is compared with the
  holds of that moment.
  A change over someone else's hold stops the turn with the files.
  Nothing is undone: the changes stay in the checkout for review, and a
  follow-up round keeps them without a commit message. The person sees
  who holds each file; the run's later turns, and the PR draft written
  from the run, are told only the paths.

Turns that only read or review, and turns that work outside the run's
checkout, are not checked. While group work
[has stopped](#when-group-work-stops), turns that may change files and
plan approvals in a repository of the group are answered 503 with
`reason: "holdsUnknown"`, and a plan that would start on its own fails;
turns that only read go on. Without `--group`, and in a repository
outside the group, nothing is checked.

### What a hold does not do

A hold is a record the group can see, the reason a second hold that meets
it is refused, the reason BELL PR does not
[publish a change over it](#publishing-over-someone-elses-hold), and a
[limit for BELL PR's agents](#bell-prs-agents-and-someone-elses-hold). It
**does not stop a write as it happens**: an agent's change is found when
its turn ends, an editor or a tool outside BELL PR is not checked, and
nothing is locked in a checkout or on GitHub. A push made outside BELL PR
is not checked at all. A hold says nothing about a path nobody named, and
nothing about two changes in different files that do not work together.

## The live feed

`GET /api/collab/projects/<project id>/feed` answers with one repository's
board: the people of the group, what is held (oldest first) and the ids of
the people looking at that board now (`present`). Each answer carries
`epoch`, `version` and `seen`. A caller that sends them back with
`wait=<seconds>` (0 to 25) is answered as soon as the board or `present`
changes, and with 204 when nothing changed in that time, so asking again
in a loop follows the board as it changes. A person counts as present
while a request of theirs waits and for 40 seconds after their last one;
presence is best effort. One person can have 2 requests waiting, over all
repositories, and the group 64; one more is answered 429 `tooManyWaiters`,
while a request with `wait=0` is still answered. BELL PR also keeps at
most 8 feed answers that one person's connections have not taken yet:
until one is read or its connection closes, every further feed request of
that person is answered 429 `tooManyWaiters`, with `wait=0` too. A caller
that reads each answer before it asks again never meets that limit. After
BELL PR restarts the `epoch` is another one, and the next answer has the
whole board again.

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
  `invalid`;
- a path that is a symbolic link, or goes through one or into a
  submodule, on the repository's default branch in BELL PR's copy on the
  host, in any letter case. Git records a change at the file's real path,
  and a submodule as one entry, so such a hold would protect nothing. Hold
  the real path, or the submodule as a whole.

The other rules are about spelling only. They exist so that two spellings
of one file always meet, on every file system a person in the group may
use.

## Limits

| What | Limit | Past it |
| --- | --- | --- |
| Paths in one hold, or in one `check` | 50 | 400 `tooManyScopes` |
| Length of a path | 300 characters | 400 `invalidScope` |
| Title of a task | 120 characters | 400 |
| Tasks one `work` request names in `dependsOn` | 50, each id at most 64 characters | 400 |
| `work` requests of one person | 30 in 10 minutes, taken or refused | 429 `slowDown`; `retryAfter` is the seconds to wait |
| `check` requests of one person | 120 in a minute | 429 `slowDown`, the same way |
| Feed requests waiting | 2 for one person, 64 for the group, over all repositories | 429 `tooManyWaiters` |
| Feed answers one person's connections have not taken yet | 8 | 429 `tooManyWaiters`, until one is read or its connection closes |
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
further path adds a little more than its own length. A small group that
takes a few holds each working day uses well under 1 MB a year: three a
day come to about 0.5 MB, and ten a day to about 1.6 MB. The record has
room for more than 10 000 such holds. The limits above slow a person down;
they do not keep someone in the group from filling the record on purpose.

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
| `POST /api/collab/projects/<project id>/work` with `{ title, scopes, dependsOn? }` | anyone who joined | 201 `{ hold }`; 400 `invalidScope`, `tooManyScopes`, `dependencyUnknown`; 404 `unknownProject`; 409 `conflict`, `dependencyPending`, `full`; 429 `slowDown` |
| `POST /api/collab/projects/<project id>/holds/<claimId>/release` with `{ fence, done? }` | the person who holds it | 200 `{ ok: true }`; 403 `notHolder`; 404 `unknownProject`, `unknownClaim`; 409 `staleFence`, `ended` |
| `POST /api/collab/projects/<project id>/holds/<claimId>/revoke` with `{}` | an admin | 200 `{ ok: true }`; 403 `adminOnly`; 404 `unknownProject`, `unknownClaim`; 409 `ended` |

- `state` is `notSetUp`, `ready` or `stopped`. `GET /api/status` carries
  the same `collab: { state, reason? }`.
- While group work is not ready, every request but `GET /api/collab` and
  the set-up answers 503 with `reason` `notSetUp` or `stopped`. The one
  request whose write stops group work can answer 503 with the reason
  itself, `notSingleWriter` or `unavailable`.
- Where a request needs a participant, a missing, unknown or removed
  participant token is answered 403 with `reason: "notJoined"`, never 401
  (`GET /api/collab` answers 200 without `me`). A 401 still means what it
  meant before: the app token is missing or wrong.
- A refusal is `{ reason, error }`: `reason` is the word in the table and
  `error` a sentence in the language of the request's `x-bell-locale`
  header (English or Traditional Chinese). Five refusals say more:
  `conflict` carries `conflicts`, `invalidScope` carries `invalid`,
  `dependencyUnknown` carries `unknown`, `dependencyPending` carries
  `pending`, and `slowDown` carries `retryAfter`, in seconds.
- A body of the wrong shape (a missing or unknown field, a wrong type, a
  title that is too long) is answered 400 with `error` only.
- With the switch, `GET /api/runs/<id>/preflight` and
  `POST /api/runs/<id>/publish` also check holds:
  [Publishing over someone else's hold](#publishing-over-someone-elses-hold).

## When group work stops

Group work stops when its files cannot be trusted or written: one of them
is missing or damaged, a write to `coordination.json` failed, or the lock
is no longer this process's. A stopped group stays stopped until the cause
is fixed and BELL PR is restarted. BELL PR never creates either file again
by itself and never repairs one: nothing is assumed about a group whose
record is gone. The rest of BELL PR keeps working, except that nothing in
a repository of the group is
[published](#publishing-over-someone-elses-hold), and no agent turn that
may change files and no plan approval
[runs there](#bell-prs-agents-and-someone-elses-hold). BELL PR notices a stop
at the next request that reads or writes the group's record or asks for
its state, and at the latest when a request waiting on a
[live feed](#the-live-feed) has waited its time. At that moment every
request waiting on a live feed is answered 204, and a repository being
copied for the group is given up.

A failed write to `collab.json` after set-up does not stop group work: the
request fails and the file keeps what it held. When that happens in a
join, the invite code is spent and the person is not in the group (no
token was given out), but they count toward the 1000. Invite them again.
When it happens while a repository is added, the answer is `cloneFailed`,
the copy is deleted and the repository is not in the group, but it counts
toward the 100. Add it again. When it happens in a release with
`"done": true`, the hold has ended but its task is not done, and it cannot
be marked done any more: work that waits for it has to name another task.

`bell-pr group status` prints the reason, and the server log has it in a
"Group work stopped" line;
[Group work has stopped](troubleshooting.md#group-work-has-stopped) says
what each one means and what to do.

## The files it writes

All are in the data directory, only with group work: the two files from
`bell-pr group setup` on, the folder from the first repository added.

| File | What it holds |
| --- | --- |
| `coordination.json` | Each person's id, role (admin or member), the time they were added and the SHA-256 of their participant token; never the token. Each repository of the group, with the folder of its bare copy and the commit it was copied at. Each task, with who made it and when, and every hold, ended ones included: its paths, who holds it, when it was taken and when and by whom it ended |
| `collab.json` | The group's id and set-up time, and for each person: name, the time they joined, whether they are an admin, the time they were removed, and, when they joined from a paired device, that device's id. For each repository: its name, its id in this BELL PR and the time it was added. For each task: its title, the tasks its work waited for, and when its holder said it is done |
| `collab/<project id>.git` | The group's bare copy of a repository: the commits and files of its default branch, as they were when it was added |

The lock file `bellpr.lock` also carries `"strict": true`. Back the two
files and the folder up and restore them together: one of the two files
without the other stops group work. Deleting the data directory deletes the
group. **Delete all data** in Settings does not: it leaves the two files
and the folder as they are.

Do not start a build of BELL PR from before the group had repositories
with `--group` on this data directory. The first time such a build saves
`collab.json` (a join or a removal), it writes the file without the
repositories' names and the tasks' titles, and the group's repositories
are gone from the group. A build from before tasks could wait for other
work drops, the first time it saves `collab.json`, what each task waited
for and when it was done: from then on a done task is not done, work that
waits for it is refused, and the holds already taken stay held but no
longer list `dependsOn`.

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
- Work that names tasks in `dependsOn` is held only once each of them is
  done. Otherwise nothing is made or held.
- BELL PR publishes no change, first round or follow-up, that touches a
  path someone else in the group holds at that moment, and while group
  work has stopped it publishes nothing in a repository of the group.
- In a repository of the group, BELL PR approves no plan that covers a
  path someone else holds, adds no teammate's change over such a path, and
  stops a turn whose changes in the run's checkout touch one. While group
  work has stopped, no agent turn there changes files.
- No participant token and no invite code is put in a URL or written to a
  log.
- Group work adds no listener, no dependency, no account, no cloud call and
  no telemetry.

Not promised:

- **A hold stops no write as it happens.** An editor, a tool or a push
  outside BELL PR can still change any file, held or not. A BELL PR agent
  is told the held paths, but its change is found only when its turn ends
  or its task is integrated, and nothing is undone then. Each check uses
  the holds of that moment: a hold taken later says nothing about what was
  already changed or published.
- **A hold covers only the paths and the tasks it names.** Two people who
  hold different files can still make changes that do not work together,
  and work waits only for the tasks it names. A task is done when its
  holder says so: BELL PR does not check the work.
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
