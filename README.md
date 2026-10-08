# BELL PR

透過網頁操作的本機 PR 貢獻工作台：先理解專案用途、使用者與貢獻動機，再指定改善方向，讓 Agent team 分工開發。完成後將使用者影響對照 Git diff、用白話解說與問答學習，最後編輯並送出 PR 草稿。

## 開始使用

需要 Node.js 22 以上與 npm。實際開發與 GitHub 操作另外需要 Git、GitHub CLI (`gh`)，以及 Codex CLI (`codex`) 或 Claude Code CLI (`claude`)；建立提交前需設定 Git 的 `user.name` 與 `user.email`。

```sh
npm install
npm run dev
```

開啟 <http://127.0.0.1:4310>。開發環境的網頁使用 4310 埠，API 使用 4311 埠；兩者都綁定本機介面。

要操作真實 repository，請先在啟動本工具的同一個使用者環境完成登入：

```sh
gh auth login
codex login
claude auth login   # 只在要改用 Claude Code 時需要
```

本工具使用這些 CLI 既有的登入狀態，不需要在網頁輸入 GitHub token 或模型 API key。

## 一次完整的貢獻

1. **先體驗示範**：預設的「SDK 智慧重試機制」包含專案全貌、使用者流程、貢獻前後的體驗、共享任務板與範例 diff。示範分析與問答都預先寫好，不會啟動 Codex 或建立 GitHub PR；示範審閱狀態與草稿存於瀏覽器。
2. **匯入並理解專案**：在「Repositories」貼上 GitHub 連結或本機 Git 專案完整路徑。匯入後先進入「專案全貌」，按「分析專案全貌」取得用途、主要模組與有來源依據的改善建議。這一步不會啟動開發。
3. **指定貢獻方向**：選擇修復問題、新增功能、效能、使用體驗、測試、文件或維護，描述誰會受益、預期成果、開發界線與驗收方式。也可從 AI 建議帶入內容，再自行調整。方向設定依專案儲存；執行模型與思考強度則是所有專案共用的一組設定。
4. **確認團隊計畫**：設定最多 2–4 位 teammates，預設會先由 Lead 產生計畫，等待你確認任務、檔案範圍與相依關係，再進入開發。「Agent 動態」提供共享任務板、工作報告、團隊訊息與停止操作。「查看全部貢獻」可切換所有工作。
5. **理解與審查**：先看本次貢獻的動機與預期影響，再進入程式碼。Agents 完成後會自動整理每份 diff 的白話解說，直接呈現在「變更解說」，不必手動提問。先看「白話文舉例」的具體情境與修改前後差別，再讀技術細節。左側主選單不會因閱讀程式碼而自動收合，可用頁面左上角按鈕手動收合為圖示列，選擇會保留。閱讀區提供統一／並排 diff、12–20px 字級、專注模式、可收合的檔案清單與解說面板；解說面板寬度可拖曳，或以左右方向鍵調整。點選行、按住 Shift 選多行，可在「追問 Agent」深入討論；自動解說與真實問答都會使用 Codex 用量。「審查者怎麼看」頁籤完整呈現 Lead 整合摘要、Reviewer 與 Test analyst 的靜態審查報告，並標示每份報告提到目前檔案的段落數；追問時導師也會收到貢獻方向設定、該檔已產生的解說卡片與這兩份審查報告，所以可以直接問「這跟我的驗收條件有什麼關係」，但輸入內容會因此變長。
6. **完成 PR 草稿**：新任務完成後會自動依專案規範準備草稿。在「PR 草稿」查看規範來源、維護者偏好與待確認事項，預覽或編輯 Markdown 說明。既有任務可按「依專案規範產生建議草稿」，確認後套用並儲存。逐一勾選已審閱檔案後，按「確認並準備 PR」。
7. **明確送出**：最後的預覽視窗中按「送出 Draft PR」才會推送分支與建立 GitHub 草稿 PR。示範模式只完成體驗。

## 專案分析與 AI 建議

按 **⌘K（macOS）／Ctrl+K（Windows、Linux）** 開啟中央快速切換面板。`↑`／`↓` 選擇貢獻，`{`／`}` 切換專案（也支援 `[`／`]`），Enter 開啟，Esc 關閉並回到原本焦點。可輸入名稱或分支搜尋目前專案的貢獻；沒有貢獻的專案仍可開啟專案全貌。方向鍵只選取，不會啟動 Agent 或送出 PR。

工作台的「全貌與動機／程式碼變更／Agent 動態／PR 草稿」可用左右方向鍵與 Home／End 切換。在輸入框以外按 `?` 會開啟使用指南。Tab／Shift+Tab 移動焦點；頁首提供「跳至主要內容」。從快速切換面板開啟貢獻時，未儲存草稿仍需確認，取消或關閉面板會保留原畫面。

### 在 GitHub 尋找下一個貢獻

從左側「探索貢獻」或 Repositories 的「推薦貢獻項目」進入，設定興趣、程式語言、可接受的難度與最低星數，再按「推薦貢獻項目」。搜尋會讀取 GitHub 公開專案的資料、開放 issues、貢獻文件與部分維護者留言，再交給唯讀 Codex 分析；不需先匯入 repository。介面會顯示搜尋、核對與分析進度，可停止工作，重新進入頁面後也能接續查看。

每個項目會說明專案用途、使用者需求、貢獻規範、熱度、可行性、預估工作量、第一步與待執行的驗收方式，並附上可核對的來源和原文引用。星數與近期更新取自 GitHub；難度、時間與推薦理由是 AI 評估，不保證 maintainer 接受 PR。開放 issue 或 `good first issue` 標籤也不代表尚無人認領。開始前仍應查看 issue 最新狀態，以及 CLA、DCO、AI 協作或先討論的要求。

這是有界限的搜尋取樣，最多整理 6 個候選專案，並非 GitHub 全站排名。搜尋條件太窄、來源讀取失敗、API 限額或沒有充分證據時，會顯示空結果或限制說明，不會以預寫示範冒充即時推薦。資料與最近的推薦保存在本機；按下重新推薦才會再次查詢和使用模型。進階設定可選擇模型、思考強度與 Ponytail 模式，完成後可查看已回報的用量。

按「選擇此項目」會匯入對應專案，將需求、來源、規範與驗收方式帶入可編輯的任務設定；不會自動開始開發或送出 PR。此入口預設保留開發前計畫確認。

### 理解已匯入的專案

分析使用本機 Codex 的唯讀模式，以已匯入 repository 的本機版本為來源。會優先取 README、套件設定、架構文件與主要程式碼，最多抽樣 60 個 Git 已追蹤文字檔、總計約 240 KB，每檔最多約 18 KB；略過未追蹤檔、二進位檔、敏感路徑與疑似憑證。這些是上限，實際讀到的檔數依檔案大小而異；專案全貌頁尾會顯示本次實際讀取的檔數、約略大小（KB）與被節錄的檔數（有節錄時），重新分析前的舊結果則標示「抽樣範圍未記錄」。這是有範圍的專案導讀，不能據此判定整個專案一定缺少某個功能或測試。

新產生的推薦包含來源路徑、原文引用與推論理由；後端會確認引用確實存在於送進模型的節錄中。匹配的引用只證明來源存在，問題嚴重性、使用者影響與改善方向仍需要確認，介面的驗收清單也不是已執行的測試結果。

選定專案並完成分析後，可在「值得探索的貢獻方向」按「產出 5 個新建議」，讓 Agent 依這個專案的原始碼與已儲存的貢獻／模型設定，一次提出 5 個不同的改善方向。每次只呼叫一次模型，累積最多 30 項；剩餘額度不足 5 項時，按鈕會顯示本次可追加的數量。若來源或去重後的結果不足，會顯示實際新增與目標數量，不會為湊數虛構建議。新項目標示「本輪新增」，既有專案全貌、建議與引用保持不變；失敗時也會保留原有清單。

建議卡片可以左右滑動，或用「上一個／下一個」按鈕切換；聚焦卡片清單後，也能使用鍵盤左右鍵瀏覽。「查看本輪新增」可直接移到新建議，追加完成時不會自動打斷目前閱讀的位置。這一步只產生建議；選擇「以此方向開始」後，才進入可編輯的貢獻設定，卡片上已核對的原文引文與理由會一併帶入任務需求，並標示為待核實的參考而非執行指令。

每張卡片可隱藏，也可從「已隱藏」清單恢復顯示。拖曳卡片上的排序把手可調整順序；手機與鍵盤使用者也能使用卡片的向前／向後移動按鈕。顯示與排序設定按專案儲存在伺服器，重新整理後仍保留；儲存失敗會還原並顯示錯誤。隱藏不會刪除建議，也不會重複產生相同方向或釋出 30 項額度。追加的新建議排在最後；重新分析會移除已不存在的建議設定。示範專案的調整僅保留在目前工作台中。

追加建議與原始專案分析的模型、時間及用量分開顯示。專案版本已改變時，需先「重新分析」建立最新的全貌與建議，再追加方向；重新分析會重建清單。示範專案只使用預寫內容，需匯入真實專案才能產出更多建議。

分析結果與貢獻偏好保存在本機資料目錄。讀取快取時會比對本機 HEAD、追蹤檔案與未提交差異；版本不同會標示分析已過期，需手動重新分析。這項比較發生於載入分析資料時，不會持續監看外部檔案變動。分析不會自動 fetch 遠端，也不等同於某次任務 worktree 的最新狀態；畫面會顯示來源版本。

## Agent team 與工作目錄

### 自動變更解說

開發完成後，解說會在背景依實際 diff 整理「白話文舉例、改了什麼、為什麼改、開發觀念、審閱提醒」，產生期間仍可閱讀與審查程式碼。白話例子先交代情境與用途，再對照修改前、修改後的具體差別；測試或文件的例子會說明驗證或理解方式，不冒稱產品行為已改變。解說與檔案差異的版本一起保存；重開任務可直接閱讀，相同版本的完整解說不會重複產生，差異更新後會重新整理。開啟尚未有解說或缺少例子的舊任務也會自動補上，補齊期間仍保留原解說供閱讀。

每批最多 8 份完整 diff、100 KB，以唯讀方式處理；被阻擋或單檔超過上限的差異會標明原因。產生失敗不影響已完成的開發成果，可在該檔案解說頁重試。解說與追問分開保存，背景結果不會切換正在閱讀的頁籤。卡片和問答支援 Markdown 段落、清單、行內程式碼、程式碼區塊與表格。

### 協作方式

這是由 **Codex CLI 或 Claude Code CLI 逐回合驅動的 BELL 協作引擎**，並非 Claude Code 原生 Agent Teams。Lead 先產生 1–8 個子任務，指定各任務的檔案範圍與相依關係；排程器在依賴完成後認領任務，最多同時執行設定的 2–4 位 teammates。每位 teammate 在獨立 worktree 中取得自己的任務、依賴報告與團隊訊息，修改超出分配範圍的檔案會被拒絕整合。

應用程式將通過範圍檢查的變更整合回本次工作的 worktree，交由 Lead 唯讀檢視，再由 Reviewer 與 Test analyst 平行審查。Lead 會區分團隊回報的實測、自己的靜態檢查與未完成事項。這三份報告會在審閱畫面的「審查者怎麼看」保留全文，並標示為獨立靜態審查而非執行結果。最多有 2 個貢獻工作同時執行；執行、排隊與等待計畫確認的工作合計最多 8 個。

啟用「開發前，先讓我確認計畫」時，規劃完成後停在等待確認狀態，不會啟動實作。取消這個選項則會自動依計畫開始開發；兩種模式都會在發佈前要求人工審閱。

團隊訊息會排入收件匣，在接收者下一個工作回合開始時加入上下文；已在執行的回合不會立即中斷。每個子任務最多 3 個工作回合。未趕上成員回合的訊息會保留，供 Lead 後續整合檢視；Lead 的整合回合是唯讀的，需要改程式的追加要求可能必須另開工作。「全體成員」指當下可接收的 teammates 與 Lead；「已送達」只表示訊息已加入對應回合，不代表要求已實作。

Lead 完成規劃後，下一個回合通常在整合階段。單獨傳給 Lead 的新要求不會自動重排計畫或分送給所有實作者；若要讓尚未開始的成員收到限制，請選擇對應任務或「全體成員」，並在審閱時確認實際結果。

GitHub repository 會以該專案預設分支的最新遠端提交為起點。匯入本機 repository 時，會讀取它的 GitHub `origin`；若沒有 GitHub `origin`，則使用本機預設分支的提交，也可開發與審閱，但無法送出 GitHub PR。原工作目錄的未提交內容不會複製進新 worktree。

審閱狀態會對應畫面上檔案的版本；內容變更後需要重新整理 diff 並重新審閱。修改已確認的 PR 草稿也需要再次確認。任務資料留在本機，停止或失敗後保留工作目錄，方便查看已產生的變更。

工作用 worktree 提供 Git 工作區隔離，並不是容器或虛擬機。Agent 沿用本機 Codex 或 Claude Code CLI，請只導入你願意讓 agent 讀取與處理的專案。

PR 會以匯入時的 GitHub repository 為目標。具有寫入權限時，分支推到該專案；沒有寫入權限時，送出流程會嘗試建立或使用你個人帳號下的同名 fork，再向目標開 Draft PR。若本機 `origin` 已經指向你自己的 fork，請改匯入上游 GitHub URL，才能把上游設為 PR 目標。

發佈前會重新確認差異與審閱內容一致。若遠端預設分支已新增提交，本版本會要求從最新版本建立新工作，不會自動 rebase。遠端操作可能因權限、組織政策或網路而失敗；請以介面的錯誤訊息與 GitHub 實際分支／PR 狀態為準。

## PR 草稿與投稿規範

PR 草稿會優先採用目標專案的 `CONTRIBUTING`、PR 模板與相關投稿文件，再參考有明確原文的維護者偏好。規範從任務的基準 commit 讀取，避免 Agent 本次改動影響規範判斷；GitHub 來源提供可核對的 commit／留言連結。可展開引用原文，分辨專案文件、帳號共用規範、維護者留言與已合併 PR 範例。

本機搜尋根目錄、`.github`、`docs`、`Documentation` 內的常見貢獻／投稿文件，最多 16 份、總計 80 KB，每份節錄最多 12 KB。若專案沒有對應的指南或模板，會查詢 GitHub 帳號公開 `.github` repository 的預設文件；同類位置優先順序為 `.github`、根目錄、`docs`。另取樣最近更新的 3 個已合併 PR，各最多 5 則留言與 5 則 review，只將 `OWNER`、`MEMBER`、`COLLABORATOR` 的明確投稿要求視為偏好候選。已合併本身不表示某種格式獲維護者認可。

來源取樣、超出上限、權限或網路失敗都會顯示警示，不會把「未能讀取」當成「沒有規定」。不會自動追蹤文件中的任意外部連結；找不到適用規定時，暫採 [Linux kernel 投稿指南](https://docs.kernel.org/process/submitting-patches.html) 的 PR 寫作原則：簡潔且具體的標題、問題與使用者影響、修改理由、驗證證據及限制。這是適合 GitHub PR 的寫作備援，不會把 Linux 的郵件投稿流程或授權要求套用到其他專案。草稿預設英文，明確專案語言規定優先；規範解說與待確認事項使用繁體中文。

模型輸出必須附上可逐字對應來源的引用，並保留所選模板的 Markdown 段落標題。輸出會區分成員回報的測試與靜態分析，揭露 AI 協作；不代簽 `Signed-off-by`、不添加虛構審查背書、不自動勾選模板確認項目。DCO、CLA、AI 投稿限制等列為人工確認事項。引用檢查不等於規範遵循保證，送出前仍需閱讀來源及確認適用性；[Linux 的 AI 協作指南](https://docs.kernel.org/process/coding-assistants.html) 也將簽署責任留給人類。

新任務在開發完成後自動準備草稿與變更解說；草稿產生使用當次任務的模型與 Ponytail 設定，額外呼叫計入實際用量。產生失敗不影響已完成的程式碼。只有草稿與差異都未改動、尚未確認或送出時，自動結果才會更新新任務的草稿；網頁中尚未儲存的編輯會保留。既有任務與手動重新產生只建立建議版本，按「套用建議草稿」後仍需儲存。差異改動後建議會標示過期，無法直接套用；重新產生後才能使用。草稿生成不會推送分支、送出 PR 或更改逐檔審閱／發布確認流程。

## 模型與思考強度

「設定」頁的「設定貢獻模型」可選擇 Agent、執行模型與思考強度，這組設定由所有專案共用（存於資料目錄的 `model-settings.json`）。在「新增貢獻」或「指定貢獻方向」調整模型後按儲存，也會更新這組共用設定；方向、目標使用者等其餘欄位仍依專案保存。「探索貢獻」有自己的模型設定。模型選項來自本機 Codex 的 `model/list` 目錄，強度依各模型支援的選項顯示；這份目錄可能是快取或內建資料，不保證帳號具有每個模型的使用權限。BELL 不會修改全域 Codex 設定，指定模型執行失敗時也不會悄悄改用另一個模型。

新任務會保存當次解析的模型設定，Lead、Teammates、Reviewer、Test analyst、自動解說與追問共用；後續修改共用模型不影響既有任務。專案分析則採分析啟動時已儲存的設定，並把設定與分析結果一起保存。選擇預設時，若模型目錄可用，會固定其中的預設模型；無法讀取目錄時可沿用 CLI 預設，但名稱會明確標示未記錄。

「Agent 動態」顯示的是傳入 CLI 的模型 ID 與思考強度，不是推測的供應端實際路由。加入此功能前的舊任務沒有模型紀錄，介面會標示未記錄；示範也不會顯示虛構的執行模型。模型目錄介面參考 [Codex App Server 官方文件](https://learn.chatgpt.com/docs/app-server#list-models-modellist)。

### 改用 Claude Code

模型設定的「Agent」可改選 **Claude Code**，所有專案共用。BELL 直接呼叫本機 `claude -p`，沿用 `claude auth login` 的 Claude 訂閱登入；傳給 Agent 的環境變數不包含 `ANTHROPIC_API_KEY`，因此不會改走 API 計費。「設定」頁會顯示 Claude Code CLI 是否已安裝與登入。

- 模型清單為固定的別名 `opus`、`sonnet`、`fable`、`haiku`，各自指向該系列的最新模型；Claude Code 沒有列出模型的指令，實際可用模型依訂閱方案而定。選「Claude Code 預設」時不傳 `--model`。Haiku 不提供思考強度選項，其餘為 low–max。Claude Code 會在 `system/init` 事件回報解析後的實際模型 ID（例如別名 `haiku` 對應 `claude-haiku-4-5-20251001`）與 CLI 版本，BELL 記錄後在任務、專案分析與探索的模型摘要顯示為「傳入 → 回報」，若結果事件 `modelUsage` 出現了其他模型，會另列出本次執行呼叫過的模型；這些是 CLI 回報值，不是供應端帳單，費用欄位不會顯示。
- 專案分析與探索不開放任何工具，只讀 BELL 提供的節錄並以 `--json-schema` 回傳結構化結果；Lead、Reviewer、Test analyst 與解說只能使用 Read、Grep、Glob；Teammates 可使用 Read、Grep、Glob、Edit、Write 與 Bash。檔案編輯以 `acceptEdits` 限制在工作目錄內，但 **Bash 不在沙箱中執行**；除下列拒絕規則外，其餘 Bash 指令可存取這台機器上服務帳號能存取的任何檔案與網路。
- Teammates 的 Bash 以 `--disallowedTools` 拒絕 `git push`、`gh`、`curl`、`wget` 開頭的指令（拒絕規則優先於允許規則），推送與 PR 仍由 BELL 自己的流程處理。這是縱深防禦，不是沙箱：實測中 `git push --dry-run origin HEAD` 與 `curl https://example.com` 被 Claude Code 回絕為「Permission to use Bash with command … has been denied」，並列在結果事件的 `permission_denials`；`git status` 與 `git log` 照常執行並回傳輸出。被拒絕的工具（`system/permission_denied` 事件與結果的 `permission_denials`）會即時寫入任務日誌，讓你看得出 teammate 是因權限被拒才沒跑某個指令；這不會讓任務失敗。
- 執行時加上 `--strict-mcp-config`，不載入 claude.ai 連接器（Gmail、Drive 等）或其他 MCP 伺服器，避免 Agent 讀到不可信內容時被誘導使用你的帳號服務。
- 執行時加上 `--setting-sources user`，只載入使用者層級的設定（依 Claude Code 對 `user` 來源的定義，包含 `~/.claude/settings.json`、使用者 hooks 與 `~/.claude/CLAUDE.md`）；匯入專案裡的 `.claude/settings.json`、`.claude/settings.local.json` 與專案 `CLAUDE.md` 則不載入。`claude -p` 不會顯示信任資料夾的確認對話，BELL 又是在匯入的第三方 repository 的 worktree 中執行 Agent，因此必須由 BELL 自己關掉這些來源。實測：匯入專案 `.claude/settings.json` 中的 SessionStart hook 在加上此旗標後沒有執行（拿掉旗標則會執行），專案 `CLAUDE.md` 的內容也不再出現在模型的回應中。
- 用量以 Claude Code 回報的 tokens 計算：輸入 = 未快取輸入 + 快取寫入 + 快取讀取，快取欄位只計快取讀取。`total_cost_usd` 對訂閱帳戶沒有意義，不會顯示。訂閱有使用額度限制，多位 teammates 同時執行時較快達到上限，達到時任務會顯示 Claude Code 回報的錯誤。等待期間不再只能等逾時：Claude Code 的 `api_retry` 重試與狀態不是 `allowed` 的 `rate_limit_event`（接近或達到 5 小時／7 天視窗上限，含預計重置時間）會即時出現在任務日誌與成員卡片；實測每次 `claude -p` 執行都會送出一筆 `status: allowed` 的 `rate_limit_event`，這種正常狀態不顯示。用量另依角色（Lead、Teammates、Reviewer、Tester、PR 草稿、解說、追問）分項累計，在用量區塊展開「依角色分項」查看，同樣只列 CLI 回報的 tokens 與呼叫次數。`BELLPR_MAX_AGENT_PROCESSES`（預設 3）限制所有工作、專案分析與探索同時執行的 CLI 行程數，超過的呼叫排隊等待：工作中的 Agent 會顯示「等待其他 Agent 完成」，專案分析與探索則維持原本的進度訊息。

## Ponytail 效率規則

專案已導入 [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) **4.10.2** 的指令元件，固定於 commit `a17afe0712fc43b08f812d54391a0e5c35353b61`，保留 MIT 授權與檔案校驗資訊。根目錄 `AGENTS.md` 與 `.agents/skills/ponytail/` 提供開發 BELL 本身時的規範；背景執行則透過 BELL 的共用適配層，把規則明確加入 Lead、Teammates、審查、測試分析、程式碼追問與專案分析的 Codex 呼叫。

新增貢獻的設定中可選擇 **輕量（預設）／完整／關閉**，並儲存為該 repository 的預設。輕量模式是 BELL 對上游原則的精簡改編，優先重用現有程式、標準函式庫與原生功能；完整模式載入固定版本的上游規則。關閉可供比較，不會省略原有驗證或任務需求。已建立的任務保留當時的模式；專案分析採用當下已保存的設定，切換模式後需重新分析才會產生新樣本。

這是專案範圍的規則整合，沒有安裝使用者全域 lifecycle hooks，也不需要更改桌面插件信任設定。BELL 的背景呼叫會忽略使用者 `config.toml`，因此採明確注入，避免只安裝全域插件卻沒有套用到工作成員。規則只影響解法取捨，既有 JSON 格式、來源證據、隔離工作目錄、審核流程及使用者要求的白話教學仍保留。規則檔不會寫進貢獻對象的 worktree 或 PR。

「Agent 動態」與專案分析會顯示實際呼叫次數、已回報用量的呼叫數、輸入／輸出 tokens 與 Agent 累計時間。快取輸入已包含在輸入 tokens 中，不再加總一次；平行 Agent 的累計時間不是使用者實際等待時間。沒有回報 usage 的呼叫顯示未回報，示範和模擬 Agent 不產生虛構用量。舊任務在新版本開始量測前的用量不會補估。

Ponytail 減少的是不必要的實作與 Agent 工作；它不保證產出的程式執行更快，也不保證 Codex 用量一定下降。額外指令本身會佔用 tokens，因此不顯示推算的美元成本或未經量測的節省比例。若要比較，使用相同 repository 提交、需求、模型與驗收條件，分別執行關閉與啟用模式，並同時比較結果品質和已回報 tokens。專案分析摘要只保留最近一次成功結果的用量；失敗分析不會覆蓋先前成功快取，這些摘要也不代表帳戶帳單或全部失敗呼叫的成本。

更新方式與來源清單見 [`vendor/ponytail/README.md`](vendor/ponytail/README.md)。

## 正式建置

```sh
npm run build
npm start
```

`npm run build` 執行 TypeScript 檢查並建立前端資產。`npm test` 以 Node.js 內建的 test runner（透過 `tsx`）執行 `server/*.test.ts` 與 `src/**/*.test.ts`，新增到 `src/` 任一子目錄的 `*.test.ts` 都會被納入。測試只需要 Node.js、Git 與基本的系統工具，不會呼叫 `codex`、`claude` 或 `gh`。

前端除了 diff 解析的純函式測試與 Markdown 渲染測試外，另有 `DiffView`、`ExplanationPanel`、`TeamBoard` 與 `EfficiencySummary` 的 smoke tests：用 `react-dom/server` 的 `renderToStaticMarkup` 把示範資料渲染成 HTML，再檢查畫面文字是否存在。這些元件在模組層級匯入 `.css`，應用程式中由 Vite 處理樣式匯入，但 Node.js 不認得 `.css` 副檔名；因此 `npm test` 會先載入 `test/css-stub.mjs`，以 `node:module` 的 `register()` 將所有 `*.css` 匯入解析為空模組。這只影響測試，不影響建置。

`.github/workflows/ci.yml` 會在 push 與 pull request 時於 `ubuntu-latest`、Node.js 22 執行 `npm ci`、`npm run build` 與 `npm test`。`package.json` 的 `engines.node` 設為 `>=22`；專案沒有啟用 `engine-strict`，較舊的 Node.js 在 `npm install` 時只會收到警告而不會被阻擋，實際執行仍需要 Node.js 22 以上。本輪未加入 Prettier 或 ESLint。

建置完成後，正式模式由同一個 Node.js 服務提供網頁與 API，開啟 <http://127.0.0.1:4311>。

## Ubuntu 私網部署

`deploy/bell-pr.service` 提供 systemd 使用者服務，預設安裝於 `~/apps/bell-pr`。在 Ubuntu 使用 Node.js 22 以上、Git、GitHub CLI 與已登入的 Codex CLI 或 Claude Code CLI（服務以同一使用者執行時，會沿用 `~/.claude` 的登入）；服務的 PATH 包含 `~/.local/bin`。執行 `npm ci` 後建置，保留開發依賴，因為正式啟動仍使用 `tsx`。

```sh
cd ~/apps/bell-pr
npm ci
npm run build
npm test
mkdir -p ~/.config/bell-pr ~/.config/systemd/user
cp deploy/environment.example ~/.config/bell-pr/environment
chmod 600 ~/.config/bell-pr/environment
# 編輯環境檔：確認資料目錄、私網 origin 與自己的 Git 姓名／email
cp deploy/bell-pr.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bell-pr
```

`your-host` 的入口設定為 `https://your-host.your-tailnet.ts.net:8443`，必須連入可存取該機器的 Tailscale 私網。Node.js 只監聽 `127.0.0.1:8443`，由 Tailscale Serve 提供 HTTPS。由具備 Tailscale 管理權限的帳號執行下列命令；此設定只新增 `8443` 入口，不重設其他 Serve 服務：

```sh
tailscale serve --bg --yes --https=8443 http://127.0.0.1:8443
```

確認 `loginctl show-user "$USER" -p Linger` 為 `Linger=yes`，服務才能在未登入及重開機後啟動；尚未啟用時需請系統管理者開啟 linger。`BELLPR_ALLOWED_ORIGINS` 只是來源檢查，不提供帳號認證；存取權限由 Tailscale 裝置與網路政策控制，不要將此代理公開到網際網路。

維護可使用 `systemctl --user status bell-pr`、`systemctl --user restart bell-pr` 與 `journalctl --user -u bell-pr -n 100`。發生未預期的錯誤（API 回傳 500 的「操作未完成」）時，服務記錄會寫入請求方法、路徑與錯誤堆疊；背景工作失敗則顯示在該工作的錯誤與系統訊息中。更新前確認沒有執行中的 Agent，再停止服務、備份整份 `.bellpr`、更新程式與依賴、建置後啟動。

資料搬移必須包含完整 `.bellpr`，其中有尚未提交的檔案、Git objects/index/refs、worktree、解說與草稿。更改安裝位置時，需一併修正 `state.json` 的 repository/worktree 路徑及 Git worktree 的雙向連結，並比對檔案與 Git 差異；不能只複製 `state.json` 或重新 clone。CLI 登入狀態由目的機器提供，不隨工作資料搬移。瀏覽器示範資料與閱讀偏好保存在各網址的 localStorage，不包含在服務端備份中。

## 本機設定

不需要 `.env` 即可啟動。可設定的變數列在 [`.env.example`](.env.example)；程式只讀取程序的環境變數，不會自動載入 `.env`。若需要自訂，可在 macOS / Linux 的 shell 執行：

```sh
cp .env.example .env
# 編輯 .env 後，載入同一個 shell
set -a
source .env
set +a
npm run dev
```

| 變數                   | 預設值    | 用途                                                                       |
| ---------------------- | --------- | -------------------------------------------------------------------------- |
| `BELLPR_PORT`          | `4311`    | API 與正式模式網頁的埠。開發模式若修改，需同步 `vite.config.ts` 的 proxy。 |
| `BELLPR_FRONTEND_PORT` | `4310`    | API 允許的開發網頁來源埠。修改時需同步 `package.json` 的 `dev:web`。       |
| `BELLPR_DATA_DIR`      | `.bellpr` | 本機工作資料位置，可使用絕對路徑。                                         |
| `BELLPR_ALLOWED_ORIGINS` | 空值 | 額外允許的精確 HTTP(S) origin，以逗號分隔；僅供已有存取控制、保留 Host 的私網代理使用。 |
| `BELLPR_MAX_AGENT_PROCESSES` | `3` | 同時執行的 Agent CLI 行程上限（1–32），涵蓋所有工作、專案分析與探索；超過時後續 Agent 排隊等待。 |

`.bellpr` 與 `.env` 已排除於 Git 追蹤外。請妥善保留工作資料；刪除資料目錄會移除其中的 repository、工作目錄與紀錄。

## 使用範圍

這是設計給單一使用者操作的 local-first 工具。請透過 `127.0.0.1` 或上述具備存取控制的私網代理使用，不要直接公開 API 至網際網路或作為多人服務部署。工具會讀寫服務所在機器的專案，並使用該使用者的 CLI 登入狀態。

目前版本以 GitHub 為目標平台。程式碼與 PR 內容仍需要使用者審閱；白話解說與 agent 的判斷可能出錯。Lead、Reviewer 與 Test analyst 的整合／審查回合只做靜態檢視，真正執行過的檢查應以各 teammate 報告的命令與結果為準。

服務重新啟動後，中斷的工作會標記失敗，需另開新工作；目前沒有自動恢復、合併 PR 或清理 worktree 的介面。檔案問答的近期上下文保存在服務記憶體中，重新載入網頁或切換工作會清除畫面上的問答紀錄。學習筆記頁目前為示範內容。

審閱介面適合聚焦的文字程式碼變更：單次最多 150 個檔案、整體 diff 最多 2 MB，新檔案最多 512 KB。二進位檔、新增符號連結、敏感檔案與疑似憑證會阻擋發佈，需要先移除或改以人工流程處理。這些檢查不代表完整的秘密資訊掃描。

## 實作參考

Agent 執行使用 [Codex 非互動模式](https://learn.chatgpt.com/docs/non-interactive-mode)，沿用 read-only / workspace-write 沙箱與 JSONL 事件；選擇 Claude Code 時使用 [Claude Code 非互動模式](https://code.claude.com/docs/en/headless) 的 `stream-json` 事件。前端開發服務使用 [Vite proxy](https://vite.dev/config/server-options#server-proxy) 將同源 `/api` 請求轉送至本機後端。
