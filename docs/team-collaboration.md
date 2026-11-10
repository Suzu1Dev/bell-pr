# Team collaboration: task state and dependencies

## Scope and decision

This increment improves collaboration between the agents in one contribution.
The existing board already shows each task's owner and file scope, but places
failed tasks in Done and describes every dependency as waiting, including
completed dependencies. The scheduler can also leave a transitive dependent
pending when a failed prerequisite appears later in the plan. These observable
problems make the current collaboration view unreliable, so they come before
adding reads of other contributors' work on GitHub.

## Data and behavior

Use the existing `Run.team.tasks` records: task IDs, titles, owners, file scopes,
dependencies and statuses. No new endpoint or persisted field is needed.

- Keep the three board lanes. Done contains only complete tasks. Failed and
  blocked tasks remain in To do, with their existing explicit status labels.
- Name each dependency and show its current status. A completed prerequisite
  is visibly complete; an unknown task reference keeps its ID and an unknown
  label instead of implying that it has finished.
- Label a ready task in a failed or cancelled run "Ready after retry", on its
  card and in dependency lists, because nothing claims it until the person
  retries. Ready tasks in an active run keep "Ready to claim". The label
  comes from the run's phase; the task's status stays `ready`.
- Wrap long titles and descriptions inside the card, including words with no
  space to break at, so a narrow lane never scrolls sideways.
- Propagate failed or blocked prerequisites through all pending/ready downstream
  tasks before claiming work, regardless of their order in the plan. Never
  claim tasks during propagation-only calls. Keep file ownership, member
  capacity and existing completed/running work intact.
- Apply the same propagation after restart recovery marks interrupted tasks
  failed. Retrying still uses the existing retry path and preserves completed
  work.

The source of truth remains the local run record. The view updates as that
record updates; it does not infer external contributors' ownership or merge
order from agent dependencies.

## Boundaries

No shared accounts, cloud service, telemetry, new runtime dependency, persisted
status value or schema migration. No new GitHub reads, comments, issue claims,
PR publication or change to understanding, maintainer-respect and approval
checks. Existing group-mode checks for this person's overlapping contributions
and split publication order remain in place.

## Verification and ownership

Backend changes cover dependency permutations, transitive blocking, unrelated
work, capacity/file ownership, propagation without claims, and interrupted-run
recovery. Frontend checks cover lane counts, named dependencies, complete and
blocked prerequisites, unknown references, both languages and narrow screens.
Run the focused checks and the required build, lint, full test, i18n,
personal-information and documentation checks before preparing the draft PR.
Backend owns scheduling and recovery; frontend owns the board and translations;
QA owns independent validation; the tech lead owns this scope, documentation
and the reviewed commit.

## Next increment and product decisions

Add an on-demand, read-only view of other contributors' overlapping work using
the existing GitHub reader. A failed or incomplete read must remain unknown.
Do not persist other PRs' file lists or add them to an approval digest without
a separate design review. Coordination text can be drafted locally, with the
person deciding whether to send it.

Before that increment, decide:

1. Start with PRs already linked to the selected issue, or inspect all open PRs
   in the upstream project? Default: linked PRs, with explicit limited coverage.
2. Refresh on request or also before plan approval and publication? Default:
   on request, with a visible last-read time and incomplete-read state.
3. Show advisory information or require another confirmation? Default:
   advisory information, keeping the existing approval checks.
