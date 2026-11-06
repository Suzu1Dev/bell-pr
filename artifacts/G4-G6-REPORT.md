# G4 / G5-VM / G6 disposable-VM gate

時間：2026-11-06 10:36:26–10:39:05 Asia/Taipei (CST, UTC+8)  
測試對象：HEAD `224770997c8540d31048061d1557795da80c8281`，tree `02fbde5a0152bd21697beb73707064ac24a048ad`（PR #43）。  
本報告只補 box 報告未跑的 G4、G5-VM、G6。未重跑 G1–G3 / G7 / G8。未改產品原始碼，未 push tag，未 publish npm。

## 總判

| 項 | 結果 |
|---|---|
| G4 host enable | **GREEN** |
| G5-VM TTL / restart / audit | **GREEN** |
| G6 DELETE | **GREEN** |
| P0 / P1 | **none** |
| `visudo -c` while `bell-pr-agent` exists | **exit 1** — owner gid，不是語法錯誤。見下。DELETE 之後 **exit 0**。 |

package.json **1.1.0**：INFO，不是 fail。

## 無金鑰聲明

- 伺服器以 `env -i` 啟動。環境變數名稱只有 `HOME`、`LANG`、`LC_ALL`、`LOGNAME`、`NPM_CONFIG_USERCONFIG`、`PATH`、`PWD`、`SHLVL`、`TMPDIR`、`USER`。
- 沒有 `ANTHROPIC_API_KEY`、`ANTHROPIC_API_KEY_VM`、`AUTH_TOKEN`、`BASE_URL`、`GIT_CONFIG_*`、`KEY` / `TOKEN` / `SECRET` / `AUTH` 這類名稱。`NPM_CONFIG_USERCONFIG=/dev/null`。
- HOME 與 TMPDIR 是這台 VM 上的隔離目錄，不是登入者的家目錄。listener 只在 `127.0.0.1:5333`。
- 假密碼與正確密碼在 audit、stdout，以及 data dir 每個檔案的出現次數都是 **0**。host / device token 在 stdout 與 `audit/sudo.jsonl` 的出現次數都是 **0**。本報告只記長度與 SHA256。
- 測試結束已停伺服器、刪除測試帳號、刪除 `bell-pr-agent` 與測試用的 sudoers 檔。`visudo -c` exit 0。

## 綁定與跑法

開跑前與 runner 內都核對：

- `git rev-parse HEAD` = `224770997c8540d31048061d1557795da80c8281`
- `git rev-parse HEAD^{tree}` = `02fbde5a0152bd21697beb73707064ac24a048ad`

由此 checkout 執行 `npm ci` 與 `npm run build`（Node v22.23.4）。伺服器是 `bin/bellpr.mjs start --no-open --force --port 5333`。附件 harness 的 G4/G5/G6 腳本在 VM write 授權之後仍是 PENDING-VM 空殼，所以實測依 allow-rule 與 `server/sudo.ts` 對這台 VM 重做，沒有沿用 box 路徑。

這台 VM 的 `ubuntu` 是 `NOPASSWD:ALL`。產品在已經免密碼時會 409 `already_on`，不會檢查密碼。因此伺服器改以專用帳號 `bellgate` 執行：`/etc/sudoers.d/00-bellgate` 內容為 `bellgate ALL=(ALL) ALL`（要密碼，檔名排在 `bell-pr-agent` 前面，啟用中的產品規則才是最後一條 match）。`sudo -n true` 以該帳號執行的結果是 exit 1。此檔是測試夾具，不是產品寫的，結束時已刪除。`ubuntu` 的既有規則沒有改。

## /etc 存活檔：before → after

工作開始前（尚無測試夾具）與清理後相同。`bell-pr-agent` 結束時不存在。

| 檔 | SHA256 | 清理後 |
|---|---|---|
| `/etc/sudoers` | `5bac27ce5ff1a78ace8f3ef81bfd60cbd44810ac3f3d280da9d7649fe90c18f8` | 相同 |
| `/etc/sudoers.d/README` | `b428c9b673c3c806370f2aa28a98293a9cb578c70c3a8a2d1a39031861b3dbd8` | 相同 |
| `/etc/sudoers.d/ubuntu` | `1b0eff132ae8496fc12ce011a26c6692130d52b3ea39eb3d7fbd091ef23a47b4` | 相同 |
| `/etc/sudoers.d/ubuntu-no-lecture` | `33dfba40684c21e569bfd6ba90f4a2668cea82ae1446b07f60ffe00d340ad910` | 相同 |

清理後 `ls /etc/sudoers.d`：README、ubuntu、ubuntu-no-lecture。`visudo -c`（2026-11-06 10:39:05 CST）四個檔都是 `parsed OK`，exit 0。啟用當下的快照裡，這四個 SHA256 也沒有變。

## G4 — GREEN

TCP 都連 `127.0.0.1:5333`（audit `remoteAddr=127.0.0.1`）。沒有送 `X-Forwarded-*` 或 `Forwarded`。每次拒絕之後 sudoers 目錄的 SHA256 與拒絕前相同，`bell-pr-agent` 不存在。

| 案例 | 時間 (CST) | HTTP | 檔案 |
|---|---|---|---|
| 錯密碼，host token，Host `127.0.0.1:5333` | 10:36:28 | **401** | 無 |
| 空密碼 `""` | 10:36:29 | **400** | 無 |
| 缺少 password | 10:36:30 | **400** | 無 |
| device token + 正確密碼 | 10:36:30 | **403** | 無 |
| host token，Host `localhost:5333`，ttl 180 | 10:36:30 | **200** | 有，見下 |
| host token，Host `127.0.0.1:5333`，ttl 180 | 10:36:30 | **200** | 有 |
| host token，Host `[::1]:5333`，ttl 180 | 10:36:31 | **200** | 有 |

- 錯密碼 body：`Incorrect password. After 2 more incorrect attempts...`。只送一次，沒有打到 429 鎖定。audit：`enable` / `ok:false` / `reason:wrong_password` / `tokenType:host`。
- 空密碼與缺密碼的 body 是 zod：`password: Too small...` 與 `password: Invalid input: expected string, received undefined`。這兩個請求期間 `strace -f -e trace=execve` 附在伺服器上，trace 檔沒有任何 `execve` 行（沒有 sudo、沒有 visudo）。400 發生在 `sudoEnableSchema` parse，還沒進 `PasswordlessSudo.enable()`。
- device token（len 68，sha256 `633ab2deaee87ebbc52e4a3994d00d9021d8c219c1b13ddab5eed24fe1b1b35b`）即使帶正確密碼也是 403：`Passwordless sudo can be changed only in BELL PR on this computer, signed in with the install token.` audit：`denied` / `reason:device_token` / `tokenType:device`。沒有 2xx，沒有寫檔。
- host token len 64，sha256 `e46c0cad727de9c7d94a4ba53c571c23fcaf3eb370c5112ce685bb317d76405d`。
- 三次成功的回應都是 `installed:true`、`passwordless:true`。檔案 mode `0440`，owner `root`，group `bellgate`，size 167。SHA256：
  - localhost：`4eeb4b658d5ef0bee3a034df9d61da30d3bf72b99ac3a9951327a10a99259ac8`
  - 127.0.0.1：`1f28f1a5e8a3db7f225c1993f7509f8eca6b78219e37f7739a68a98b40591048`
  - [::1]：`98e1de11b8d24399e286e30116b7bcad33576492e2b2fd3b638198fa8b4804aa`
- 三個 Host 之間用 DELETE 清掉檔案再啟用下一次（各 200，清完檔案不在）。G6 是另外一次啟用後的 DELETE。

### visudo -c（不是 P0/P1）

規則還在時，`sudo visudo -c`（visudo 1.9.15p5）exit **1**：

```
/etc/sudoers: parsed OK
/etc/sudoers.d/00-bellgate: parsed OK
/etc/sudoers.d/README: parsed OK
/etc/sudoers.d/ubuntu: parsed OK
/etc/sudoers.d/ubuntu-no-lecture: parsed OK
/etc/sudoers.d/bell-pr-agent: wrong owner (uid, gid) should be (0, 0)
```

產品文件寫明檔案是 mode 0440、owner root、group 為服務帳號，讓該帳號讀得到到期行。sudo 接受了這份規則（否則啟用會 409 `overridden` 並刪檔）。其他檔仍是 `parsed OK`。這不是未授權寫入，也不是 device token 啟用。DELETE 之後的 `visudo -c` 是 exit 0。

## G5-VM — GREEN

| 步驟 | 時間 (CST) | 結果 |
|---|---|---|
| POST ttlSeconds **60** | 10:36:31 | HTTP 200。expiresAt `2026-11-06T02:37:31.045Z`。SHA256 `2f0786abcd8c07613c0736658c089b635b20ceea031f51ce77b529f2ed768c1c` |
| 伺服器繼續跑，過期後 | 10:37:32 | 檔案消失。audit `expire` `ok:true` 於 `2026-11-06T02:37:31.058Z` |
| POST ttlSeconds **90** | 10:37:32 | HTTP 200。expiresAt `2026-11-06T02:39:02.241Z`。SHA256 `1c5738c0312058d1b8dfddacbe476501c03a2c2da65923e52c19a55d24403077` |
| SIGTERM 停伺服器 | 10:37:32 | 檔案仍在，SHA256 不變 |
| 已過期但程序還沒起來 | 10:39:04 | 檔案仍在，SHA256 仍是 `1c5738c0…` |
| 同一 data dir 再啟動 | 10:39:04 | 檔案被清掉。audit `startup_cleanup` `ok:true` `reason:expired` 於 `2026-11-06T02:39:04.747Z` |

假密碼字串在 `audit/sudo.jsonl` 與伺服器 log 的次數是 0。

## G6 — GREEN

10:39:05 CST：再啟用一次，HTTP 200，檔案 SHA256 `7a887724e3ae83491121bf9b37f2cf80341ea029d96de0dea54673abbc4b0b91`。此時 `visudo -c` 仍是上面的 owner-gid exit 1。

接著 DELETE，HTTP **200**，`bell-pr-agent` 不在。`visudo -c` exit **0**，剩下的檔都是 `parsed OK`。audit：`disable` `ok:true` `tokenType:host` `remoteAddr:127.0.0.1`。

## Audit

`<dataDir>/audit/sudo.jsonl` 共 14 行，五種 event 都有：`enable`、`disable`、`expire`、`startup_cleanup`、`denied`。沒有密碼、沒有 token。

| ts (UTC) | event | ok | reason | tokenType | 重點 |
|---|---|---|---|---|---|
| 02:36:28.680Z | enable | false | wrong_password | host | G4 錯密碼 |
| 02:36:30.446Z | denied | false | device_token | device | G4 device |
| 02:36:30.596Z | enable | true | | host | Host localhost |
| 02:36:30.629Z | disable | true | | host | Host 之間重置 |
| 02:36:30.769Z | enable | true | | host | Host 127.0.0.1 |
| 02:36:30.803Z | disable | true | | host | 重置 |
| 02:36:30.976Z | enable | true | | host | Host [::1] |
| 02:36:31.014Z | disable | true | | host | 重置 |
| 02:36:31.149Z | enable | true | | host | ttl 60 |
| 02:37:31.058Z | expire | true | | | 檔案已移除 |
| 02:37:32.346Z | enable | true | | host | ttl 90 |
| 02:39:04.747Z | startup_cleanup | true | expired | | 重啟清檔 |
| 02:39:05.092Z | enable | true | | host | G6 |
| 02:39:05.130Z | disable | true | | host | G6 DELETE |

空密碼與缺密碼沒有 audit 行（schema 在寫 audit 之前就 400）。

## 清理

2026-11-06 10:39:05 CST：伺服器已停，`bell-pr-agent` 與 `00-bellgate` 已刪，測試帳號已刪。存活檔 SHA256 與工作前一致。`visudo -c` exit 0。沒有 bell-pr listener。
