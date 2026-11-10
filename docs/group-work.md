# Group work

Group work is for several people who already share one running BELL PR: the
person at the host, and teammates who reach it from
[paired devices](self-hosting.md#pairing-devices-on-your-tailnet). With it,
that BELL PR is set up as one group, and each person joins the group under
a name, as a member or an admin.

This is the first part of group work. Today it is switched on, set up, and
people are invited from the command line and the API. The Group page comes
later: nothing in the app shows the group yet, and no page changes when
group work is on. Group work **does not protect anything at write time**;
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
`token` is the person's participant token (`bpc_…`). It is shown only
here, once, and BELL PR stores only its SHA-256, so keep it like a
password. Every later group request sends it in the `x-bell-participant`
header, next to the app token. `GET /api/collab` with that header answers
with `me`: the id, the name and whether the person is an admin.

Ten wrong codes in 15 minutes lock that caller (one paired device, or the
host) out of joining for 15 minutes. Other people's codes stay valid.

## Use the same identity on another device

A person who has joined asks for a code for themself:
`POST /api/collab/invites` with the body `{ "self": true }` and their
participant token. Sending that code to `POST /api/collab/join` from the
other device answers with the same id, name and token. No person is added.
The host keeps the token in memory with the code for at most 10 minutes.

## Remove a person

A group admin sends `POST /api/collab/people/<id>/remove` with the body
`{}`, or `{ "unpair": true }`.

- The person is marked as removed, and their participant token is answered
  403 (`notJoined`) from then on.
- Removing does not unpair anything by itself: a removed person on a
  paired device can still use everything else in that BELL PR. With
  `"unpair": true`, the paired device the person joined from is unpaired
  too, when one was recorded; the answer says so (`"unpaired": true`). A
  device added with a code for oneself is not recorded: revoke it with
  `bell-pr devices revoke <id>`.
- An admin cannot remove themself (409), and a removal cannot be undone.
  Invite the person again; they join as a new person with a new id.
- A person's id is in the answer to their join and in `collab.json` on the
  host. No request lists the people of a group yet.
- `revoked` in the answer is always 0 today.

## The API in short

Every request carries the app token as any other request does (the install
token, or a paired device's). The routes exist only with the switch.

| Request | Who | Answer |
| --- | --- | --- |
| `GET /api/collab` | anyone with the app token | `{ state, reason?, groupId?, host, me? }`; `host` is true for the install token |
| `POST /api/collab/setup` with `{}` | the install token | 201 `{ state: "ready", groupId }`; 403 `hostOnly`; 409 `exists`, or `missing` when group work has stopped |
| `POST /api/collab/invites` with `{ name, admin?: true }` | the install token, or an admin | 201 `{ code, expiresAt }`; 403 `adminOnly`; 429 `tooManyInvites` |
| `POST /api/collab/invites` with `{ self: true }` | anyone who joined | 201 `{ code, expiresAt }` |
| `POST /api/collab/join` with `{ code }` | anyone with the app token | 201 `{ groupId, id, name, admin?, token }`; 400 `invalidCode`; 429 `joinLocked` |
| `POST /api/collab/people/<id>/remove` with `{ unpair?: true }` | an admin | 200 `{ revoked, unpaired }`; 409 `self`; 404 `unknownPerson` |

- `state` is `notSetUp`, `ready` or `stopped`. `GET /api/status` carries
  the same `collab: { state, reason? }`.
- While group work is not ready, inviting, joining and removing answer 503
  with `reason` `notSetUp` or `stopped`.
- A missing, unknown or removed participant token is answered 403 with
  `reason: "notJoined"`, never 401. A 401 still means what it meant before:
  the app token is missing or wrong.

## When group work stops

Group work stops when its files cannot be trusted or written: one of them
is missing or damaged, a write failed, or the lock is no longer this
process's. A stopped group stays stopped until the cause is fixed and
BELL PR is restarted. BELL PR never creates either file again by itself and
never repairs one: nothing is assumed about a group whose record is gone.
The rest of BELL PR keeps working.

`bell-pr group status` prints the reason;
[Group work has stopped](troubleshooting.md#group-work-has-stopped) says
what each one means and what to do.

## The files it writes

Both are in the data directory, only with group work, from
`bell-pr group setup` on:

| File | What it holds |
| --- | --- |
| `coordination.json` | Each person's id, role (admin or member), the time they were added and the SHA-256 of their participant token; never the token |
| `collab.json` | The group's id and set-up time, and for each person: name, the time they joined, whether they are an admin, the time they were removed, and the id of the paired device they joined from |

The lock file `bellpr.lock` also carries `"strict": true`. Back the two
files up and restore them together: one without the other stops group
work. Deleting the data directory deletes the group.

## What is promised and what is not

Promised:

- Without `--group` and `BELLPR_GROUP`, nothing changes.
- A stopped or damaged group is never recreated or repaired silently.
- A problem with group work never unpairs a device. Only a removal that
  asks for it (`"unpair": true`) does.
- Invite codes work once and are short-lived.
- No participant token and no invite code is put in a URL or written to a
  log.
- Group work adds no listener, no dependency, no account, no cloud call and
  no telemetry.

Not promised:

- **Writing is not protected.** Group work records who is in the group. It
  does not yet record who works on which files, and it stops nobody: an
  agent, an editor or a push can change any file.
- **People cannot be deleted or renamed, and a token cannot be changed.**
  Remove the person and invite them again.
- **Roles are not a security boundary.** Everyone in the group uses a
  paired device (or sits at the host), and a paired device can use
  everything in that BELL PR: start agents, read every project, publish.
  Admin and member only decide who may invite and remove people.
- **One host.** If the BELL PR on the host is down, the group is down.
- **No Group page yet.** Until it ships, the command line and the API are
  the only way to use group work.
