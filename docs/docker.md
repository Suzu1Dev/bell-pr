# Running BELL PR in Docker (beta)

The Docker image bundles BELL PR with git, the GitHub CLI (`gh`), the OpenAI
Codex CLI, bubblewrap, socat and ripgrep. Claude Code is not included; you
can install it into your container yourself (see below).

**Docker support is beta.** With Docker's default security settings, the
operating-system sandbox that the agent CLIs run commands in cannot start
inside a container. See [Agent sandbox in
Docker](#agent-sandbox-in-docker) for the probe result and the workaround.
Running BELL PR directly on your computer (`npm install -g bell-pr`) does
not have this limitation.

## Build the image

```sh
docker build -t bell-pr .
```

Build arguments: `CODEX_VERSION` pins the Codex CLI version, and
`INSTALL_CLAUDE_CODE=true` adds Claude Code to an image you build for your
own use. Never redistribute an image built with Claude Code in it.

## Run it

```sh
docker run -d --name bell-pr \
  -p 127.0.0.1:4311:4311 \
  -v bellpr-data:/data \
  -v bellpr-home:/home/node \
  -e BELLPR_PUBLIC_URL=http://localhost:4311 \
  -e GH_TOKEN \
  -e OPENAI_API_KEY \
  -e GIT_AUTHOR_NAME -e GIT_AUTHOR_EMAIL \
  -e GIT_COMMITTER_NAME -e GIT_COMMITTER_EMAIL \
  bell-pr
```

- `-p 127.0.0.1:4311:4311` publishes BELL PR on this computer only. Do not
  publish it on all interfaces; for access from other machines, put an
  HTTPS reverse proxy in front as [docs/self-hosting.md](self-hosting.md)
  describes.
- `bellpr-data` holds repositories, worktrees and run records (`/data`,
  `BELLPR_DATA_DIR`). `bellpr-home` keeps the container user's home:
  CLI sign-ins, the git configuration and anything you install with
  `npm install -g`.
- `BELLPR_PUBLIC_URL` must be the address your browser uses. BELL PR refuses
  requests for any other address, and prints its sign-in links for this
  one. If you publish another port, for example `-p 127.0.0.1:8080:4311`,
  set `BELLPR_PUBLIC_URL=http://localhost:8080`.
- `GH_TOKEN` lets `gh` and git push to GitHub. Instead, you can sign in once
  with `docker exec -it bell-pr gh auth login`; the login stays in
  `bellpr-home`.
- Codex: pass `OPENAI_API_KEY`, or sign in once with
  `docker exec -it bell-pr codex login --device-auth`. To reuse the sign-in
  from your computer, copy it in with
  `docker cp ~/.codex/auth.json bell-pr:/home/node/.codex/auth.json`
  instead of mounting the file, because Codex rewrites it when it refreshes
  the token.
- The `GIT_AUTHOR_*` and `GIT_COMMITTER_*` variables set the identity of the
  commits BELL PR makes. You can also run
  `docker exec bell-pr git config --global user.name "Your Name"` (and
  `user.email`) once.

Every `BELLPR_*` setting in [.env.example](../.env.example) works with
`-e`. The image sets `BELLPR_HOST=0.0.0.0`, `BELLPR_DATA_DIR=/data` and
`BELLPR_NO_OPEN=1`.

## Sign in

BELL PR prints a sign-in link when it starts. Read it from the log:

```sh
docker logs bell-pr
```

or ask the running server for a new one-time link (it works once, within
two minutes):

```sh
docker exec bell-pr bell-pr open --print
```

The session lives in memory: after a restart or an update, sign in again
with a new link. The health check (`GET /api/health`) is built into the
image, so `docker ps` shows when BELL PR is ready.

## Use Claude Code

Claude Code is not part of the image. To use it, install it into your
container under the `node` user, whose npm prefix
(`/home/node/.npm-global`) is writable and on `PATH`, then sign in:

```sh
docker exec -it bell-pr npm install -g @anthropic-ai/claude-code
docker exec -it bell-pr claude auth login
```

Both stay in the `bellpr-home` volume. BELL PR uses the Claude Code CLI you
installed and signed in to (Claude plan or Anthropic API key); usage counts
against your own account. You can also pass `-e ANTHROPIC_API_KEY` to
`docker run`.

## Agent sandbox in Docker

Agents run their commands inside an operating-system sandbox: Codex uses
its own bubblewrap-based sandbox for every agent (read-only or writing),
and Claude Code uses bubblewrap with socat for agents that write code. Both need to create Linux namespaces, which Docker's default
seccomp and AppArmor profiles and its masked `/proc` paths forbid.

Probe, run without any model call (Docker Engine 29.7 on Linux, Codex CLI
0.159.0, in a fresh container of this image):

```sh
codex sandbox -c 'sandbox_mode="workspace-write"' -- sh -c 'echo ok > probe && cat probe'
bwrap --ro-bind / / --dev /dev --proc /proc --unshare-all --die-with-parent true
```

| `docker run` security options | Result |
| --- | --- |
| none (the defaults) | Fails: `bwrap: No permissions to create a new namespace` (also with `sandbox_mode="read-only"`) |
| `--security-opt seccomp=unconfined` | Fails: `bwrap: Failed to make / slave: Permission denied` |
| `--security-opt apparmor=unconfined` | Fails: `bwrap: No permissions to create a new namespace` |
| both of the above | Fails: `bwrap: Can't mount proc on /proc: Operation not permitted` |
| both of the above and `--security-opt systempaths=unconfined` | Works: the agent writes inside its workspace, a write to `/home/node` fails with "Read-only file system", and network access fails |

The direct `bwrap` probe (what Claude Code's sandbox needs) gives the same
results.

**Workaround:** to let agents write code in Docker, add the three options to
`docker run`:

```sh
docker run -d --name bell-pr \
  --security-opt seccomp=unconfined \
  --security-opt apparmor=unconfined \
  --security-opt systempaths=unconfined \
  ... (the options from "Run it") \
  bell-pr
```

These options relax the confinement of the container itself so that the
agent sandbox can start; the sandbox then confines each agent more tightly
than the container would. Use them only on a machine you control. Without
them, BELL PR still runs, but every command a Codex agent runs fails (so
analysis, reviews and code changes stall), and Claude Code agents that write
code cannot start their sandbox.

## Files and user IDs

- The container runs as the `node` user (uid 1000). Named volumes, as
  above, just work. A bind mount such as `-v ~/bell-data:/data` must be
  writable by uid 1000.
- `state.json` records paths inside the container (`/data/...`). Keep a
  Docker data volume with Docker; do not move it to a BELL PR installed on
  your computer or the other way round.
- Back up both volumes to keep your work and sign-ins.

## Update

Rebuild or pull the new image, then replace the container with the same
volumes:

```sh
docker rm -f bell-pr
docker run -d --name bell-pr ... bell-pr
docker exec bell-pr bell-pr open --print
```

Agents that were still running when the old container stopped are gone;
their runs show as interrupted and can be retried.
