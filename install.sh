#!/bin/sh
# Standalone installer for the published package, with an official Node.js fallback.

# BEGIN GENERATED PRODUCT METADATA
BELLPR_PACKAGE='bell-pr'
BELLPR_PRODUCT='BELL PR'
BELLPR_BIN='bell-pr'
# END GENERATED PRODUCT METADATA

# Embedded dictionaries keep the downloaded script independent of the checkout.
bellpr_message() {
  case "$bellpr_lang:$1" in
    zh-TW:help) printf '%s\n' "安裝 $BELLPR_PRODUCT（macOS、Linux、WSL）。需要時會安裝獨立的 Node.js 24 與 npm。" \
      '用法：sh install.sh [--version <確切版本>] [--prefix <絕對路徑>] [--lang en|zh-TW]' \
      '  --version  安裝指定的完整版本（例如 1.0.0）；預設為 latest。' \
      '  --prefix   安裝目錄；預設為 $HOME/.local。' \
      '  --lang     訊息語言；預設依 LANG 選擇。' \
      '  --help     顯示說明。' \
      '不使用 sudo、不修改 shell 設定檔，也不會啟動服務或登入帳戶。' ;;
    en:help) printf '%s\n' "Install $BELLPR_PRODUCT on macOS, Linux or WSL. Installs a private Node.js 24 with npm when needed." \
      'Usage: sh install.sh [--version <exact-version>] [--prefix <absolute-path>] [--lang en|zh-TW]' \
      '  --version  Install an exact version (for example 1.0.0); defaults to latest.' \
      '  --prefix   Installation directory; defaults to $HOME/.local.' \
      '  --lang     Message language; otherwise selected from LANG.' \
      '  --help     Show this help.' \
      'Does not use sudo, edit shell profiles, start the service or sign into accounts.' ;;
    zh-TW:argument) printf '無效或缺少的參數：%s。請用 --help 查看說明。\n' "$2" ;;
    en:argument) printf 'Invalid or missing argument: %s. Use --help for usage.\n' "$2" ;;
    zh-TW:language) printf '%s\n' '--lang 必須是 en 或 zh-TW。' ;;
    en:language) printf '%s\n' '--lang must be en or zh-TW.' ;;
    zh-TW:prefix) printf '%s\n' '--prefix 必須是絕對路徑，且不能含冒號或換行。HOME 未設定時請指定 --prefix。' ;;
    en:prefix) printf '%s\n' '--prefix must be an absolute path without colons or line breaks. Set --prefix if HOME is unset.' ;;
    zh-TW:os) printf '%s\n' '此安裝程式支援 macOS、Linux 與 WSL。Windows 請在 WSL 發行版內執行。' ;;
    en:os) printf '%s\n' 'This installer supports macOS, Linux and WSL. On Windows, run it inside a WSL distribution.' ;;
    zh-TW:arch) printf '%s\n' '自動安裝 Node.js 支援 x64 與 arm64。其他架構請先安裝此環境適用的 Node.js 22 以上版本與 npm。' ;;
    en:arch) printf '%s\n' 'Automatic Node.js installation supports x64 and arm64. On other architectures, install a compatible Node.js 22+ with npm first.' ;;
    zh-TW:download_tools) printf '%s\n' '自動安裝 Node.js 需要 curl、tar、awk、mktemp，以及 sha256sum 或 shasum。請先安裝缺少的工具。' ;;
    en:download_tools) printf '%s\n' 'Automatic Node.js installation requires curl, tar, awk, mktemp, and sha256sum or shasum. Install the missing tools first.' ;;
    zh-TW:node_installing) printf '正在下載並驗證官方 Node.js 24，安裝至 %s。\n' "$2" ;;
    en:node_installing) printf 'Downloading and verifying official Node.js 24 into %s.\n' "$2" ;;
    zh-TW:node_existing) printf '既有的獨立 Node.js 無法使用，未覆寫：%s。請修復或移走此目錄後重試。\n' "$2" ;;
    en:node_existing) printf 'The existing private Node.js is unusable and was not overwritten: %s. Repair or move that directory, then retry.\n' "$2" ;;
    zh-TW:node_download) printf '%s\n' '無法下載官方 Node.js 或其校驗檔。請檢查網路連線後重試。' ;;
    en:node_download) printf '%s\n' 'Could not download official Node.js or its checksums. Check the network connection and retry.' ;;
    zh-TW:node_checksum) printf '%s\n' 'Node.js 校驗失敗；未解壓縮下載檔案。請重新下載，或自行安裝 Node.js 與 npm。' ;;
    en:node_checksum) printf '%s\n' 'Node.js checksum verification failed; the download was not extracted. Retry the download, or install Node.js with npm yourself.' ;;
    zh-TW:node_failed) printf '%s\n' '無法安裝或執行獨立的 Node.js。請檢查目錄權限及系統相容性，或自行安裝 Node.js 22 以上版本與 npm。' ;;
    en:node_failed) printf '%s\n' 'Could not install or run private Node.js. Check directory permissions and system compatibility, or install Node.js 22+ with npm yourself.' ;;
    zh-TW:version) printf '%s\n' '--version 必須是完整 SemVer 版本（例如 1.0.0 或 1.1.0-rc.1），不能使用標籤、範圍或網址。' ;;
    en:version) printf '%s\n' '--version must be an exact SemVer version (such as 1.0.0 or 1.1.0-rc.1), not a tag, range or URL.' ;;
    zh-TW:installing) printf '正在將 %s 安裝至 %s。\n' "$2" "$3" ;;
    en:installing) printf 'Installing %s into %s.\n' "$2" "$3" ;;
    zh-TW:failed) printf '%s\n' 'npm 安裝失敗。請檢查上方錯誤與安裝目錄權限，再重試；不需要 sudo。' ;;
    en:failed) printf '%s\n' 'npm installation failed. Check the error above and the installation directory permissions, then retry; sudo is not needed.' ;;
    zh-TW:no_bin) printf '%s\n' 'npm 已結束，但安裝目錄內沒有可執行的 CLI。請確認指定版本包含 CLI。' ;;
    en:no_bin) printf '%s\n' 'npm finished, but the installation has no executable CLI. Check that the selected release includes the CLI.' ;;
    zh-TW:installed) printf '%s 安裝完成。可立即執行：\n' "$BELLPR_PRODUCT" ;;
    en:installed) printf '%s is installed. Run it now with:\n' "$BELLPR_PRODUCT" ;;
    zh-TW:check) printf '%s\n' '先檢查 Git、GitHub CLI 與 AI CLI 的設定：' ;;
    en:check) printf '%s\n' 'Check the Git, GitHub CLI and AI CLI setup first:' ;;
    zh-TW:path) printf '%s\n' '若要在目前終端機直接使用指令名稱，請執行：' ;;
    en:path) printf '%s\n' 'To use the command name in this terminal, run:' ;;
  esac
}

bellpr_fail() { bellpr_message "$@" >&2; return 1; }

# Print a copyable POSIX-shell argument, including paths containing apostrophes.
bellpr_quote() {
  printf "'"
  bellpr_quote_rest=$1
  while :; do
    case "$bellpr_quote_rest" in
      *"'"*)
        printf '%s' "${bellpr_quote_rest%%"'"*}" "'\\''"
        bellpr_quote_rest=${bellpr_quote_rest#*"'"}
        ;;
      *) printf "%s'" "$bellpr_quote_rest"; break ;;
    esac
  done
}

bellpr_runtime_ready() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || return 1
  bellpr_node=$(node -p 'process.platform + ":" + process.versions.node.split(".")[0]' </dev/null 2>/dev/null) || return 1
  case "$bellpr_node" in "$bellpr_platform":*) ;; *) return 1 ;; esac
  bellpr_major=${bellpr_node##*:}
  case "$bellpr_major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$bellpr_major" -ge 22 ] 2>/dev/null && npm --version </dev/null >/dev/null 2>&1
}

bellpr_bootstrap_node() (
  bellpr_arch=$(uname -m 2>/dev/null) || { bellpr_fail arch; exit 1; }
  case "$bellpr_arch" in x86_64|amd64) bellpr_arch=x64 ;; aarch64|arm64) bellpr_arch=arm64 ;; *) bellpr_fail arch; exit 1 ;; esac
  for bellpr_tool in curl tar awk mktemp mkdir rm; do
    command -v "$bellpr_tool" >/dev/null 2>&1 || { bellpr_fail download_tools; exit 1; }
  done
  if command -v sha256sum >/dev/null 2>&1; then bellpr_checksum=sha256sum
  elif command -v shasum >/dev/null 2>&1; then bellpr_checksum=shasum
  else bellpr_fail download_tools; exit 1; fi
  bellpr_temp=$(mktemp -d "${TMPDIR:-/tmp}/bell-pr-node.XXXXXXXX") || { bellpr_fail node_failed; exit 1; }
  bellpr_created=0
  trap 'rm -rf "$bellpr_temp"; if [ "$bellpr_created" = 1 ]; then rm -rf "$bellpr_private_node"; fi' 0
  trap 'exit 1' 1 2 3 15
  bellpr_message node_installing "$bellpr_private_node"
  bellpr_node_base=https://nodejs.org/dist/latest-v24.x
  curl -fsSL --connect-timeout 15 --max-time 180 "$bellpr_node_base/SHASUMS256.txt" -o "$bellpr_temp/SHASUMS256.txt" </dev/null || { bellpr_fail node_download; exit 1; }
  bellpr_entry=$(awk -v platform="$bellpr_platform" -v arch="$bellpr_arch" '
    $2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-" platform "-" arch "\\.tar\\.gz$") && length($1) == 64 && $1 !~ /[^a-f0-9]/ { print $1, $2; count++ }
    END { if (count != 1) exit 1 }
  ' "$bellpr_temp/SHASUMS256.txt") || { bellpr_fail node_checksum; exit 1; }
  bellpr_expected=${bellpr_entry%% *}
  bellpr_archive=${bellpr_entry#* }
  curl -fsSL --connect-timeout 15 --max-time 180 "$bellpr_node_base/$bellpr_archive" -o "$bellpr_temp/node.tar.gz" </dev/null || { bellpr_fail node_download; exit 1; }
  if [ "$bellpr_checksum" = sha256sum ]; then
    bellpr_actual=$(sha256sum "$bellpr_temp/node.tar.gz") || { bellpr_fail node_checksum; exit 1; }
  else
    bellpr_actual=$(shasum -a 256 "$bellpr_temp/node.tar.gz") || { bellpr_fail node_checksum; exit 1; }
  fi
  [ "${bellpr_actual%% *}" = "$bellpr_expected" ] || { bellpr_fail node_checksum; exit 1; }
  mkdir -p "${bellpr_private_node%/*}" && mkdir "$bellpr_private_node" || { bellpr_fail node_failed; exit 1; }
  bellpr_created=1
  tar -xzf "$bellpr_temp/node.tar.gz" --strip-components=1 -C "$bellpr_private_node" </dev/null || { bellpr_fail node_failed; exit 1; }
  [ -x "$bellpr_private_node/bin/node" ] && [ -x "$bellpr_private_node/bin/npm" ] && bellpr_runtime_ready || { bellpr_fail node_failed; exit 1; }
  bellpr_created=0
)

bellpr_install_main() {
  case "${LANG-}" in zh_TW*|zh-TW*) bellpr_lang=zh-TW ;; *) bellpr_lang=en ;; esac
  bellpr_prefix=${HOME:+$HOME/.local}
  bellpr_version=latest
  bellpr_exact=0
  bellpr_help=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --lang)
        [ "$#" -ge 2 ] || { bellpr_fail argument "$1"; return 1; }
        case "$2" in en|zh-TW) bellpr_lang=$2 ;; *) bellpr_fail language; return 1 ;; esac
        shift 2 ;;
      --prefix|--version)
        [ "$#" -ge 2 ] || { bellpr_fail argument "$1"; return 1; }
        case "$2" in ''|--*) bellpr_fail argument "$1"; return 1 ;; esac
        if [ "$1" = --prefix ]; then bellpr_prefix=$2
        else bellpr_version=$2; bellpr_exact=1; fi
        shift 2 ;;
      --help|-h) bellpr_help=1; shift ;;
      *) bellpr_fail argument "$1"; return 1 ;;
    esac
  done
  if [ "$bellpr_help" = 1 ]; then bellpr_message help; return 0; fi
  case "$bellpr_prefix" in /*) ;; *) bellpr_fail prefix; return 1 ;; esac
  case "$bellpr_prefix" in *:*|*'
'*|*"$(printf '\r')"*) bellpr_fail prefix; return 1 ;; esac
  bellpr_os=$(uname -s 2>/dev/null) || { bellpr_fail os; return 1; }
  case "$bellpr_os" in Darwin) bellpr_platform=darwin ;; Linux) bellpr_platform=linux ;; *) bellpr_fail os; return 1 ;; esac
  bellpr_original_path=${PATH-}
  bellpr_node_bin=
  if ! bellpr_runtime_ready; then
    bellpr_private_node=${bellpr_prefix%/}/share/$BELLPR_PACKAGE/node
    bellpr_node_bin=$bellpr_private_node/bin
    PATH=$bellpr_node_bin:$bellpr_original_path
    export PATH
    if [ -e "$bellpr_private_node" ] || [ -L "$bellpr_private_node" ]; then
      [ -x "$bellpr_node_bin/node" ] && [ -x "$bellpr_node_bin/npm" ] && bellpr_runtime_ready || { bellpr_fail node_existing "$bellpr_private_node"; return 1; }
    else
      bellpr_bootstrap_node || return 1
    fi
  fi
  if [ "$bellpr_exact" = 1 ]; then
    node -e '
      const n = "(?:0|[1-9][0-9]*)";
      const pre = "(?:" + n + "|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
      const version = new RegExp("^" + n + "\\." + n + "\\." + n +
        "(?:-" + pre + "(?:\\." + pre + ")*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$");
      process.exit(version.test(process.argv[1]) ? 0 : 1);
    ' -- "$bellpr_version" </dev/null 2>/dev/null || { bellpr_fail version; return 1; }
  fi
  bellpr_message installing "$BELLPR_PACKAGE@$bellpr_version" "$bellpr_prefix"
  # Published runtime dependencies are JavaScript-only; install hooks are unnecessary.
  # Redirect stdin so npm cannot consume the remainder of a curl | sh script.
  npm install --global --prefix "$bellpr_prefix" --ignore-scripts --no-audit --no-fund -- \
    "$BELLPR_PACKAGE@$bellpr_version" </dev/null || { bellpr_fail failed; return 1; }
  bellpr_bin_dir=${bellpr_prefix%/}/bin
  bellpr_command=$bellpr_bin_dir/$BELLPR_BIN
  [ -x "$bellpr_command" ] || { bellpr_fail no_bin; return 1; }
  bellpr_message installed
  bellpr_launch_path=$bellpr_bin_dir
  if [ -n "$bellpr_node_bin" ]; then bellpr_launch_path=$bellpr_node_bin:$bellpr_launch_path; fi
  case ":$bellpr_original_path:" in
    *":$bellpr_bin_dir:"*) bellpr_needs_path=0 ;;
    *) bellpr_needs_path=1 ;;
  esac
  if [ "$bellpr_needs_path" = 1 ] || [ -n "$bellpr_node_bin" ]; then
    bellpr_message path; printf 'export PATH='; bellpr_quote "$bellpr_launch_path"; printf ':"$PATH"\n'
  fi
  if [ -n "$bellpr_node_bin" ]; then printf 'PATH='; bellpr_quote "$bellpr_node_bin"; printf ':"$PATH" '; fi
  bellpr_quote "$bellpr_command"; printf '\n'
  bellpr_message check
  if [ -n "$bellpr_node_bin" ]; then printf 'PATH='; bellpr_quote "$bellpr_node_bin"; printf ':"$PATH" '; fi
  bellpr_quote "$bellpr_command"; printf ' doctor\n'
}

# A complete function is parsed before execution, including when delivered over a pipe.
bellpr_install_main "$@"
