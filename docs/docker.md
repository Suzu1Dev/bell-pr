# Running BELL PR in Docker (beta)

The Docker image bundles BELL PR with git, the GitHub CLI (`gh`), the OpenAI
Codex CLI, bubblewrap, socat and ripgrep. Claude Code is not included; you
can install it into your container yourself (see below).

**Docker support is beta.** With Docker's default security settings, the
operating-system sandbox that the agent CLIs run commands in cannot start
inside a container. See [Agent sandbox in
Docker](#agent-sandbox-in-docker) for the probe result and the workaround,
and [Beta status](#beta-status) for what has been verified. Running BELL PR
directly on your computer (`npm install -g bell-pr`) does not have this
limitation.

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

- The image's command is `bell-pr start`. If a required doctor check fails
  (no Codex or Claude Code sign-in yet), the process exits before it
  listens and prints each failed check with its fix command. Sign in as
  below, or open the sample tour with `docker run ... bell-pr start --force`
  (that replaces the image command). A real agent run is still refused
  until a provider is signed in.
- `-p 127.0.0.1:4311:4311` publishes BELL PR on this computer only. The
  image listens on `0.0.0.0` inside the container (an explicit setting; BELL
  PR prints a warning) and still requires the API token in `/data/api-token`.
  Do not publish the port on all interfaces unless you mean to. For access
  from other machines, put an HTTPS reverse proxy in front, as
  [docs/self-hosting.md](self-hosting.md) describes, and keep the token URL
  private.
- `bellpr-data` holds repositories, worktrees and run records (`/data`,
  `BELLPR_DATA_DIR`). `bellpr-home` keeps the container user's home:
  CLI sign-ins, the git configuration and anything you install with
  `npm install -g`.
- `BELLPR_PUBLIC_URL` must be the address your browser uses. BELL PR refuses
  requests for any other address. If you publish another port, for example
  `-p 127.0.0.1:8080:4311`, set `BELLPR_PUBLIC_URL=http://localhost:8080`.
- `GH_TOKEN` lets `gh` and a git push or fetch talk to GitHub. Other git
  commands BELL PR runs do not receive it. Instead, you can sign in once
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
`-e`; [Configuration](configuration.md) describes them. The image sets
`BELLPR_HOST=0.0.0.0`, `BELLPR_DATA_DIR=/data` and `BELLPR_NO_OPEN=1`.

## Get the address

BELL PR prints its address when it starts. Read it from the log:

```sh
docker logs bell-pr
```

or ask the running server for its address again, with your container's name
in place of `bell-pr`:

```sh
docker exec <container> bell-pr open --print
```

The browser never opens by itself from a container, so `--print` is the way to
go: the printed address ends with `#bell_token=` and signs the page in. The
startup line in `docker logs` does not include the token. Treat the printed
address like a password. The health check (`GET /api/health`) does not need
the token and is built into the image, so `docker ps` shows when BELL PR is
ready.

To check the tools inside the container, run
`docker exec bell-pr bell-pr doctor`.

## Use Claude Code

Claude Code is not part of the image. To use it, install it into your
container yourself. The container runs as the `node` user, whose global npm
prefix is `/home/node/.npm-global` (`NPM_CONFIG_PREFIX`): it is writable,
on `PATH`, and inside the `bellpr-home` volume, so `npm install -g` works
without root and survives container updates. Install it, then sign in:

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

## Beta status

Docker stays **beta** in 1.0.0-rc.1 because the agent sandbox needs the
three `--security-opt` options above. What the release candidate verified
on Linux (Docker Engine 29.7):

- the image builds, reports healthy within seconds and prints its address;
- git, the GitHub CLI, the Codex CLI, bubblewrap and socat are in the
  image, and `bell-pr doctor` runs in it;
- the sandbox probe in the table above: it fails with the default options
  and works with the three options.

Still to be verified: a full agent run in Docker with a real Codex sign-in,
and the multi-architecture (arm64) image.

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
their runs show as interrupted and can be retried. The new container waits
up to 30 seconds for the lock the old one left behind to lapse before it
loads the data.

Run one container per data volume. A second container started on the same
volume, for example by an orchestrator that starts the new container before
it stops the old one, waits for the lock and then exits with a message.
