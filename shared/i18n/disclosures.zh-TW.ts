/**
 * Approved disclosure sentences for Full access and passwordless sudo.
 */
export const fullAccessDisclosure =
  "「完整權限」預設關閉。開啟後會對寫入檔案的角色關掉 OS sandbox 和 credential deny 規則，這些 agent 可以讀 `~/.git-credentials` 和 `~/.ssh`，也能執行 `gh`、`git push`、`curl`；唯讀角色維持原本限制。只剩 `GH_TOKEN`/`GITHUB_TOKEN` 從環境變數移除這一項還有效。只在用完即丟的 VM 或 container 裡開。";

export const sudoDisclosure =
  "「免密碼 sudo」（僅 Linux）預設關閉。開啟後這個使用者帳號底下所有 process（包括 agent）都能不用密碼以 root 執行任何指令，讀得到那台機器上所有檔案，包括 token 和 SSH key。只在用完即丟的 VM 或 container 裡開。";
