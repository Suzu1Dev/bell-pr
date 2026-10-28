# 入門指南

本指南帶你從安裝 BELL PR 到送出第一個 Draft PR。請先完成「開始之前」，並在
碰真實專案前走完範例導覽。

## 開始之前

你需要：

- **Node.js 22 以上**（[nodejs.org](https://nodejs.org/en)）。
- **Git**。把工作同步到最新目標分支需要 Git 2.40 以上。請先設定一次名字與
  電子郵件：`git config --global user.name "你的名字"` 與
  `git config --global user.email "you@example.com"`。
- **GitHub CLI**（`gh`），並以 `gh auth login` 登入
  （[cli.github.com](https://cli.github.com/)），用於從 GitHub 匯入、發佈
  Pull Request 與尋找專案。
- **一套 AI 程式設計 CLI**，以執行 BELL PR 的同一使用者安裝並登入。兩者擇一
  即可；用量計入**你自己的**帳戶：
  - Codex CLI：`npm install -g @openai/codex`，再 `codex login`。
  - Claude Code：`npm install -g @anthropic-ai/claude-code`，再
    `claude auth login`（Claude 方案或 Anthropic API 金鑰）。
- **Linux 需要 bubblewrap 與 socat**，Claude Code 改檔 Agent 才能在作業系統
  沙箱中執行（Debian／Ubuntu：`sudo apt-get install bubblewrap socat`）。
  macOS 使用內建沙箱。

BELL PR 可在 **macOS**、**Linux**，以及 Windows 的 **WSL2** 內執行
（[安裝 WSL](https://learn.microsoft.com/windows/wsl/install)；請在 WSL
發行版內安裝以上全部）。1.0.0-rc.1 的瀏覽器測試與真實 Agent 執行**尚未在
WSL2 上驗證**。

`bell-pr doctor` 會檢查以上項目，並為每個問題印出修正指令。`bell-pr start`
只有在每一項必要檢查都通過時才會監聽。歡迎畫面會跑同一套檢查。

### 尚未設定任何 AI 服務時

`provider-ready` 是 **必要** 的 doctor 檢查。在 Codex CLI 與 Claude Code
都未安裝並登入時：

- `bell-pr doctor` 以非零結束代碼結束，並回報 **尚未就緒**。
- `bell-pr start` 在監聽前以非零結束代碼結束，並印出每一項失敗的必要檢查
  與修正指令。
- `bell-pr start --force` 仍會啟動並印出警告。此時 `/api/status` 顯示
  `ready: false`。
- 歡迎畫面可繼續。你可以先走**範例導覽**（不呼叫 AI、不送 GitHub）。仍可
  選擇匯入；但在至少一套 AI 服務就緒之前，無法開始**真實**的 Agent 工作。
  探索功能另需已登入的 GitHub CLI。

### 一次範例執行的費用

<!-- TODO(Suzu / Product Tester)：完成一次真實端到端貢獻後填入（不是離線
     範例專案）。記錄：服務商、模型、工作回報的 input／output tokens，以及
     服務商帳單或儀表板上的費用。貼上實測數字。勿捏造估算。 -->

Agent 用量由**你自己的** Codex 或 Claude 帳戶計費。BELL PR 不定價。典型
第一次貢獻的實測 token 與費用**尚未公布**。

## 啟動 BELL PR

```sh
npx bell-pr
```

或安裝一次後以名稱啟動：

```sh
npm install -g bell-pr
bell-pr
```

它會印出位址並開啟瀏覽器：

```text
BELL PR 1.0.0-rc.1 → http://127.0.0.1:4311
```

只有每一項必要的 doctor 檢查都通過，或你加上 `--force` 時，才會出現這一行。
否則 `bell-pr start` 會先結束並印出修正指令。尚未登入 AI 服務時，`--force`
是開啟範例導覽的方式。

請保持終端機開啟（Ctrl+C 可停止）。BELL PR **本身沒有登入**：能連到它位址
的人可以使用它能做的一切，包括以你的 Codex 或 Claude Code 帳戶啟動 Agent，
以及以你的 `gh` 登入發佈。預設只在 `127.0.0.1` 上監聽，因此只有這台電腦能
連到它。詳見[安全模型](security-model.md)（英文）。

> **位址不見了？** 執行 `bell-pr open`（或 `npx bell-pr open`）。見
> [疑難排解](troubleshooting.md#i-lost-the-address)（英文）。

`bell-pr start --port <埠>` 可換埠。若要以服務、Docker 或反向代理執行，見
[自架說明](self-hosting.md)與 [Docker](docker.md)（皆為英文）。

## 歡迎畫面步驟

1. **語言** — 英文或繁體中文（台灣）。之後可在設定中變更。
2. **工作環境** — 與 `bell-pr doctor` 相同的檢查，並附可複製的修正指令。
   可先繼續，稍後在**設定 → 工作環境**補完。
3. **AI 服務** — 若只有一套就緒就使用它；兩套都就緒則由你選擇。若尚未有
   就緒的服務，請用 `bell-pr start --force` 啟動；歡迎畫面會說明你仍可先看
   範例導覽。
4. **開始使用** — 範例導覽、匯入 repository，或尋找專案（探索需要 `gh`）。

## 用範例專案試試看

這是對一個小型 HTTP 用戶端的已完成貢獻：虛構的專案規範、計畫、diff、解說、
理解檢查與 PR 草稿。**不需工具、不需帳號、不呼叫 AI、也不送任何東西到
GitHub。** 從首頁「試用範例專案」或側欄「範例」開啟。請先走完再匯入真實
專案。

## 1. 匯入 repository

在**專案**頁以 `owner/repo`、GitHub 網址，或本機 Git 路徑匯入（在 Windows
上請用 **WSL 內**的路徑，例如 `/mnt/c/projects/repo`）。

BELL PR 會在資料目錄中自建完整 clone；不會改動你自己的資料夾。clone 超過
10 分鐘會停止——請自行 clone 後再匯入該資料夾。之後對來自 GitHub 的專案，
「**更新到最新版本**」會同步預設分支的最新 commit。

## 2. 理解專案

專案全貌上的「**貢獻之前**」會引用專案自己的規範（檔案＋行號）：AI 政策、
揭露、用自己的話寫描述、新手 issue、先開 issue，以及是否接受你的 PR。讀
不到的事實顯示「無法確認」／「無法讀取」——絕不當成通過。「**再檢查一次**」
會重新讀取。

「**分析專案**」以唯讀 Agent 說明專案做什麼、誰在用、各部分如何搭配、該從
哪裡開始讀，並建議最多五個貢獻方向（引文會驗證）。「**產出 5 個新建議**」
可再加（每專案最多 30）。

## 3. 選擇方向

描述誰會受益、對使用者有什麼改變、哪些不能改、怎樣才算完成。可選擇連結
一個 GitHub issue。issue 欄下方的「**開始之前**」會顯示開／關、指派、競爭
中的 PR、新手標籤與你的開放 PR 額度——這些都不會擋本機練習；發佈時會再檢查。

設定團隊人數（2–4 位 Teammate）、是否先核准計畫，以及效率模式。Agent、模型
與思考強度由所有專案共用。

## 4. 讓 Agent 團隊工作

按「**產生團隊計畫**」或「**啟動 Agent 團隊**」。在「**Agent 動態**」中：
Lead 規劃（含前提查核）、你可核准或退回計畫（最多 3 次）、Teammates 在各自
worktree 平行工作，再由 Reviewer 與 Test analyst 報告。Agent 不得改動你的
電腦；缺少的環境會列在「這台電腦需要你安裝的項目」，由你自行執行。失敗的
子任務可重試。同時進行的工作數見**設定 → 效能**（預設 2）。

## 5. 審閱每一處變更

在「**程式碼變更**」：每個檔案的 diff 與白話解說、可選的逐行「**詢問**」、
審查報告、「**程式碼解說**」與你的筆記。逐檔標記為**已審閱**。「**先試著答**」
會在揭曉前請你作答，再由**你自己**評分。你也可以在工作的 `worktrees/` 資料夾
改檔後「**重新整理差異**」。

解說來自 AI，可能有錯——請對照程式碼確認。

## 6. 用自己的話講一遍

每個檔案都標記已審閱後，「**用自己的話講一遍**」會在 diff 旁開啟簡短的閉卷
檢查（解說與 Agent 問答會隱藏；diff 仍在）：

1. 用 2–4 句自己的話說明這次改動（至少 15 個字）。
2. 回答關於風險最高檔案的最多三題（依改動大小調整）；有原始碼變更時再說明
   你沒測試什麼。
3. 把每個答案和參考並排，**自己評分**（答對／部分／沒答對）。沒有 AI 替你
   評分；這個檢查也不呼叫 AI。
4. 對評為「部分」或「沒答對」的答案寫下修正。
5. 可選擇預測維護者最可能質疑什麼。

結果是一張收據，不是分數。理解檢查預設開啟；可在**設定 → 學習**關閉（工作
會標示「理解檢查已關閉」）。無論開關，每個檔案仍須已審閱、仍須你親自核准，
且專案規範／issue／節奏檢查仍然適用。

## 7. 準備並發佈 Pull Request

在「**PR 草稿**」編輯建議的標題、說明與提交訊息（各附規則來源）。「**使用我的
說明**」／「**把我沒測試的部分加到 Testing**」只有在你按下時才會插入你的文字。
請檢視可審查性快照與維護者檢查清單。憑證與未填妥的待填標記會擋下發佈；本機
路徑、CI 變更與非 no-reply 的提交電子郵件需要確認。

「**核准並準備 PR**」，再「**送出 Draft PR**」：會再讀一次 GitHub 事實、推送
分支（必要時推到 fork），並開啟 **Draft** PR。絕不會 force push。擋下與確認
項目見[疑難排解](troubleshooting.md#publishing-was-blocked-by-a-project-rule-an-issue-or-pacing)（英文）。

## 8. 發佈之後

- **同步**到最新目標分支（目標分支改過的檔案需再審閱；衝突可手動或請 Agent）。
- 在你按下時「**讀取回饋**」一次——不會輪詢。請在 GitHub 上用自己的話回覆。
- 對照你的預測為意見加上標記；選定意見後先用自己的話重述，再開始一輪
  **後續修正**；審閱後以一個 commit 推送。
- 「**Commit 歷程**」列出該 PR 的每個 commit。

## 持續學習

側欄的**學習筆記**、**練習**（1／3／7／21 天）、簡單統計（絕不是分數）、
**教練回顧**、**匯出學習紀錄**，以及**探索貢獻**（新手 issue 會標「親手學」）。

## 快捷鍵

- **Ctrl+K**（macOS 為 ⌘K）— 在專案與工作間快速切換。
- 在文字欄外按 **?** — 開啟指南。
- 工作區分頁 — 方向鍵、Home、End。

下一步：[設定說明](configuration.md)、[疑難排解](troubleshooting.md)、
[常見問題](faq.md)（目前皆為英文）。
