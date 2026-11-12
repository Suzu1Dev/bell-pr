import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/cli.js";

const name = product.name;
const bin = product.binNames[0];

const m: Translation<typeof en> = {
  browserOpenHint: `無法開啟瀏覽器。請執行 \`${bin} open --print --print-token\` 取得位址。`,
  help: ({ version }) =>
    [
      `${name} ${version}：在本機參與開源貢獻的工作台。`,
      "",
      `用法：${bin} [指令] [選項]`,
      "",
      "指令：",
      `  start      啟動或開啟 ${name}（預設）`,
      "  open       印出並開啟執行中服務的位址",
      `  doctor     檢查 ${name} 需要的環境（--json 輸出 JSON）`,
      "  token      更換 API token 並登出已配對裝置（`token rotate`）",
      "  pair       一次性配對碼，配對另一台裝置",
      "  devices    列出或撤銷已配對裝置（`devices list`、`devices revoke <id>`）",
      "  group      小組協作：`group status`、`group setup`、`group invite <名稱>`",
      "  version    顯示版本、Node.js、平台與資料目錄",
      "  help       顯示這份說明",
      "",
      "start 選項：",
      "  --port <連接埠>     監聽連接埠（BELLPR_PORT，預設 4311）",
      "  --host <主機>       監聽位址（BELLPR_HOST，預設 127.0.0.1）",
      "  --data-dir <目錄>   資料目錄（BELLPR_DATA_DIR，預設 ~/.bellpr）",
      "  --no-open           不開啟瀏覽器（BELLPR_NO_OPEN=1）",
      "  --force             即使 doctor 判定「尚未就緒」也啟動",
      "  --group             開啟小組協作（BELLPR_GROUP=1）",
      "  --env-file <檔案>   先從檔案載入 BELLPR_* 設定",
      "",
      "open 選項：",
      "  --print             只印出位址，不含 API token",
      "  --print-token       印出含 API token 的位址",
      "  --no-open           不開啟瀏覽器",
      `  --data-dir <目錄>   執行中 ${name} 的資料目錄`,
      "",
      "pair 選項：",
      "  --name <名稱>       新裝置名稱",
      "  --no-qr             不顯示 QR 碼",
      "  --unlock            解除配對鎖定、清除失敗次數",
      "",
      "group invite 選項：",
      "  --admin             邀請為小組管理員",
    ].join("\n"),
  unknownCommand: ({ command }) =>
    `沒有「${command}」這個指令。執行 \`${bin} help\` 查看可用指令。`,
  invalidArguments: ({ reason }) =>
    `${reason}\n執行 \`${bin} help\` 查看用法。`,
  arguments: {
    unknownOption: ({ option }) => `沒有 ${option} 這個選項。`,
    missingValue: ({ option }) => `選項 ${option} 需要一個值。`,
    noValue: ({ option }) => `選項 ${option} 不接受值。`,
    unexpected: ({ value }) => `多了一個參數「${value}」。`,
  },
  envFileFailed: ({ path, reason }) => `無法載入設定檔 ${path}：${reason}`,
  version: {
    app: ({ version, buildDate }) =>
      `${name} ${version}（建置於 ${buildDate}）`,
    runtime: ({ node, platform, arch }) =>
      `Node.js ${node}，${platform} ${arch}`,
    dataDir: ({ path }) => `資料目錄：${path}`,
  },
  config: {
    portRange: ({ name, value }) =>
      `${name} 必須是 1024 到 65535 的整數，不能是「${value}」。`,
    hostInvalid: ({ value }) =>
      `--host 與 BELLPR_HOST 須為主機名稱或 IP 位址，不能是「${value}」。`,
    publicUrlInvalid: ({ value }) =>
      `BELLPR_PUBLIC_URL 必須是瀏覽器連到 ${name} 的位址，例如 https://bell.example.com：須用 https（只有這台電腦可用 http），不含路徑、查詢字串或使用者名稱。「${value}」不符合。`,
    devNeedsLoopback: ({ host }) =>
      `開發模式只能在這台電腦上監聽。請改用 --host 127.0.0.1，不要使用 ${host}。`,
    publicUrlRequired: ({ host }) =>
      `要在 ${host} 監聽，請把 BELLPR_PUBLIC_URL 設為 ${name} 對外的 HTTPS 位址，例如反向代理後的 https://bell.example.com。沒設定會拒絕所有請求。只在本機使用時，--host 維持 127.0.0.1。`,
    limitRange: ({ name, min, max }) => `${name} 必須介於 ${min} 到 ${max} 之間。`,
  },
  start: {
    startup: ({ version, url }) => `${name} ${version} → ${url}`,
    reusing: ({ url }) => `${name} 執行中 → ${url}`,
    legacyDataDir: ({ dataDir }) =>
      `${name} 現在使用 ${dataDir}，./.bellpr 的舊資料沒有搬移；要繼續使用，請執行：${bin} start --data-dir ./.bellpr`,
    alreadyRunning: ({ url }) =>
      `${name} 已在 ${url} 執行。執行 \`${bin} open\` 開啟；若它用其他資料目錄，請加 --data-dir <dir>。`,
    portInUse: ({ port }) =>
      `連接埠 ${port} 已被其他程式使用。請用 \`${bin} start --port <連接埠>\` 在可用的連接埠啟動 ${name}。`,
    dataDirInUse: ({ dataDir, pid }) =>
      `${name} 已使用資料目錄 ${dataDir} 執行中（行程 ${pid}）。執行 \`${bin} open\` 即可開啟，或先停止該行程。`,
    dataDirHolderUnconfirmed: ({ dataDir, file }) =>
      `${name} 無法確認持有資料目錄 ${dataDir} 的行程是否已停止：鎖 ${file} 來自其他容器、電腦或舊版本，或無法讀取，所以不取代。確認沒有程式使用此資料目錄後，刪除 ${file} 再重新啟動。`,
    dataDirLockUnsettled: ({ dataDir, file }) =>
      `${name} 無法取得資料目錄 ${dataDir} 的鎖 ${file}：檔案一直變動或無法讀取。請稍後重新啟動。若一再失敗且這裡沒有 ${name} 執行，請刪除 ${file}。`,
    lockUnreadable: ({ file, reason }) =>
      `${name} 無法讀取鎖 ${file}：${reason}。它可能屬於仍在執行的 ${name}，所以不取代。確認這裡沒有 ${name} 執行後，刪除 ${file} 再重新啟動。`,
    takeoverClaimed: ({ file }) =>
      `另一個 ${name} 啟動正在取代此資料目錄的舊鎖，或中途停止：接管標記檔 ${file} 還在。請半分鐘後再啟動。若一再發生且沒有 ${name} 在啟動，請刪除 ${file}。`,
    takeoverClaimUnconfirmed: ({ file }) =>
      `${name} 無法確認取代此資料目錄舊鎖的那次啟動是否已停止，所以保留接管標記檔 ${file}。確認沒有 ${name} 在此啟動後，刪除 ${file} 再重新啟動。`,
    withoutGroup: ({ url }) =>
      `${name} 已在 ${url} 執行，但沒有開啟小組協作。請先停止它，再用 \`${bin} start --group\` 啟動。`,
    listenFailed: ({ address, reason }) =>
      `${name} 無法在 ${address} 監聽：${reason}`,
    failed: ({ reason }) => `${name} 未能啟動：${reason}`,
    forced: `警告：--force 已略過就緒檢查。執行 \`${bin} doctor\` 查看缺少項目。沒有 AI 服務只能用示範導覽。`,
    notReady: `${name} 沒有啟動。上方清單列出每一項失敗的必要檢查與修正指令。`,
    sampleTour: `還沒有 AI 服務？先看示範導覽：${bin} start --force`,
    uiMissing: ({ path }) =>
      `網頁介面未建置：${path} 沒有 index.html。請在原始碼資料夾執行 \`npm run build\` 後重新啟動，建置前只有 API 可用。`,
    uiMissingTitle: `${name}：網頁介面尚未建置`,
    uiMissingPage:
      `${name} 的網頁介面尚未建置。請在 ${name} 原始碼資料夾執行 npm run build，再重新啟動 ${name}。`,
    exposedHost: ({ host }) =>
      `${name} 正在 ${host} 監聽，不只 127.0.0.1，由 --host 或 BELLPR_HOST 設定。仍需要 API token。`,
    wildcardHostNeedsPublicUrl: ({ host }) =>
      `${name} 正在 ${host} 監聽，但未設定 BELLPR_PUBLIC_URL。設為瀏覽器使用的 HTTPS 來源（例如 https://bell.example.com）前，遠端連線都會收到 HTTP 403。`,
  },
  open: {
    notRunning: ({ dataDir }) =>
      `沒有使用資料目錄 ${dataDir} 的 ${name} 在執行。請用 \`${bin}\` 啟動；其他資料目錄則執行 \`${bin} open --data-dir <dir>\`。`,
  },
  token: {
    rotated: ({ path }) =>
      `已更換 ${path} 的 API token。執行中的 ${name} 從下一個請求起使用它。用 \`${bin} open\` 開啟。`,
    usage: `執行 \`${bin} token rotate\` 以更換 API token。`,
    devicesCleared: "已配對的裝置都已登出，配對碼也已作廢。請用新的配對碼重新配對。",
  },
  pair: {
    created: ({ pairUrl, code, expiresAt }) =>
      [
        `在另一台裝置開啟 ${pairUrl}`,
        `並輸入配對碼：${code}`,
        `只能用一次，於 ${expiresAt} 失效（5 分鐘後）；新碼會取代它。`,
      ].join("\n"),
    locked: ({ lockedUntil }) => `錯誤的配對碼太多次，配對已鎖定到 ${lockedUntil}。`,
    lockedDamaged: "配對已鎖定：失敗次數的紀錄遺失或損壞。",
    unlockHint: `若失敗的嘗試是你自己造成的，請在執行 ${name} 的電腦上執行 \`${bin} pair --unlock\`。`,
    unlocked: "配對已解除鎖定，失敗次數已清除。",
    defaultDeviceName: "已配對裝置",
  },
  devices: {
    usage: `執行 \`${bin} devices list\` 或 \`${bin} devices revoke <id>\`。`,
    none: "沒有已配對的裝置。",
    line: ({ id, name, createdAt, lastUsedAt }) =>
      `${id}  ${name}  配對於 ${createdAt}  最後使用 ${lastUsedAt}`,
    neverUsed: "從未使用",
    revoked: ({ id }) => `已撤銷 ${id}，它的 token 不再有效。`,
    notFound: ({ id }) => `沒有 id 為 ${id} 的已配對裝置。執行 \`${bin} devices list\` 查看。`,
  },
  group: {
    usage: `執行 \`${bin} group status\`、\`${bin} group setup\` 或 \`${bin} group invite <名稱> [--admin]\`。`,
    notSetUp: `尚未設定小組協作。請執行 \`${bin} group setup\`。`,
    ready: "小組協作已設定完成，可以使用。",
    stopped: ({ reason }) =>
      `小組協作已停止（原因：${reason}）。請到 docs/troubleshooting.md 的「Group work has stopped」一節查這個原因，排除後再重新啟動 ${name}。`,
    setUp: `小組協作已設定完成。請用 \`${bin} group invite <名稱> --admin\` 邀請第一位管理員。`,
    alreadySetUp: "小組協作先前已設定完成。",
    invited: ({ person, admin, code, expiresAt, minutes }) =>
      [
        `給 ${person}${admin ? "（管理員）" : ""}的邀請碼：${code}`,
        `邀請碼只能用一次，於 ${expiresAt} 失效（${minutes} 分鐘後）。重新啟動 ${name} 會讓它作廢。`,
      ].join("\n"),
  },
  requestFailed: ({ status, error }) => `${name} 回應 ${status}：${error}`,
};
export default m;
