# Upgrading

BELL PR keeps all of its data in one data directory, `~/.bellpr` unless
you chose another one. A new version opens the data directory the old one
wrote, and from 1.0.0 on, an older version can still open what a newer one
wrote: new fields are optional and reads ignore fields they do not know.
Nothing is migrated or moved behind your back.

## Update

1. Wait until no run is executing, then stop BELL PR (Ctrl+C in its
   terminal, or stop the service or container). Agents that are still
   running when BELL PR stops are stopped too; their runs show what
   happened, and failed subtasks can be retried.
2. Back up the data directory (see below).
3. Install the new version:
   - installed with npm: `npm install -g bell-pr@latest`;
   - with `npx`: run `npx bell-pr@latest`, which fetches the newest
     version;
   - Docker: build or pull the new image and replace the container with
     the same volumes, as [Docker](docker.md#update) describes.
4. Start BELL PR again and sign in with the link it prints, or with
   `bell-pr open`. Every restart signs browsers out.

`bell-pr version` shows the version you run and its release date.

When a new version comes with a new version of the license agreement, BELL
PR asks you to accept it before you continue.

## Before you update: your license's update period

A Pro license covers the builds released within its update period: 12
months of updates from the date your key is issued, by default.
`bell-pr license status` shows the end ("Updates: builds released until
…"). A build released after that date
runs on Free; the build you have keeps working with Pro. See
[Licensing](licensing.md#the-update-period).

## After you update to 1.2: check each project's rules again

1.2 reads more from a project's rules: the kinds of help that the
project's own text says are fine (a Learn-by-hand run can be fitted to
them), the places where the project's people talk, and the rules in BELL
PR's checked list of rules that projects publish outside their
repositories (only entries BELL PR's publisher has signed off). It also
reads some rules more precisely: for example, a rule against crediting AI
as a co-author or against large AI-generated pull requests is now a rule
to weigh rather than a ban, more ways of saying that a project refuses
AI help in contributions are found as bans, rules written with typographic
apostrophes and hyphens or with invisible characters are found, and
quotes leave the invisible characters out.

All of this reaches a project only when BELL PR reads its rules: at
import, with **Update to the latest version**, or with **Check again** on
the **Before you contribute** card. For a project you imported before
1.2, choose **Check again** after the update. Until then BELL PR uses the
rules it read before (what each stored rule covers is worked out again
from its quote, at once), finds no carve-out in them, and so can't fit a
Learn-by-hand run to the project's text.

## Learn-by-hand runs and older versions

Learn by hand is new in 1.2: open Learn-by-hand runs only with 1.2 or
later. An older version still opens the data directory and the run, as
every older version does, but it doesn't know Learn by hand:

- It can't approve the run's plan. The guide's outline is kept outside
  the agent team's task list, so an older version finds no plan to
  approve and never starts teammates from it.
- It ignores the help a fitted run was limited to and never shows the
  quoted confirm: its checks block publishing wherever the project's
  rules decline AI-assisted contributions.
- It could offer what 1.2 refuses in a Learn-by-hand run: AI follow-up
  rounds, the conflict agent, sending the plan back for a team plan, or an
  AI-drafted pull request description.
- When an agent changes the run's files there, or a teammate, a team
  task, an AI follow-up round or an agent conflict resolution joins the
  run, 1.2's record of that run withdraws the Learn-by-hand claim for
  good and says why.

## Back up the data directory

Stop BELL PR, then copy the whole data directory, for example:

```sh
cp -a ~/.bellpr ~/bellpr-backup-$(date +%Y%m%d)
```

Copy all of it: the run records in `state.json` point at the clones and
working copies next to them, which hold changes that exist nowhere else
yet. Restore a backup to the **same path**: `state.json` and Git's
worktree records contain absolute paths, so a data directory moved to
another path or another computer does not work as it is. BELL PR also
keeps the last three versions of `state.json` (`state.json.bak.1` to
`.bak.3`) and falls back to them by itself if the file is damaged.

The data directory holds no sign-ins: the GitHub CLI and the agent CLIs
keep their own in your home directory. A license key saved in
`license.json` is part of the backup.

## Data from versions before 1.0

Versions before 1.0, which ran from a source checkout with `npm run dev`,
kept their data in a `.bellpr` folder inside the folder they were started
from. Since 1.0 the default is `~/.bellpr` in your home directory. When
BELL PR starts in a folder that still has old data in `./.bellpr`, it says
so and moves nothing:

```text
Found BELL PR data in ./.bellpr. BELL PR now uses /home/you/.bellpr and moved nothing. To keep using the old folder, start it with: bell-pr start --data-dir ./.bellpr
```

To keep working with that data, start BELL PR with it, from that folder:

```sh
bell-pr start --data-dir ./.bellpr
```

or give its absolute path with `--data-dir` (or `BELLPR_DATA_DIR`) from
anywhere. Use the same `--data-dir` with `bell-pr open`, `doctor` and
`license`. Do not move the old folder to `~/.bellpr`: its records hold
absolute paths (see above).

A few things change when old data meets the new version:

- **Local projects.** Earlier versions worked directly in a repository you
  imported from your computer. BELL PR now clones such a project into its
  data directory when its next run starts, once none of its runs still has
  a worktree in your repository. Until then its runs keep working there.
  Branches those runs added stay in your repository; delete them yourself
  when you no longer need them.
- **Partial clones from 1.0.0-beta.0.** GitHub projects are now cloned in
  full. A project that 1.0.0-beta.0 cloned partially gets every object,
  through the GitHub CLI, the first time BELL PR updates it or starts a
  contribution on it.
- **Text already written** (logs, reports, explanations) stays in the
  language it was written in; nothing is translated.

## Going back to an older version

From 1.0.0 on, a data directory that a newer version used still opens in an
older one: the older version ignores what it does not know. Features the
older version lacks are simply not shown. Keep the backup from before the
update anyway, in case you need to return to exactly that state.
