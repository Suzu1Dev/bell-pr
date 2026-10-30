#!/usr/bin/env bash
# Ubuntu/Debian helper for install.ps1. Never run this script with sudo.
set -Eeuo pipefail

# BEGIN GENERATED PRODUCT METADATA
BELLPR_PACKAGE='bell-pr'
BELLPR_PRODUCT='BELL PR'
BELLPR_BIN='bell-pr'
# END GENERATED PRODUCT METADATA

provider=codex
version=latest
lang=en
invalid=0
while (($#)); do
  case "$1" in
    --provider|--version|--lang)
      if (($# < 2)); then invalid=1; break; fi
      case "$1" in
        --provider) provider=$2 ;;
        --version) version=$2 ;;
        --lang) lang=$2 ;;
      esac
      shift 2 ;;
    *) invalid=1; break ;;
  esac
done

declare -A text
if [[ "$lang" == zh-TW ]]; then
  text[usage]='用法：bash install-wsl.sh --provider codex|claude|none --version latest|<版本> --lang en|zh-TW'
  text[root]='請以發行版的一般 Linux 使用者執行，不要使用 root 或 sudo 執行安裝程式。'
  text[platform]='需要 Ubuntu 或 Debian Linux，以及可用的 apt-get 和 sudo。'
  text[dependencies]='正在安裝 Git、GitHub CLI、下載工具與 Claude 沙箱依賴；sudo 可能會要求輸入密碼。'
  text[node]='正在從 nodejs.org 下載 Node.js 24，並驗證 SHA256。'
  text[architecture]='Node.js 自動安裝僅支援 x86_64 與 aarch64。請先自行安裝 Linux Node.js 22 以上版本與 npm。'
  text[checksum]='找不到唯一且有效的 Node.js 24 校驗紀錄。'
  text[node_conflict]='Node 安裝目錄已存在但無法使用；請先檢查 ~/.local/share/bell-pr/node，再重新安裝。'
  text[node_invalid]='無法執行 Linux Node.js 22 以上版本與 npm；請檢查安裝與 PATH。'
  text[no_bin]='npm 已結束，但找不到可執行的 CLI；請檢查套件與 ~/.local/bin。'
  text[packages]='正在將 %s 與選取的 AI CLI 安裝到 ~/.local；不使用 sudo npm。'
  text[failed]='安裝未完成，外部指令的結束碼為'
  text[complete]='%s 安裝完成。尚未登入任何帳號，也未啟動服務。'
  text[next]='請在這個 WSL 發行版內執行以下指令完成登入並啟動：'
else
  text[usage]='Usage: bash install-wsl.sh --provider codex|claude|none --version latest|<version> --lang en|zh-TW'
  text[root]='Run this installer as the distribution’s regular Linux user, not root or sudo.'
  text[platform]='Ubuntu or Debian Linux with apt-get and sudo is required.'
  text[dependencies]='Installing Git, GitHub CLI, download tools and Claude sandbox dependencies; sudo may ask for your password.'
  text[node]='Downloading Node.js 24 from nodejs.org and verifying SHA256.'
  text[architecture]='Automatic Node.js installation supports x86_64 and aarch64. Install Linux Node.js 22 or newer and npm first.'
  text[checksum]='Could not find exactly one valid Node.js 24 checksum entry.'
  text[node_conflict]='The Node installation directory exists but is unusable; inspect ~/.local/share/bell-pr/node before trying again.'
  text[node_invalid]='Linux Node.js 22 or newer and npm could not run; check the installation and PATH.'
  text[no_bin]='npm finished, but an executable CLI is missing; check the packages and ~/.local/bin.'
  text[packages]='Installing %s and the selected AI CLI into ~/.local, without sudo npm.'
  text[failed]='Installation did not finish; external command exit code:'
  text[complete]='%s is installed. No accounts were signed in and no service was started.'
  text[next]='Inside this WSL distribution, run these commands to sign in and start:'
fi

if ((invalid)) || [[ ! "$provider" =~ ^(codex|claude|none)$ ]] ||
   [[ ! "$lang" =~ ^(en|zh-TW)$ ]] ||
   [[ ! "$version" =~ ^(latest|[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9]+([.-][A-Za-z0-9]+)*)?)$ ]]; then
  printf '%s\n' "${text[usage]}" >&2
  exit 2
fi
trap 'result=$?; printf "%s %s\n" "${text[failed]}" "$result" >&2; exit "$result"' ERR
if [[ "$(id -u)" == 0 ]]; then printf '%s\n' "${text[root]}" >&2; exit 1; fi
if [[ "$(uname -s)" != Linux ]] || [[ ! -r /etc/os-release ]]; then
  printf '%s\n' "${text[platform]}" >&2; exit 1
fi
# /etc/os-release is supplied by the distribution, not by the downloaded package.
. /etc/os-release
if [[ "${ID:-}" != ubuntu && "${ID:-}" != debian ]] || ! command -v apt-get >/dev/null || ! command -v sudo >/dev/null; then
  printf '%s\n' "${text[platform]}" >&2; exit 1
fi
if [[ -z "${HOME:-}" || "$HOME" != /* || "$HOME" == / ]]; then
  printf '%s\n' "${text[root]}" >&2; exit 1
fi

printf '%s\n' "${text[dependencies]}"
sudo apt-get update
sudo apt-get install -y git gh curl ca-certificates xz-utils bubblewrap socat

prefix="$HOME/.local"
state="$prefix/share/bell-pr"
export PATH="$state/node/bin:$prefix/bin:$PATH"
node_info=$(node -p 'process.platform + ":" + process.versions.node.split(".")[0]' 2>/dev/null || true)
if [[ ! "$node_info" =~ ^linux:([0-9]+)$ ]] || (( ${BASH_REMATCH[1]:-0} < 22 )) || ! npm --version >/dev/null 2>&1; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) printf '%s\n' "${text[architecture]}" >&2; exit 1 ;;
  esac
  if [[ -e "$state/node" || -L "$state/node" ]]; then
    printf '%s\n' "${text[node_conflict]}" >&2; exit 1
  fi
  printf '%s\n' "${text[node]}"
  scratch=$(mktemp -d)
  trap 'rm -rf -- "$scratch"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 --output "$scratch/SHASUMS256.txt" https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
  mapfile -t entries < <(grep -E "^[a-f0-9]{64}  node-v24\.[0-9]+\.[0-9]+-linux-$arch\.tar\.xz$" "$scratch/SHASUMS256.txt")
  if ((${#entries[@]} != 1)); then printf '%s\n' "${text[checksum]}" >&2; exit 1; fi
  read -r checksum archive <<< "${entries[0]}"
  release=${archive#node-}
  release=${release%-linux-*}
  curl --fail --location --proto '=https' --tlsv1.2 --output "$scratch/$archive" "https://nodejs.org/dist/$release/$archive"
  (cd "$scratch" && printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check -)
  tar -xJf "$scratch/$archive" -C "$scratch"
  mkdir -p "$state"
  mv "$scratch/${archive%.tar.xz}" "$state/node"
fi
node_info=$(node -p 'process.platform + ":" + process.versions.node.split(".")[0]' 2>/dev/null || true)
if [[ ! "$node_info" =~ ^linux:([0-9]+)$ ]] || (( ${BASH_REMATCH[1]:-0} < 22 )) || ! npm --version >/dev/null 2>&1; then
  printf '%s\n' "${text[node_invalid]}" >&2; exit 1
fi
node_path=$(node -p 'process.execPath')
node_bin=$(dirname "$node_path")
export PATH="$node_bin:$prefix/bin:$PATH"

packages=("$BELLPR_PACKAGE@$version")
case "$provider" in
  codex) packages+=('@openai/codex') ;;
  claude) packages+=('@anthropic-ai/claude-code') ;;
esac
printf "${text[packages]}\n" "$BELLPR_PRODUCT"
# npm owns its links and refuses unrelated existing launchers (no --force).
npm install --global --prefix "$prefix" "${packages[@]}"
executables=("$BELLPR_BIN")
if [[ "$provider" != none ]]; then executables+=("$provider"); fi
for executable in "${executables[@]}"; do
  if [[ ! -x "$prefix/bin/$executable" ]]; then
    printf '%s\n' "${text[no_bin]}" >&2; exit 1
  fi
done

mkdir -p "$state"
# POSIX quoting keeps spaces and apostrophes in the Node directory literal.
quoted_node=${node_bin//\'/\'\\\'\'}
printf 'export PATH='\''%s'\'':"$HOME/.local/bin:$PATH"\n' "$quoted_node" > "$state/env.sh"
source_line='[ ! -r "$HOME/.local/share/bell-pr/env.sh" ] || . "$HOME/.local/share/bell-pr/env.sh"'
login_profile="$HOME/.profile"
if [[ -f "$HOME/.bash_profile" ]]; then login_profile="$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then login_profile="$HOME/.bash_login"; fi
for profile in "$login_profile" "$HOME/.bashrc"; do
  if ! grep -Fqx -- "$source_line" "$profile" 2>/dev/null; then
    printf '\n%s\n' "$source_line" >> "$profile"
  fi
done
printf "${text[complete]}\n" "$BELLPR_PRODUCT"
printf '%s\n' "${text[next]}" '. "$HOME/.local/share/bell-pr/env.sh"' 'gh auth login'
case "$provider" in
  codex) printf '%s\n' 'codex login' ;;
  claude) printf '%s\n' 'claude auth login' ;;
esac
if [[ "$provider" == none ]]; then printf '%s start --force\n' "$BELLPR_BIN"
else printf '%s\n' "$BELLPR_BIN"; fi
