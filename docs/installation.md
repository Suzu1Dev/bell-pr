# Installation

BELL PR runs on macOS and Linux with Node.js 22 or later. Windows uses WSL2;
native Windows is not supported. Choose one installation method below.

For real work, you also need Git, a configured Git identity, the GitHub CLI
signed in with `gh auth login`, and either Codex CLI or Claude Code signed in
as the same user that runs BELL PR. On Linux, Claude Code's sandbox also needs
`bubblewrap` and `socat`. See the full [requirements](getting-started.md#before-you-start).
The Windows helper installs these tools, but sign-in stays manual.

The shell and PowerShell download commands use the public website; the Homebrew
tap uses this repository's `main` branch. When testing an unpublished installer
change, use the files from that checkout. Publish the website's installer copies
and merge the Homebrew formula before using the corresponding remote commands.

## npm

With Node.js 22+ and npm already available:

```sh
npm install -g bell-pr
bell-pr
```

For a one-time launch, use `npx bell-pr`. `bellpr` is also an alias for `bell-pr`.

## Shell installer (macOS and Linux)

The script installs BELL PR under `~/.local`. It reuses a working Node.js 22+
and npm for your operating system; otherwise it downloads official Node.js 24
for macOS/Linux x64 or arm64 and verifies its SHA-256 checksum. Windows users
can run it inside WSL. It does not use sudo, edit shell profiles, sign in or
start a server:

<!-- generated:install-commands method=curl -->
```sh
curl -fsSL https://bell-pr.suzu.tw/install | sh
```
<!-- /generated:install-commands -->

Automatic Node.js setup needs `curl`, `tar`, `awk`, and either `sha256sum` or
`shasum`. The runtime goes under `<prefix>/share/bell-pr/node`, which defaults
to `~/.local/share/bell-pr/node`; no system Node.js installation is replaced.
The Linux download uses Node.js's official glibc build. Alpine/musl and other
architectures need a compatible Node.js 22+ and npm already installed. The
installer checks that its downloaded runtime runs before installing BELL PR.

Use the complete launch command printed by the installer; it includes the
required PATH. To use `bell-pr` by name in the current terminal, copy the
printed `export PATH` command. When Node.js was downloaded into the default
location, that is:

```sh
export PATH="$HOME/.local/share/bell-pr/node/bin:$HOME/.local/bin:$PATH"
bell-pr doctor
bell-pr
```

Add that PATH setting to your shell configuration if you want it in later
terminals. A downloaded copy of [install.sh](../install.sh) accepts an exact
version, an absolute installation prefix and a message language:

```sh
sh ./install.sh --version 1.0.0 --prefix "$HOME/.local" --lang zh-TW
```

Omit `--version` for the current npm release. `--help` lists the options.
The installer language changes its messages; choose the app's language in Welcome.

## Homebrew (macOS and Linux)

With Homebrew already installed, add this repository as the tap, then install:

<!-- generated:install-commands method=brew -->
```sh
brew tap suzu1dev/bell-pr https://github.com/Suzu1Dev/bell-pr
brew install suzu1dev/bell-pr/bell-pr
```
<!-- /generated:install-commands -->

Then run `bell-pr`. This is a repository-hosted formula, not a Homebrew core
formula. It installs BELL PR and its formula dependencies; finish the GitHub
and AI CLI sign-in steps separately.

## Bun (macOS and Linux)

```sh
bun add --global bell-pr
bell-pr
```

Bun installs the package; BELL PR still runs with **Node.js 22+**. Ensure the
Bun global executable directory and Node.js are on PATH. Git, GitHub CLI and
your AI CLI are still required for real work.

## mise (macOS and Linux)

With mise already installed:

```sh
MISE_NPM_PACKAGE_MANAGER=npm mise use -g node@24 npm:bell-pr@1.0.0
mise exec -- bell-pr
```

This selects Node.js 24 and pins BELL PR 1.0.0 in your global mise tool
configuration. The explicit version avoids latest-release cooldown selection;
the npm choice uses npm's normal installation checks instead of the default
backend's additional new-package and download-count gates. The environment
variable applies only to this command, without permanently changing mise's
package-manager setting.

For upgrades, repeat `MISE_NPM_PACKAGE_MANAGER=npm mise use -g node@24` with
`npm:bell-pr@<version>`, replacing `<version>` with the release you want.
`mise exec` supplies the installed tools without shell activation. If you
already activate mise in your shell, you can run `bell-pr` directly.

## Windows with WSL2

Use a WSL2 Ubuntu or Debian distribution. BELL PR, Git, GitHub CLI and your AI
CLI all run as your Linux user inside that distribution; the browser can run
on Windows. This setup has not been verified on a real Windows host.

### 1. Prepare WSL2

If WSL2 is not installed, open PowerShell as Administrator and run:

```powershell
wsl --install -d Ubuntu
```

Restart Windows if prompted, then open Ubuntu and finish creating your Linux
username and password. Check the distribution with `wsl --list --verbose`;
if it shows version 1, use `wsl --set-version Ubuntu 2`. See Microsoft's
[WSL installation guide](https://learn.microsoft.com/windows/wsl/install).
The BELL PR installer prints these steps when setup is incomplete.

### 2. Run the installer from PowerShell

Use your normal Windows account. The helper may ask for your Linux sudo
password when installing system dependencies:

<!-- generated:install-commands method=powershell -->
```powershell
& {
  Invoke-RestMethod 'https://bell-pr.suzu.tw/install.ps1' -OutFile install.ps1 -ErrorAction Stop
  powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
}
```
<!-- /generated:install-commands -->

The default distribution is `Ubuntu` and the default AI CLI is Codex. The
helper installs Git, GitHub CLI, `bubblewrap`, `socat`, BELL PR and the selected
AI CLI in WSL. It uses an existing supported Linux Node.js, or installs Node.js
24 when needed; npm tools go under `~/.local`. It does not sign in for you or
install a background service. It writes `~/.local/share/bell-pr/env.sh` and
loads it from your Bash login profile and `.bashrc`, so later terminals find
the installed Node.js and CLI tools.

To select Debian, Claude Code, an exact BELL PR version and Traditional Chinese
installer messages, rerun the downloaded script with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Distribution Debian -Provider claude -Version 1.0.0 -Lang zh-TW
```

Use `-Provider none` to skip installing an AI CLI, or `-Version latest` for
the current release. `-Distribution` must name an existing WSL2 distribution
from `wsl --list --verbose`. The execution-policy option applies only to this
PowerShell process; no permanent policy change is needed.

### 3. Sign in and start

Enter your chosen distribution:

```powershell
wsl -d Ubuntu
```

Then, in the Linux terminal, set up Git and sign in:

```sh
export PATH="$HOME/.local/bin:$PATH"
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
gh auth login
codex login
bell-pr doctor
bell-pr
```

If you selected Claude Code, use `claude auth login` instead of `codex login`.
BELL PR uses the Claude Code CLI you installed and signed in to (Claude plan
or Anthropic API key). Usage counts against your own account. Codex usage also
counts against your own account. Credentials stay with the tools in this WSL
distribution; signing in to Windows copies of the tools does not sign in the
Linux copies.

To explore before signing in, run `bell-pr start --force` and choose the sample
project. It makes no AI call and sends nothing to GitHub. Real agent work waits
until a provider is ready.

### Later launches and the browser

From PowerShell, start the installed copy without repeating setup:

```powershell
wsl -d Ubuntu -- bash -lc '$HOME/.local/bin/bell-pr'
```

Replace `Ubuntu` if you chose another distribution. Keep this terminal open;
Ctrl+C stops BELL PR. Automatic browser opening depends on your WSL setup.
If no browser opens, use another terminal in the same distribution:

```sh
bell-pr open --print --print-token
```

Open that link in your Windows browser. It contains a credential; do not share
it. Keep project folders in the Linux filesystem, for example `~/projects`,
and enter Linux paths when importing a local repository. A Windows drive is
mounted under `/mnt/c/`; Windows paths such as `C:\projects` are not Linux paths.

Continue with [Getting started](getting-started.md#the-welcome-steps).
