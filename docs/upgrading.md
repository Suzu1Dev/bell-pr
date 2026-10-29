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
4. Start BELL PR again. It prints its address, and `bell-pr open` opens it
   again whenever you need it.

`bell-pr version` shows the version you run and its release date.

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
keep their own in your home directory. A `license.json` that an older
version left in the data directory is ignored.

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
anywhere. Use the same `--data-dir` with `bell-pr open` and `doctor`. Do
not move the old folder to `~/.bellpr`: its records hold
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
