# BELL Suite link

BELL PR is one of three BELL products, next to BELL Explain and BELL
Personal. Each one runs on its own and has its own address. The Suite
link tells BELL PR where the other two are, so you can move between them,
and it describes BELL PR to them in the form the BELL Suite contract
(version 1) sets. It is off until you set `BELLPR_SUITE_LINKS`, and BELL
PR works the same without it.

## Link the other products

Set `BELLPR_SUITE_LINKS` in BELL PR's environment or `.env` file and
restart BELL PR:

```sh
BELLPR_SUITE_LINKS=explain=http://127.0.0.1:<port>,personal=http://127.0.0.1:<port>
```

- Name `explain`, `personal` or both, each once, separated by commas.
- Each value is an origin: scheme, host and port, with no credentials,
  path (not even a trailing `/`), query, fragment, wildcard or port 0.
- The origin is on this computer (`localhost`, `127.x.x.x` or `[::1]`), or
  an `https` `*.ts.net` name in the same tailnet as `BELLPR_PUBLIC_URL` or
  `BELLPR_ALLOWED_ORIGINS`, for example `personal=https://<your-url>`.
- It is never BELL PR's own address.

BELL PR does not start with a value that breaks one of these rules. The
message names the variable and never repeats the value.

## The product switcher

Once a product is linked, a **Switch BELL product** button shows at the
end of the sidebar's logo row (beside the menu button on a narrow
screen). It lists the three products: a linked one is a link that opens
in the same tab, BELL PR is marked as the current one, and the rest read
"Not linked". The link is the address you set and nothing more. BELL PR
adds no token, run or other data to it.

Your browser keeps each product's sign-in under that product's own
address, and `localhost` and `127.0.0.1` count as different addresses.
So that a link from another product opens BELL PR without asking for its
access token again:

- pair that browser with BELL PR once (`bell-pr pair`, see
  [Pairing devices on your tailnet](self-hosting.md#pairing-devices-on-your-tailnet));
  the token that `bell-pr open` passes stays in the one tab it opened;
- use one host name for this computer everywhere: the one you open BELL
  PR with is the one the other products should link to, and the same
  goes for the addresses in `BELLPR_SUITE_LINKS`.

## What BELL PR serves

Two addresses, both read-only and both behind the same protection as the
rest of the API: the trusted-host and origin checks and BELL PR's access
token. Neither sends a CORS header.

`GET /api/suite/manifest` says what this product is: its contract id
(`pr`), its name, a summary of a few words, the path of the feed below,
the route of a run (`#/runs/{id}`) and the origins from
`BELLPR_SUITE_LINKS`.

`GET /api/suite/today` lists the runs that wait for you or for BELL PR:

| State | Runs |
| --- | --- |
| `needs-you` | A plan to approve or, in a Learn-by-hand run, to write; a change to review or to make by hand; a follow-up round that is ready; an approved run that is not published yet; a failed run. |
| `waiting` | A queued or running run, a follow-up round in progress, a run being published. |

It holds two counts (`needsYou` and `waiting`) over all of those runs and
at most five of them, what needs you first and then the newest. Version 1
lists no published run, so a pull request that waits for its maintainers
is not in the feed. Cancelled runs, runs whose working files were
removed and a run that was split into smaller ones (its parts are listed
instead) are left out too.

For each listed run BELL PR sends exactly this:

- its id and the route that opens it (`#/runs/<id>`);
- its title, as one line of at most 120 characters. When you did not name
  the run, its title is the first 72 characters of your request, as
  everywhere in BELL PR;
- its state, with a fixed phrase for it such as "Ready for your review";
- the time of its last recorded step.

Nothing else leaves BELL PR through these addresses: not the rest of your
request, the plan, the diff, log lines, the project's name or address,
paths, branch names, the pull request's address, the AI provider or
usage.

The summary and the phrases follow the request's language: the
`X-Bell-Locale` header, then `?locale=`, then the language chosen in the
app, then `BELLPR_LOCALE`.

## What does not work yet

No other BELL product can read the feed yet. Both addresses need BELL
PR's access token, and BELL PR has no read-only credential: the install
token and a paired device's credential both give full access, so neither
belongs in another product. Until the contract says how a reader presents
a credential that can only read the feed, the Suite link is the switcher
in your browser and the two addresses for your own use.
