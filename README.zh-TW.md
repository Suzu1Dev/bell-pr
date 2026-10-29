# BELL PR

**從「憑感覺寫」到「知道為什麼」。**

AI Agent 團隊負責跑腿；你理解每一處改動、用自己的話講一遍，只送出維護者樂意審閱的 PR。

[English](README.md) · 繁體中文

BELL PR 是自架、以本機為主的開源貢獻工作台。它在你的電腦上執行，搭配你已在使用的 AI 程式設計 CLI（OpenAI Codex CLI 或 Claude Code）與 GitHub CLI：先分析專案、建議可以貢獻的方向，再讓一支小型 Agent 團隊在獨立的 Git worktree 中完成修改。接著，它讓你做真正讓自己進步的那部分：理解你送出的每一行、在真實的程式碼裡練出品味，並尊重維護者的時間。它用白話解說每一個變更的檔案，在你核准前請你用自己的話把改動講一遍，並依照該專案自己的規範擬好 Pull Request 草稿。送出之前，它會確認專案接受你的 PR、issue 仍然開著而且沒人在做，以及改動審得完、測試也誠實。

**邊貢獻邊學習，絕不是自動產生 PR。** 在你逐一審閱每個檔案、用自己的話把改動講一遍（預設開啟；你可以關閉，而工作會標示出來），並親自核准 Pull Request 之前，不會發佈任何內容。發佈時會確認專案歡迎這個 PR。沒有 BELL PR 雲端服務、沒有遙測，也不需要帳號。

BELL PR 是以 [Apache-2.0](LICENSE) 授權的免費開源軟體。沒有付費版。

![「程式碼變更」頁籤：diff 旁邊是這次變更的白話解說](docs/images/zh-TW/run-changes-1280.png)

[用範例專案試試看](#用範例專案試試看) · [開始之前](#開始之前) · [快速開始](#快速開始) · [系統需求](#系統需求) · [功能](#功能) · [隱私](#隱私) · [安全模型](#安全模型) · [本機 API](#本機-api) · [設定](#設定) · [疑難排解](#疑難排解) · [文件](#文件) · [參與貢獻](#參與貢獻) · [授權條款](#授權條款與商標)

## 用範例專案試試看

這是一次已完成的範例貢獻（專案規範、計畫、diff、解說、理解檢查、PR 草稿），
**不需設定**、**不呼叫 AI**、也不會送到 GitHub。BELL PR 啟動後，從首頁的
「試用範例專案」或側欄「範例」開啟。

請先走完範例審閱流程，再匯入真實專案。`bell-pr doctor` 尚未就緒時，請用
`bell-pr start --force` 啟動，範例導覽才能開啟。真實的 Agent 工作仍要等到
有已登入的 AI 服務。

## 開始之前

BELL PR 是本機工作台。請先裝好並登入下列工具，再跑快速開始；`bell-pr doctor`
會為每一項缺失印出修正指令。

- **Node.js 22 以上**（[nodejs.org](https://nodejs.org/en)）。
- **Git**，並設定名字與電子郵件（`git config --global user.name` /
  `user.email`）。同步到最新目標分支需要 **Git 2.40 以上**。
- **GitHub CLI**（`gh`），並以 `gh auth login` 登入
  （[cli.github.com](https://cli.github.com/)）。
- **一套 AI 程式設計 CLI**（擇一），以執行 BELL PR 的同一使用者安裝並登入。
  用量計入**你自己的**服務商帳戶（付費方案或 API 額度，視服務商而定）：
  - Codex CLI：`npm install -g @openai/codex`，再 `codex login`
  - Claude Code：`npm install -g @anthropic-ai/claude-code`，再
    `claude auth login`
- **Linux** 另需 `bubblewrap` 與 `socat`（Claude Code 改檔沙箱；Debian/Ubuntu：
  `sudo apt-get install bubblewrap socat`）。macOS 使用內建沙箱。

目前支援：**macOS**、**Linux**。**Windows 透過 WSL2（尚未測試）：** 請在 WSL
發行版內安裝以上全部。

`bell-pr doctor` 必要檢查全過後，再繼續。在那之前，啟動新伺服器會在監聽前
結束。尚未安裝／登入 AI 服務時，`bell-pr start --force` 仍會開啟 BELL PR，
讓你走範例導覽；真實 Agent 工作與發佈會等到有就緒的 AI 服務為止。

## 快速開始

**這個分支尚未發佈到 npm。** npm 目前的 `bell-pr` `0.0.2` 是不含 CLI 的佔位套件，
安裝後不會提供 `bell-pr` 指令。請先使用以下原始碼版本。

1. Clone 或下載這個 repository，進入根目錄後，以 **Node.js 22.13 以上**執行：

   ```sh
   npm ci
   npm run build
   node bin/bellpr.mjs
   ```

2. 它會印出位址，並在瀏覽器中開啟 BELL PR：

   ```text
   BELL PR 1.0.0-rc.1 → http://127.0.0.1:4311
   ```

3. 依照歡迎畫面完成設定：選擇**語言**、檢查**工作環境**（缺少的工具都會附上修正指令），再選擇 Agent 使用的 **AI 服務**。
4. 觀看範例導覽、匯入 Repository，或尋找想貢獻的專案。

在這份原始碼裡，請把文件中的 `bell-pr` 換成 `node bin/bellpr.mjs`。
啟動新伺服器前，`bell-pr doctor` 必須就緒；`node bin/bellpr.mjs start --force`
仍可開啟範例導覽。

**要重新開啟 BELL PR，執行同一個指令即可。** 它會開啟使用同一資料目錄、已經執行中的服務。
在互動式 SSH 或沒有瀏覽器的終端機裡，會直接印出可開啟的授權連結；請勿分享這個連結。
不需要另外登入或執行 `open` 指令。

包含 CLI 的正式套件發佈到 npm 後，可以用 `npx bell-pr` 直接啟動，或用
`npm install -g bell-pr` 安裝 `bell-pr` 指令；目前這些指令還不會安裝這個分支。
[入門指南](docs/getting-started.md)（英文）會帶你走完一次完整的貢獻。

## 系統需求

- **Node.js 22 以上。**
- **Git。** 把工作同步到最新的目標分支需要 Git 2.40 以上；提交前需要在 Git 設定你的名字與電子郵件地址。
- **GitHub CLI**（`gh`），並以 `gh auth login` 登入，用於從 GitHub 匯入、發佈 Pull Request 與尋找專案。
- **Codex CLI 或 Claude Code**，以執行 BELL PR 的同一個使用者安裝並登入。兩者擇一即可。
  - Codex CLI：`npm install -g @openai/codex`，再執行 `codex login`。使用你已安裝並登入的 Codex CLI，用量計入你自己的帳戶。
  - Claude Code：`npm install -g @anthropic-ai/claude-code`，再執行 `claude auth login`。使用你已安裝並登入的 Claude Code CLI（Claude 方案或 Anthropic API 金鑰），用量計入你自己的帳戶。
- **Linux 需要 bubblewrap 與 socat**，Claude Code Agent 才能在沙箱中修改檔案（`sudo apt-get install bubblewrap socat`）。

`bell-pr doctor` 會檢查以上所有項目，並為每個問題印出修正指令。請見[開始之前](#開始之前)。

**尚未安裝或登入任何 AI 服務時：** `bell-pr doctor` 會以非零結束代碼結束，並將
必要的「AI 服務」檢查標為失敗。`bell-pr start` 啟動新伺服器時會在監聽前以非零結束代碼結束，
並印出該清單與每一項失敗檢查的修正指令。`bell-pr start --force` 仍會啟動，
並警告已略過檢查。歡迎畫面可繼續；你可以先走**範例導覽**（不呼叫 AI）。在
至少一套 Codex CLI 或 Claude Code 安裝並登入之前，無法開始真實的 Agent 工作；
探索功能另需已登入的 GitHub CLI。

### 一次範例執行的費用

Agent 用量由**你自己的** Codex／Claude 帳戶計費。BELL PR 不定價。典型第一次
貢獻的精確 token 與費用**尚未公布**——待實際量測後補上。

## 支援平台

- **macOS**
- **Linux**
- **Windows（透過 WSL2，尚未測試）：** 請在 WSL 發行版中安裝並執行 BELL PR、
  Git、GitHub CLI 與你的 AI CLI。1.0.0-rc.1 的瀏覽器測試與真實 agent 執行只在
  Linux 上做過。

1.0.0-rc.1 候選版本的單元測試、建置與套件檢查，在 Linux 與 macOS 上以 Node.js 22 與 24 執行（請見 CI 工作流程）。瀏覽器測試與真實 agent 執行只在 Linux 上做過，WSL2 尚未測試（請見[變更紀錄](CHANGELOG.md)）。另有 Docker 映像檔，目前為 beta。

## 功能

### 修改之前，先理解專案

Agent 以唯讀方式閱讀專案，說明它的用途、使用者、各部分如何搭配，以及該從哪裡開始讀。它每次分析最多建議五個貢獻方向，每個方向都引用所依據的程式碼或文件原文，BELL PR 會逐一確認這些引文確實存在；「**產出 5 個新建議**」一次再加五個，每個專案最多 30 個。同一頁的「**貢獻之前**」卡片會引用專案自己的貢獻規範（請見[尊重維護者的時間](#尊重維護者的時間)）。

![專案全貌：專案背景，以及引用專案規範的「貢獻之前」卡片](docs/images/zh-TW/repo-overview-1280.png)

### 小型 Agent 團隊，各自在獨立的 worktree 工作

你描述這次貢獻：誰會受益、對他們有什麼改變、哪些行為不能改變、怎樣才算完成。**Lead** 把工作拆成檔案範圍明確的任務，你可以確認計畫或退回並補充意見。**Teammates**（2、3 或 4 位，由你選擇）各自在自己的 Git worktree 中平行工作，透過團隊收件匣分享發現；它們被要求只改自己範圍內的檔案、不做純格式的修改，也絕不削弱、略過或刪除測試。整合之後，**Reviewer** 與 **Test analyst** 會檢查結果，各自只補充 Lead 摘要沒說到的部分。失敗的子任務可以重試。

規劃之前，Lead 會對照程式碼查核需求裡寫下的假設，並把結論告訴每個角色；任務簡介會顯示結論；工作完成後可以重新查核，在有這項查核之前建立的工作也能補做。預設的「工作目錄（預設）」權限要求 Agent 不用 `sudo`，也不做全域安裝。檢查需要這台電腦缺少的環境時，全貌頁會列出它與建議的安裝指令，由你確認後自行執行。模型設定可明確選擇「完整權限」，讓會寫入檔案的角色安裝與設定所需環境；這會移除它們的沙箱限制，唯讀角色仍維持原本限制。Linux 上也可選擇為執行 BELL PR 的使用者帳號設定免密碼 sudo，詳見[安全模型](docs/security-model.md#explicit-full-access)。

多項貢獻可以同時進行，上限由**設定 → 效能**或 `BELLPR_MAX_ACTIVE_RUNS` 決定（1 到 8；預設 2），其餘的依序排隊。

在**親手學**中，修改由你自己寫：嚮導陪你規劃、給不含程式碼的提示，並在你準備好時審查你的修改。BELL PR 會執行你的測試；這類工作裡，它的 Agent 無法修改你的檔案。

尚未送出的 Agent 任務在審閱階段有「**協作**」分頁：可以請 Agent 補測試、修正檢查失敗，或從 PR 草稿的 Limitations 段落帶入待完成項目。每輪保留改動檔案、實際觀察到的指令、未執行的檢查與問題；改動會取消相關檔案的已審閱狀態，並使已核准的任務退回審閱。已執行的驗證寫入 Validation，Limitations 只保留尚未覆蓋的項目與限制，並保留更新前後的文字供你確認；Agent 不會替你提交、推送或送出 PR。執行中可停止，已改的檔案會保留。這項功能不適用於「親手學」。

![Agent 動態：團隊的計畫、進度與報告](docs/images/zh-TW/run-activity-1280.png)

### 會教你、並請你用自己的話講一遍的審閱

每個變更的檔案都附有白話解說：修改前後行為的具體例子、改了什麼與為什麼、相關觀念、審閱時要注意什麼、另一種可行做法，以及一題考考自己。**先試著答**：在答案出現之前，你先回答這題並選擇有多確定，再自己評分；在另一種做法出現之前，你也可以先猜猜還能怎麼改，再選擇在這個專案裡你會採用哪一種、為什麼。點選任一行就能請 Agent 解說，可依建議順序閱讀、寫下自己的筆記，逐檔標記為已審閱，然後在核准前用自己的話把改動講一遍。你也可以自己修改程式碼，再重新整理差異。

diff 可以展開每段變更周圍未變更的程式碼，一次 20 行或整個檔案。「**程式碼解說**」會逐步說明每段變更所在的函式、在 diff 中標出對應的行，並列出誰呼叫它、它又呼叫了誰；整段新增的函式則指回變更解說，不重複說明。

**只送出你講得清楚的程式碼。** 核准之前，diff 旁邊會開啟一個簡短的閉卷檢查：用幾句自己的話說明這次改動、回答關於風險最高的檔案最多三個問題（很小的改動不會有題目），有原始碼變更時再說明你沒測試什麼。接著把每個答案和 AI 寫的參考答案並排對照、自己評分，並修正答錯的地方。不會有 AI 模型替你評分，這個檢查也不會呼叫 AI。理解檢查預設開啟。你可以在**設定 → 學習**關閉它：每個檔案仍然必須審閱、你仍然要親自核准 Pull Request，而未經檢查就核准的工作會永久標示「理解檢查已關閉」。

![diff 旁邊的理解檢查：你的說明、你的答案與你的評分](docs/images/zh-TW/run-check-1280.png)

### 遵循專案規範的 Pull Request

BELL PR 會閱讀專案的貢獻指南、AI 政策、PR 範本、Agent 指南與檢查 PR 的 workflow，建議標題、說明與提交訊息，並標出每條規則的來源。你自己的說明可以作為描述的開頭：按「**使用我的說明**」就能放進去，「**把我沒測試的部分加到 Testing**」則會補上你沒測試的部分。描述仍是 BELL PR 建議的文字時，發佈前會請你確認；如果專案要求用貢獻者自己的話撰寫，則會等你改寫後才發佈。可審查性快照會把這次改動的大小和專案最近合併的 PR 並列；被略過、刪除或放寬的測試，發佈前都需要一行理由。計畫有彼此不相依的部分時，發佈前的確認會列出它們，PR 草稿頁的「**拆成獨立的貢獻**」也能把每個部分依檔案拆成獨立的貢獻。一個部分是計畫依檔案分開的一組檔案，不一定是一項修正，請自己確認分組。

送出前會檢查內容。發佈前會擋下常見格式的 token 與私鑰。尚未填寫的待填標記會擋下送出，本機路徑、CI 設定變更與會公開的提交電子郵件地址則需要你確認。只有專案要求或你自己選擇時，才會註明 AI 協助；專案要求揭露時，在揭露寫好之前不會發佈。發佈時會推送分支（必要時推到你的 fork），並透過 GitHub CLI 開啟 **Draft** PR；絕不會 force push。

推送到既有的 fork 前，工具會先確認它來自目前的目標專案。

若先前發佈已建立本機提交，但在開始推送前中斷，可在 PR 草稿頁按「**恢復未完成的發佈**」。工具會確認 GitHub 狀態，保留檔案與草稿並回到待審閱，再由你重新核准與提交。若已有對應分支或 PR，或無法確認 GitHub 狀態，就不會恢復。

![「PR 草稿」頁籤：PR 標題與說明的編輯器，旁邊列出送出前還要完成的項目](docs/images/zh-TW/run-draft-1280.png)

### 尊重維護者的時間

任何東西都可以在本機練習；只發佈受歡迎的 PR。

- **貢獻之前。** 專案全貌會從專案自己的檔案引用它的規範，並附上檔案與行號：對 AI 協助貢獻的規定、揭露 AI 協助、用自己的話撰寫描述、說明自己的改動、留給新手的 issue、寫給 AI Agent 的說明，以及先開 issue 的要求。它也會顯示這個專案是否接受你的 PR。BELL PR 絕不會說一個專案沒有規範，只會說它讀了哪些檔案。
- **issue 仍然開著、仍然是你的。** 連結 issue 後，任務對話框會顯示它是否仍然開著、是否已指派給別人或有人認領、是否已有別人的 PR 會關閉它，以及維護者最近在那裡說了什麼。這些都不會阻止你開始與練習；發佈時會再檢查一次。
- **先把上一個 PR 處理完，再開下一個。** BELL PR 會計算你在這個 repository 中尚未關閉的 PR。在你第一個 PR 被合併之前，額度是 1 個，之後是 2 個：達到額度時，發佈前會請你確認；維護者等你回覆 review 超過 7 天時也會；達到額度的兩倍時，則要等你完成或關閉其中一個才能發佈。這些數字是 BELL PR 的預設值。你有寫入權限的 repository 不受限制，本機的工作也永遠不受限制。
- **發佈時再檢查一次。** 發佈時會再從 GitHub 讀取這些事實。專案不接受你的 PR、規範不接受 AI 協助的貢獻、issue 已關閉、issue 是專案留給新手的，以及達到額度的兩倍，都會擋下發佈，而且無法略過；別人已有會關閉同一個 issue 的開啟中 PR 時，要等你寫下理由才能發佈。BELL PR 讀不到的事實會顯示「無法確認」，絕不會當成通過。

[負責任地貢獻](docs/contributing-responsibly.md)（英文）用維護者自己的話說明他們要求什麼，以及每一項檢查如何對應。

### 發佈之後

可以把工作或它的 Pull Request 同步到最新的目標分支，並讓 Agent 解決衝突供你審閱。「**讀取回饋**」會在你按下時讀取一次維護者的 review、留言與 CI 結果：把它們和你的預測對照，並標記每則意見談的是什麼、你是否料到。接著可以讓 Agent 依你選取的意見進行一輪修正，前提是你先用自己的話重述每一則意見；經你審閱後，以一個新的 commit 推送。「**Commit 歷程**」列出 Pull Request 的每個 commit，從第一次推送到修正輪、同步與在 GitHub 上做的提交，每個都能展開看各檔的 diff。

回應維護者回饋時，程式碼審查預設只顯示本輪相對於上一個 PR 版本的修改。程式碼工具列中的選單可切換到首次提交、已推送的修正輪次或全部累計變更。歷史與累計檢視為唯讀；回到本輪修正後，才能勾選已審閱並核准。

### 找到下一個貢獻

探索功能會在 GitHub 上搜尋符合你的興趣、程式語言與想挑戰難度的專案與 issue，閱讀它們的貢獻規範，並說明工作量與第一步。它為 Agent 團隊尋找 help wanted 的 issue；標示給新手的 issue 會標上「親手學」，因為親自寫出那個修正，正是新手認識專案的方式。

![探索貢獻：在 GitHub 上尋找下一個貢獻](docs/images/zh-TW/discover-1280.png)

### 學習頁與練習

所有貢獻的解說與筆記都集中在同一頁，並可搜尋，方便日後回顧某個觀念。「**練習**」會在 1、3、7、21 天後把你自己的題目帶回來：你有把握卻答錯的答案、讓你意外的維護者意見，以及你從沒試過的題目。來自你紀錄的簡單統計（例如你說「確定」時答對幾次）會在累積足夠時才出現，而且都不是分數或目標。**教練回顧**會讀取你在某個專案的紀錄，指出維護者最常提出的面向，並從你自己的貢獻出題做練習；你也能把一次貢獻的完整學習紀錄匯出為 Markdown。

![學習頁：跨貢獻收集的筆記，以及「練習」與「教練回顧」分頁](docs/images/zh-TW/learning-1280.png)

### 你的工具、你的帳號、你的語言

選擇 Codex CLI 或 Claude Code、模型、該模型提供的思考強度（從 none 到 ultra），以及效率模式（輕量、完整或關閉）。每個工作都會顯示服務商回報的用量。CLI 失敗時會先顯示它回報的錯誤，原始輸出則收合起來。介面與 Agent 的解說可以使用英文或繁體中文（台灣）；除非專案另有要求，Pull Request 一律使用英文。

**Agent 的網路存取**是一項設定，在你開啟之前都是關閉的。開啟後，Claude Code 只能開啟 GitHub 自家網站的頁面；Codex CLI 使用 OpenAI 的網路搜尋。專案分析與探索永遠不會有網路存取。

## 隱私

- BELL PR 在你的電腦上執行，所有資料都放在同一個資料目錄。沒有 BELL PR 雲端、帳號、遙測或分析。
- 你的程式碼與提問只會送到你自己設定的服務：你選擇的 AI CLI 背後的服務商，以及 GitHub，都使用你自己的帳號。
- Agent 的網路存取預設關閉，只有你開啟時才會使用。
- 你可以在應用程式中釋放某個工作的檔案、刪除工作或專案，或刪除所有資料。

詳情請見[隱私與資料](docs/privacy-and-data.md)（英文）。

## 安全模型

- **在沙箱中執行的 Agent。** 在預設的「工作目錄」模式下，會寫程式的 Agent 在各自 CLI 的作業系統沙箱中執行：寫入限制在該工作自己的 worktree，網路也會關閉。Claude Code 無法讀取 GitHub CLI 的設定檔、`~/.git-credentials` 與 credential-store 檔案、`~/.netrc` 與 `~/.ssh/`。`GH_TOKEN`/`GITHUB_TOKEN` 會從 agent 的環境變數中移除。系統 keyring 裡的 token 不在保護範圍內：agent 仍可透過 `gh auth token` 讀到你的 GitHub token。主要防線是改用權限最小的 fine-grained token。Claude Code 另外無法讀取自己 checkout 以外的 BELL PR 資料。「完整權限」預設關閉。開啟後會對寫入檔案的角色關掉 OS sandbox 和 credential deny 規則，這些 agent 可以讀 `~/.git-credentials` 和 `~/.ssh`，也能執行 `gh`、`git push`、`curl`；唯讀角色維持原本限制。只剩 `GH_TOKEN`/`GITHUB_TOKEN` 從環境變數移除這一項還有效。「免密碼 sudo」（僅 Linux）預設關閉。開啟後這個使用者帳號底下所有 process（包括 agent）都能不用密碼以 root 執行任何指令，讀得到那台機器上所有檔案，包括 token 和 SSH key。兩者都只在用完即丟的 VM 或 container 裡開。
- **匯入的專案不受信任。** 專案的程式碼、文件與 Agent 指示（`AGENTS.md`、`CLAUDE.md`、`.claude/`）都只被當成資料：CLI 不會載入專案自己的設定、hooks 或指示；Git 設定可能執行其他程式的 repository 會被拒絕。BELL PR 自己執行的 git 也會關掉這些程式；只有會連到 GitHub 的 git 才會拿到 `GH_TOKEN`。Agent 仍會執行專案的程式碼，請只匯入你願意在這台電腦上執行的專案。
- **瀏覽器存取與 API 權杖。** 每次安裝都會在資料目錄保存一枚權杖。API 請求必須帶上這枚權杖，或已授權的瀏覽器工作階段。預設只在 `127.0.0.1` 上監聽。其他網站可以連結到它的頁面，但無法呼叫它的 API，也無法以框架嵌入它。
- **在沙箱外執行必須明確開啟。** 沒有沙箱時（例如使用預設設定的 Docker），會修改檔案的 Claude Code Agent 會被拒絕。你可以在**設定 → Agent 安全**或用 `BELLPR_ALLOW_UNSANDBOXED_AGENTS=1` 允許；這類 Agent 擁有你完整的使用者權限，用過它的每個工作都會顯示「**未使用沙箱執行**」標記。
- **由你發佈。** 在你逐檔審閱並核准之前，不會有任何內容送到 GitHub，而且 commit 只包含你審閱過的檔案。

詳情與限制請見[安全模型](docs/security-model.md)（英文）。回報安全性漏洞請見 [SECURITY.md](SECURITY.md)。

## 本機 API

BELL PR 在 `127.0.0.1` 的埠 4311 提供網頁介面與 API，除非你設定 `--host` 或 `BELLPR_HOST`。它不會在 `0.0.0.0` 上監聽，除非你明確要求。其他位址都是明確設定，啟動時會印出警告。API 權杖仍然必要。

第一次啟動會把隨機權杖寫入 `<資料目錄>/api-token`（32 位元組，權限 `0600`，只有你的使用者能讀）。之後的啟動會沿用這個檔案。檔案遺失或內容損壞時會重新建立。`bell-pr token rotate` 會更換它；執行中的 BELL PR 在下一個請求就使用新權杖。更換後請再執行 `bell-pr open`，瀏覽器才會帶上新權杖。

除了 `GET /api/health`，每個 API 請求都必須送出權杖：

```http
Authorization: Bearer <token>
```

`X-Bell-Token: <token>` 效果相同。缺少或錯誤的權杖會得到 HTTP 401。請求的 Host 必須是受信任的位址（`localhost`、`127.0.0.1` 或 `[::1]` 加上 BELL PR 的埠，或你用 `BELLPR_PUBLIC_URL`、`BELLPR_ALLOWED_ORIGINS` 指定的主機）。瀏覽器的 `Origin` 若不是這個應用程式自己的來源，也不在允許清單上，就會被拒絕。沒有萬用字元 CORS。會變更資料的請求必須使用 `application/json`。

`bell-pr` 開啟瀏覽器時，位址的片段是 `#bell_token=<權杖>`。頁面會存下權杖，再從位址列移除。啟動時印出的那一行不含權杖，因此服務記錄裡也不會有。`bell-pr open` 印出的位址不含權杖，權杖只交給瀏覽器。`bell-pr open --print` 只印出位址，同樣不含權杖。`bell-pr open --print-token` 會印出帶權杖的位址（加上 `--print` 則不開瀏覽器）。請把那個位址當成密碼。它不會寫進伺服器記錄，也不會出現在 `bell-pr doctor --json`。

token 可能留在瀏覽器歷史紀錄裡，如果這個瀏覽器設定檔有跟別人共用，請執行 `bell-pr token rotate`。

## 設定

BELL PR 不需要任何設定就能啟動。下列設定都是啟動時讀取的環境變數；`bell-pr start` 另外接受 `--port`、`--host`、`--data-dir`、`--no-open`、`--force` 與 `--env-file <file>`。必要的 `bell-pr doctor` 檢查失敗時，`start` 會在監聽前結束；`--force` 仍會啟動。在應用程式「設定」中調整的值，除非被環境變數指定，否則都會生效。

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `BELLPR_PORT` | `4311` | 網頁介面與 API 的埠（1024 到 65535） |
| `BELLPR_HOST` | `127.0.0.1` | 監聽的位址；若要從其他電腦連線，請保留預設值，改用 HTTPS 反向代理並設定 `BELLPR_PUBLIC_URL` |
| `BELLPR_PUBLIC_URL` | 無 | 在反向代理或其他對外埠之後時，瀏覽器使用的網址 |
| `BELLPR_ALLOWED_ORIGINS` | 無 | 額外接受的精確 origin，以逗號分隔 |
| `BELLPR_DATA_DIR` | `~/.bellpr` | 資料目錄 |
| `BELLPR_NO_OPEN` | 未設定 | `1` 表示絕不開啟瀏覽器 |
| `BELLPR_LOCALE` | `en` | 伺服器與 CLI 訊息的預設語言（`en` 或 `zh-TW`） |
| `BELLPR_LOG_LEVEL` | `info` | `debug`、`info`、`warn` 或 `error` |
| `BELLPR_MAX_AGENT_PROCESSES` | `3` | 同時執行的 Agent CLI 行程數（1 到 32） |
| `BELLPR_MAX_ACTIVE_RUNS` | `2` | 同時執行的貢獻工作數（1 到 8） |
| `BELLPR_AGENT_TIMEOUT_SCALE` | `1` | Agent 逾時時間的倍率（0.5 到 10） |
| `BELLPR_ALLOW_UNSANDBOXED_AGENTS` | 未設定 | `1` 允許 Claude Code Agent 在沙箱外修改檔案 |
| `BELLPR_REQUIRE_UNDERSTANDING_CHECK` | 未設定 | `1` 保持理解檢查開啟並鎖定這項設定；沒有任何值能關閉它 |
| `BELLPR_RETENTION_DAYS` | `14` | 已取消與失敗工作的檔案保留天數（1 到 365） |
| `BELLPR_DEV` | 未設定 | 開發模式，只用於開發 BELL PR 本身 |
| `BELLPR_FRONTEND_PORT` | `4310` | 開發模式信任的開發伺服器埠 |
| `BELLPR_STATIC_DIR` | 套件的 `dist/` | 要提供的已建置網頁介面 |

每個變數、指令與應用程式設定的說明請見[設定說明](docs/configuration.md)（英文）；[.env.example](.env.example) 是附註解的範本。只用於 BELL PR 自身測試的變數列在[開發說明](docs/development.md#test-and-tool-variables)（英文）。

## Docker（beta）

```sh
docker build -t bell-pr .
docker run -d --name bell-pr -p 127.0.0.1:4311:4311 \
  -v bellpr-data:/data -v bellpr-home:/home/node bell-pr
docker exec bell-pr bell-pr open --print --print-token
```

映像檔包含 Git、GitHub CLI 與 Codex CLI；Claude Code 可以由你自行安裝到容器中。映像檔的指令是 `bell-pr start`，在 `bell-pr doctor` 尚未就緒時會在監聽前結束。若要在登入 AI 服務之前開啟範例導覽，請執行 `docker run ... bell-pr start --force`（這會取代映像檔的指令）。Docker 目前為 **beta**：Agent 的沙箱需要另外三個 `--security-opt` 選項。使用前請先閱讀 [Docker 說明](docs/docker.md)（英文）；若要以 systemd 服務執行或放在反向代理之後，請見[自架說明](docs/self-hosting.md)（英文）。

## 疑難排解

```sh
bell-pr doctor
```

會檢查 Node.js、Git、GitHub CLI 與其權限、Agent CLI 與其登入狀態、Claude Code 沙箱以及資料目錄，並為每個問題印出修正指令。`bell-pr doctor --json` 以 JSON 輸出同一份報告。所有必要檢查都通過時，結束代碼為 0。

[疑難排解](docs/troubleshooting.md)（英文）列出[每個錯誤代碼](docs/troubleshooting.md#error-codes)與修正方式、說明 [BELL PR 為什麼擋下發佈](docs/troubleshooting.md#publishing-was-blocked-by-a-project-rule-an-issue-or-pacing)、BELL PR 無法啟動時該怎麼辦，以及如何收集支援所需的資訊。

## 資料目錄與備份

BELL PR 把所有資料放在 `~/.bellpr`（或 `--data-dir`／`BELLPR_DATA_DIR` 指定的目錄）：`state.json` 中的專案與工作、它自己的專案 clone、每個工作的 Git worktree、分析結果、設定與記錄檔。只有你的使用者可以讀取。

- **備份**時請先停止 BELL PR，再複製整個目錄。請還原到相同路徑：裡面的紀錄包含絕對路徑。
- BELL PR 會保留 `state.json` 的最近三個版本，檔案損壞時會自動復原。
- 同一個資料目錄一次只能有一個 BELL PR 執行。
- **升級**不會搬動你的資料，而且從 1.0.0 起，舊版本仍能讀取新版本寫入的資料。請見[升級說明](docs/upgrading.md)（英文），其中也說明 1.0 之前版本的資料。

## 文件

文件目前只有英文版。

- [入門指南](docs/getting-started.md)
- [設定說明](docs/configuration.md)
- [疑難排解](docs/troubleshooting.md)
- [負責任地貢獻](docs/contributing-responsibly.md)
- [隱私與資料](docs/privacy-and-data.md)
- [升級說明](docs/upgrading.md)
- [常見問題](docs/faq.md)
- [自架說明](docs/self-hosting.md)與 [Docker 說明](docs/docker.md)
- [安全模型](docs/security-model.md)
- [開發說明](docs/development.md)：從原始碼建置與檢查 BELL PR
- [變更紀錄](CHANGELOG.md)

<!-- generated:product-link key=docsUrl text="線上文件" -->
<!-- /generated:product-link -->

## 參與貢獻

歡迎參與 BELL PR 的開發。請先閱讀 [CONTRIBUTING.md](CONTRIBUTING.md)（英文），並遵守[行為準則](CODE_OF_CONDUCT.md)（英文）。BELL PR 要求你負責任地向其他專案貢獻，對這裡的貢獻者也是同樣的要求：小而清楚、你自己看得懂、誠實的改動。[負責任地貢獻](docs/contributing-responsibly.md)（英文）說明維護者要求什麼，[開發說明](docs/development.md)（英文）說明如何從原始碼建置與檢查 BELL PR。

## 支援

請先執行 `bell-pr doctor`，再查看[疑難排解](docs/troubleshooting.md)與[常見問題](docs/faq.md)；其餘主題請見[文件](docs/README.md)（皆為英文）。「關於」對話框（**設定 → 關於 → 關於 BELL PR**）可以複製一份診斷資訊，其中的密鑰、路徑與你的 GitHub 帳號都已移除，可以直接貼到支援請求中。

私下回報安全性漏洞請見 [SECURITY.md](SECURITY.md)。請勿公開開 issue。

<!-- generated:product-link key=homepageUrl text="網站" -->
<!-- /generated:product-link -->
<!-- generated:product-link key=supportEmail text="以電子郵件聯絡支援" -->
<!-- /generated:product-link -->
<!-- generated:product-link key=publicRepoUrl path=issues text="回報問題" -->
[回報問題](https://github.com/Suzu1Dev/bell-pr/issues)
<!-- /generated:product-link -->
<!-- generated:product-link key=securityEmail text="私下回報安全性問題" -->
<!-- /generated:product-link -->

## 授權條款與商標

BELL PR 是開源軟體，依 [Apache License 2.0](LICENSE) 授權（另見 [NOTICE](NOTICE)）。如授權條款所述，軟體以「現狀」（as is）提供，不附帶任何形式的保證。BELL PR 包含的第三方軟體列於 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

BELL PR 的名稱與標誌不在 Apache 授權範圍內；你可以如何使用它們，請見 [TRADEMARKS.md](TRADEMARKS.md)。

BELL PR 是獨立專案，與 GitHub, Inc.、OpenAI 及 Anthropic PBC 皆無關聯，也未獲其認可或贊助。GitHub、OpenAI、Codex、Anthropic、Claude 與 Claude Code 均為其各自擁有者的商標；BELL PR 提及這些名稱，僅為說明可搭配使用的工具。
