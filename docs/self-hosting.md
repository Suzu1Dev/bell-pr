# Self-hosting BELL PR

BELL PR runs on your own computer and listens on 127.0.0.1 by default. This
page covers running it as a service and reaching it through a reverse proxy.
For containers, see [docs/docker.md](docker.md).

## Requirements

- Node.js 22 or later.
- git 2.40 or later (syncing a run onto the latest target branch uses
  `git merge-tree --write-tree --merge-base`).
- The GitHub CLI (`gh`), signed in, to publish pull requests.
- At least one agent CLI, installed and signed in: the OpenAI Codex CLI or
  Claude Code.
- Linux or macOS. On Windows, run BELL PR inside WSL2.
- On Linux, bubblewrap and socat, so agents that write code run in the
  operating-system sandbox.

## Install and start

```sh
npm install -g bell-pr
bell-pr
```

`bell-pr` (also `bellpr`) starts the server and prints a line such as
the one below when every required `bell-pr doctor` check passed. If one
failed, start exits before it listens and prints each failed check with
the command that fixes it. `bell-pr start --force` starts anyway and
prints a warning: use that for the sample tour when no AI provider is
signed in. A service should stay without `--force`, so it only runs once
the tools are ready. A real agent run is still refused until a provider
is signed in.

```text
BELL PR 1.0.0 → http://127.0.0.1:4311
```

BELL PR opens that address for you when it runs in a terminal. `bell-pr help`
lists the commands and options, and
[Configuration](configuration.md) and [.env.example](../.env.example)
describe every `BELLPR_*` setting. Load a settings file with
`bell-pr start --env-file <file>`.

Data lives in `~/.bellpr` unless you pass `--data-dir` or set
`BELLPR_DATA_DIR`. BELL PR never moves data by itself: if an older version
left data in `./.bellpr`, it prints how to keep using that folder.

## API token

The first start writes a random token to `<data dir>/api-token` (mode 0600)
and later starts reuse it. A missing or damaged file is created again.
`bell-pr token rotate` replaces it; restart is not required. Every API
request except `GET /api/health` must send the token (`Authorization: Bearer`
or `X-Bell-Token`). A missing or wrong token is HTTP 401 and changes nothing.

BELL PR listens on 127.0.0.1 unless you set `--host` or `BELLPR_HOST`. Any
other address prints a warning at start. Binding `BELLPR_HOST` to `0.0.0.0` or
`::` without `BELLPR_PUBLIC_URL` still opens the port on every interface, but
the request guard only accepts this computer's addresses: **every remote
connection receives HTTP 403** until you set `BELLPR_PUBLIC_URL` to the HTTPS
origin browsers use. Startup prints one stderr line in that case. `--host
0.0.0.0` outside Docker, and publishing the Docker port beyond `127.0.0.1`,
let other machines reach the port once `BELLPR_PUBLIC_URL` is set; they still
need authorization. Put a proxy that limits who can connect in front as well
(see [Reach BELL PR from another machine](#reach-bell-pr-from-another-machine)).

`bell-pr open` prints the address browsers use (`BELLPR_PUBLIC_URL` when
you set it, else the local address) without the API token, and opens that
address with `#bell_token=` on the end. `--print` only prints the address,
still without the token. Prefer pairing for phones and other devices. For
SSH or headless hosts where you cannot pair in a browser,
`bell-pr open --print --print-token` is a fallback that prints
`#bell_token=` as well. The page stores the token and removes it from the
address bar. The line printed at start does not include the token. Treat
the `--print-token` address like a password: it is not in the server log
or in `bell-pr doctor --json`.

## One instance per data directory

BELL PR keeps a lock file, `<data dir>/bellpr.lock`, while it runs. A second
start with the same data directory exits with a message instead of touching
the data, and a start on a port that BELL PR already uses says so and
points to `bell-pr open`. A lock left behind by a crash is detected and
replaced at the next start.

Containers and machines that share a data directory cannot see each other's
processes. On Linux, the lock names the host and PID namespace it was
written in, and the running instance renews it every 10 seconds. A start
elsewhere waits up to 30 seconds: a lock that is no longer renewed, such as
one left by a removed container, is then replaced; one that is still
renewed makes the start exit with the message.

If BELL PR stops unexpectedly while agents are working, it records their
process groups in `<data dir>/children.json`; the next start stops those
leftover agents before it marks the interrupted runs.

## Run as a service (Linux, systemd)

[`contrib/systemd/bell-pr.service`](../contrib/systemd/bell-pr.service) is a
user unit. Install BELL PR, then:

```sh
mkdir -p ~/.config/systemd/user
cp contrib/systemd/bell-pr.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bell-pr
```

The comments in the unit explain the PATH, the optional settings file
`~/.config/bell-pr/environment` and how to keep the service running after
you log out. The service never opens a browser; to get its address, run
`bell-pr open` in a terminal on that machine.
Logs: `journalctl --user -u bell-pr`.

## Reach BELL PR from another machine

Keep BELL PR on `127.0.0.1`. The supported way to reach it from another
machine or your phone is **Tailscale serve** plus `BELLPR_PUBLIC_URL`, then
pair a device (see [Pairing devices on your tailnet](#pairing-devices-on-your-tailnet)).
Never use Tailscale Funnel. Do not put BELL PR on the public internet.
Never serve it over plain HTTP on a non-loopback address.

```sh
tailscale serve --bg 4311
BELLPR_PUBLIC_URL=https://<your-url> bell-pr
```

Use your own HTTPS origin for `<your-url>` (for example a `*.ts.net` name
from Tailscale). Serve BELL PR at the root of that origin, not under a path.
Without `BELLPR_PUBLIC_URL`, requests to that host get HTTP 403. Prefer
pairing over a token URL. The install API token still exists; treat any
address that includes it like a password.

### Advanced: HTTPS reverse proxy (Caddy / nginx)

Only when Tailscale serve is not an option. Run the proxy on the same
machine and forward to `127.0.0.1:4311`. The reverse proxy **must not
rewrite the `Host` header** (keep the original `Host`); rewriting Host
yields HTTP 403. Set `BELLPR_PUBLIC_URL` to that HTTPS origin (no path).
Keep the service off the public internet (VPN or equivalent). The install
API token or a paired device credential is still required.

Caddy (certificates and `X-Forwarded-Proto` are handled for you; do not
rewrite `Host`):

```text
<your-url> {
	reverse_proxy 127.0.0.1:4311
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name <your-url>;
    # ssl_certificate and ssl_certificate_key for <your-url>

    location / {
        proxy_pass http://127.0.0.1:4311;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }
}
```

## Health check

`GET /api/health` answers `{"name":"bell-pr","version":"..."}` for monitoring
and container health checks.

## Update

1. Wait until no run is executing, then stop BELL PR (or the service).
2. Back up the data directory.
3. `npm install -g bell-pr@latest`
4. Start BELL PR again. It prints its address, and `bell-pr open` opens that
   address in your browser whenever you need it.

[Upgrading](upgrading.md) covers backups, data from older versions and
going back to an older version.

Interactive SSH and headless starts may print a hint to run
`bell-pr open --print --print-token` as a fallback when you cannot pair;
run it explicitly if you need that private authorized URL. Prefer
`bell-pr pair` when a browser on the other device can open `/pair`.
Desktop launches use a temporary private `file://` redirect.

## Pairing devices on your tailnet

Tailscale serve is the supported remote path. Set
`BELLPR_PUBLIC_URL=https://<your-url>` before starting BELL PR, then use
`tailscale serve --bg 4311` for the default server port. On the host run
`bell-pr pair`. On the other device open `<your-url>/pair` and enter the
one-time code (or scan the QR if the terminal shows one). The QR may not scan on a light-background terminal — use a dark background, or just open the printed URL. If the URL is too long, only the URL is printed, no QR. The device stores
a credential in that browser's local storage. Prefer pairing: token URLs
stay in browser history.

Without `BELLPR_PUBLIC_URL`, requests to that host get HTTP 403. The same
applies when `BELLPR_HOST` is `0.0.0.0` or `::` without `BELLPR_PUBLIC_URL`.
Do not place a Host-rewriting reverse proxy in front: changing Host causes
403. Never use Tailscale Funnel; keep the service on your private tailnet.

As an alternative, forward the default port with
`ssh -L 4311:127.0.0.1:4311 <user>@<hostname>` and open
`http://127.0.0.1:4311/pair`. Run `bell-pr pair` on the host.

Manage devices from the device list in Settings. On the host (including
headless hosts), use `bell-pr devices list` and
`bell-pr devices revoke <id>`. `bell-pr token rotate` replaces the install
API token and invalidates every paired device.
The pairing page removes its code hash fragment immediately and the server sends
`Referrer-Policy: no-referrer`. Scripts must come from the same origin under CSP;
`style-src` retains `'unsafe-inline'` for the current React inline styles.

## What to do if pairing is locked

If pairing fails with HTTP **423** (or the CLI says pairing is locked), too
many wrong tries temporarily locked pairing. This protects against code
guessing on Tailscale serve / `ssh -L` paths where every client appears as
`127.0.0.1`.

**On the host** (where `bell-pr` runs), with the install token:

```bash
bell-pr pair --unlock
bell-pr pair [--name "device name"]
```

Notes:

- `bell-pr pair` without `--unlock` does **not** clear the lock or failure counter while locked.
- A **device token cannot unlock** — only the install token on the host can.
- If the lock/counter file is missing or corrupt, the server **fails closed** (treats pairing as locked) and hints `bell-pr pair --unlock`.
- After a successful pair, the counter resets automatically.

## Stolen or lost device

Any paired device may list devices and revoke any device (including others).
Device credentials still cannot create pairing codes, rotate the install
token, or unlock pairing.

1. From another paired device, revoke it in the device list in Settings.
   On the host (including headless), run `bell-pr devices revoke <id>`
   with the install token.
2. If your own device was revoked (or you no longer trust any device
   credential), on the **host** run:

```bash
bell-pr token rotate
```

That replaces the install API token and invalidates every paired device.
Then pair again with `bell-pr pair`.
