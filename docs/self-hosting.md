# Self-hosting BELL PR

BELL PR runs on your own computer and listens on 127.0.0.1 by default. This
page covers running it as a service, reaching it through a reverse proxy,
and signing in after restarts. For containers, see
[docs/docker.md](docker.md).

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

```text
BELL PR 1.0.0 → http://127.0.0.1:4311/auth?t=...
```

Open that link to sign in; BELL PR opens it for you when it runs in a
terminal. `bell-pr help` lists the commands and options, and
[Configuration](configuration.md) and [.env.example](../.env.example)
describe every `BELLPR_*` setting. Load a settings file with
`bell-pr start --env-file <file>`.

Data lives in `~/.bellpr` unless you pass `--data-dir` or set
`BELLPR_DATA_DIR`. BELL PR never moves data by itself: if an older version
left data in `./.bellpr`, it prints how to keep using that folder.

## Signing in

- The session secret lives only in the memory of the running server, so
  every start or restart signs all browsers out.
- `bell-pr open` asks the running server for a new one-time sign-in link and
  opens it. The link works once, within two minutes. Use
  `bell-pr open --print` on a machine without a browser and open the link
  elsewhere. Run it as the same user as the server, with the same data
  directory (`--data-dir`).
- A browser that opens BELL PR without a session sees a page that explains
  this.

## One instance per data directory

BELL PR keeps a lock file, `<data dir>/bellpr.lock`, while it runs. A second
start with the same data directory exits with a message instead of touching
the data, and a start on a port that BELL PR already uses says so and
points to `bell-pr open`. A lock left behind by a crash is detected and
replaced at the next start.

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
you log out. The service never opens a browser. **After every start or
restart, run `bell-pr open` in a terminal on that machine to sign in.**
Logs: `journalctl --user -u bell-pr`.

## Reach BELL PR from another machine

Keep BELL PR on 127.0.0.1 and put an HTTPS reverse proxy on the same
machine in front of it. Never serve it over plain HTTP on any other address:
the sign-in link and the session cookie would cross the network
unencrypted.

1. Run the proxy on the same machine and forward to `127.0.0.1:4311`. BELL
   PR reads `X-Forwarded-Proto` only from a proxy on this machine, and then
   marks the session cookie `Secure`.
2. Keep the original `Host` header (or set it to the public host name).
3. Set `BELLPR_PUBLIC_URL` to the public HTTPS address, without a path, for
   example `BELLPR_PUBLIC_URL=https://bell.example.com`. BELL PR then accepts
   requests for that address and prints its sign-in links for it. BELL PR
   must be served at the root of that address, not under a path.
4. BELL PR's own sign-in link is the only access control. On a network you
   do not fully trust, also restrict access at the proxy (VPN, single
   sign-on or an IP allowlist).

Caddy (certificates, `Host` and `X-Forwarded-Proto` are handled for you):

```text
bell.example.com {
	reverse_proxy 127.0.0.1:4311
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name bell.example.com;
    # ssl_certificate and ssl_certificate_key for bell.example.com

    location / {
        proxy_pass http://127.0.0.1:4311;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }
}
```

To sign in through the proxy, run `bell-pr open --print` on the server
machine; with `BELLPR_PUBLIC_URL` set, the link uses the public address.

## Health check

`GET /api/health` answers `{"name":"bell-pr","version":"..."}` without a
session, for monitoring and container health checks.

## Update

1. Wait until no run is executing, then stop BELL PR (or the service).
2. Back up the data directory.
3. `npm install -g bell-pr@latest`
4. Start BELL PR again and sign in with `bell-pr open`.

[Upgrading](upgrading.md) covers backups, data from older versions and
going back to an older version.
