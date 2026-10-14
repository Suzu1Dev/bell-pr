# Licensing

BELL PR has two plans. **Free** covers the whole contribution loop, one
contribution at a time. **Pro** adds bigger and parallel agent teams,
GitHub-wide discovery, more recommendations, maintainer-feedback coaching
and follow-up rounds, learning-record export, web access for agents and
deep reasoning efforts. Every data directory can try Pro for 14 days.

A license key unlocks Pro. BELL PR checks it on your computer, offline:
there is no account and no license server, and activating a key or
starting the trial sends nothing anywhere.

> **1.0.0-rc.1:** this release candidate ships without the public key that
> checks license keys, so no license key can unlock Pro in it yet. The
> 14-day trial works. See the [changelog](../CHANGELOG.md).

## Free and Pro

<!-- generated:plan-table locale=en -->

| Feature | Plan | Limits |
| --- | --- | --- |
| Repositories and contribution runs | Free | Unlimited repositories and runs |
| Project analysis with verified recommendations | Free | Up to 5 recommendations per analysis; re-analysis is allowed. Recommendations you already generated (up to 30) stay visible after a downgrade. |
| More recommendations ("Generate 5 more", up to 30 per project) | Pro | Free: 5. Pro: up to 30 per project. |
| Agent team size | Free (limited) | Free: Lead, 2 teammates, Reviewer and Test analyst. Pro and trial: 3 or 4 teammates. |
| Concurrent runs | Free (limited) | Free: one contribution at a time; other runs wait in the queue. Pro: up to your configured limit (2 by default, at most 8). |
| Plan approval and revision, team inbox, retry of failed subtasks | Free | Up to 3 plan revisions |
| Diff review, explanations, follow-up chat, notes, suggested review order | Free | No limit |
| Re-run Reviewer and Test analyst | Free | No limit (part of the human review safety gate) |
| Rule-aware PR draft, preflight checks, publishing a Draft PR | Free | Human approval is required on every plan |
| Syncing a run onto the latest target branch, agent conflict resolution, updating a project's local clone | Free | No limit (unpublished runs and published PRs) |
| Learning notes page | Free | No limit |
| Learning record export (Markdown) | Pro | Free: not available (the notes page stays Free) |
| Maintainer feedback, CI coaching and AI follow-up rounds | Pro | Free: not available; the sample project shows example feedback labelled PRO. Follow-up rounds already on a run stay readable after a downgrade, and an open round can still be reviewed, pushed, stopped or discarded. |
| Discovery (GitHub-wide recommendations) | Pro | Free: labelled sample results only. Results you already have stay readable, and a running discovery can still be cancelled. |
| Web access for agents | Pro | Free: off. Pro: off until you turn it on. Claude Code may then open pages on GitHub's own sites only; the Codex CLI uses OpenAI's web search. |
| Deep reasoning efforts (xhigh, max, ultra) | Pro | Free: choose none to high. Leaving the effort on "Default" uses the model's own default effort on every plan. |
| Providers, model choice, Efficiency modes | Free | Codex CLI and Claude Code, all models, all efficiency modes |
| Sample project / demo (Pro features shown with sample data) | Free | Sample data in your browser only |
| 14-day Pro trial | Free | One per data directory, started only when you choose (in the app or with bell-pr license trial) |
| Pro license term and updates | Pro | Per named user; perpetual use of the builds released within 12 months of purchase |

<!-- /generated:plan-table -->

Moving to Free never takes anything away that you already have: runs,
diffs, analyses, discovery results, notes and the learning page stay
readable, and a run that already started can always be continued or
cancelled. Existing runs keep the team size they started with.

<!-- generated:product-link key=pricingUrl text="Pricing" -->
<!-- /generated:product-link -->
<!-- generated:product-link key=purchaseUrl text="Buy Pro" -->
<!-- /generated:product-link -->

## Start the 14-day trial

- In the app: **Settings → License → Start 14-day trial**, or the same
  button in the dialog that opens when you try a Pro feature.
- On the command line: `bell-pr license trial`.

The trial starts only when you choose, and each data directory gets one.
While it runs, the plan chip reads "TRIAL · Nd" with the days left. When it
ends, BELL PR returns to Free. Setting the computer's clock back does not
extend it.

## Activate a license key

A license key is one long line that starts with `BELLPR1.`. Use any of
these ways:

- **In the app:** **Settings → License**, paste the key and choose
  **Activate**. Line breaks in the pasted key do not matter.
- **On the command line:**

  ```sh
  bell-pr license activate <key>
  ```

  To keep the key out of your shell history, pass `-` and give it on
  standard input, for example `bell-pr license activate - < key.txt`.
- **With an environment variable:** set `BELLPR_LICENSE_KEY` before BELL
  PR starts. It wins over a key saved in the data directory, and the app
  then shows the license read-only; change or remove the variable and
  restart to change the license. Keep a file that holds the variable
  private (`chmod 600`).

The CLI changes the license of a data directory; a BELL PR that is running
with that data directory picks up the change within a few seconds. Add
`--data-dir <dir>` for a data directory other than `~/.bellpr`. In Docker,
pass `-e BELLPR_LICENSE_KEY` to `docker run`, or run
`docker exec -i <container> bell-pr license activate - < key.txt`.

Other commands:

| Command | What it does |
| --- | --- |
| `bell-pr license` or `bell-pr license status` | Shows the plan, the license id and the dates; `--json` for scripts |
| `bell-pr license activate <key>` | Checks and saves a key (`-` reads it from standard input) |
| `bell-pr license deactivate` | Removes the saved key; the plan returns to Free (or the trial) |
| `bell-pr license trial` | Starts the 14-day trial |

BELL PR never prints or logs a key. Logs record only the license id and the
plan.

## How the key is checked

A key holds a small signed record. BELL PR verifies its Ed25519 signature
against the public keys built into each release, and checks the dates
against the computer's clock and the build's release date. Nothing is
sent anywhere, so it works offline and behind firewalls. The key is saved
in `<data dir>/license.json`, readable by your user only (mode 0600).

## What a key contains

- a license id, such as `lic_01J…`, which support uses to find your order;
- the plan (Pro) and the number of seats;
- the date it was issued;
- the end of its update period (see below);
- for a time-limited license, its end date; a perpetual license has none;
- optionally, a name and an e-mail address. They are present only if the
  seller put them in when issuing the key; keys handed out from a
  pre-issued pool carry neither. Settings → License shows them when they
  are present.

## The update period

A Pro license is per named user and covers, by default, **perpetual use of
the builds released within 12 months of purchase**. `bell-pr license status`
shows the end as "Updates: builds released until …".

- A build released within the period accepts the key forever.
- A build released after the period does not accept it: the plan is Free
  with the reason "The license key does not cover this build of BELL PR".
  Keep using a build released within the period, or renew the license.
  Your data stays readable either way (see [Upgrading](upgrading.md)).
- `bell-pr version` shows when your build was released ("built …").

A time-limited license ends on its end date, and Pro stays on for 7 more
days of grace; `bell-pr license status` says until when.

## Revocation

A license id can be revoked, for example after a refund. Each release
carries its own list of revoked ids and checks it offline, so **a
revocation takes effect in the builds released after it**. A build that was
already installed keeps accepting the key.

## Seats and computers

Each seat belongs to one named user, who may install BELL PR on several of
their own computers; a seat is not shared between people. The license
agreement ([LICENSE.md](../LICENSE.md)) sets out the terms. Each data
directory keeps its own activation, so activate the key on each computer
(or data directory) where you use Pro.
