import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/cli.js";

const name = product.name;
const bin = product.binNames[0];

const m: Translation<typeof en> = {
  help: ({ version }) =>
    [
      `${name} ${version}：在本機參與開源貢獻的工作台。`,
      "",
      `用法：${bin} [指令] [選項]`,
      "",
      "指令：",
      `  start      啟動 ${name}，或開啟執行中的工作區（預設指令）`,
      "  open       印出執行中伺服器的位址，並在瀏覽器開啟",
      "  doctor     檢查 git、gh 與 Agent CLI（加 --json 輸出機器可讀格式）",
      "  token      更換 API 權杖，並登出已配對的裝置（`token rotate`）",
      "  pair       產生一次性配對碼，讓手機或另一台電腦配對",
      "  devices    列出已配對裝置（`devices list`）或撤銷其中一台（`devices revoke <id>`）",
      "  version    顯示版本、Node.js、平台與資料目錄",
      "  help       顯示這份說明",
      "",
      "start 的選項：",
      "  --port <埠>         監聽的埠（BELLPR_PORT，預設 4311）",
      "  --host <主機>       監聽的位址（BELLPR_HOST，預設 127.0.0.1）",
      "  --data-dir <目錄>   資料目錄（BELLPR_DATA_DIR，預設 ~/.bellpr）",
      "  --no-open           不開啟瀏覽器（BELLPR_NO_OPEN=1）",
      "  --force             即使 doctor 尚未就緒也啟動",
      "  --env-file <檔案>   先從檔案載入 BELLPR_PORT 等設定",
      "",
      "open 的選項：",
      "  --print             只印出位址，不含 API 權杖",
      "  --print-token       印出含 API 權杖的位址",
      "  --no-open           不開啟瀏覽器",
      `  --data-dir <目錄>   執行中 ${name} 的資料目錄`,
      "",
      "pair 的選項：",
      "  --name <名稱>       新裝置的建議名稱",
      "  --no-qr             不顯示 QR 碼",
      "  --unlock            解除配對鎖定並清除失敗次數",
      "",
      `忘了位址？在這台電腦執行 \`${bin} open\`，即可再次印出並開啟。`,
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
      `BELLPR_PUBLIC_URL 必須是瀏覽器連到 ${name} 的位址，例如 https://bell.example.com：使用 http 或 https，不含路徑、查詢字串或使用者名稱；這台電腦以外的位址必須使用 https。「${value}」不符合。`,
    devNeedsLoopback: ({ host }) =>
      `開發模式只能在這台電腦上監聽。請改用 --host 127.0.0.1，不要使用 ${host}。`,
    publicUrlRequired: ({ host }) =>
      `要在 ${host} 監聽，請把 BELLPR_PUBLIC_URL 設為瀏覽器連到 ${name} 的 HTTPS 位址，例如反向代理後的 https://bell.example.com；沒有設定時，所有請求都會被拒絕。若只在這台電腦上使用 ${name}，請讓 --host 保持 127.0.0.1。`,
    limitRange: ({ name, min, max }) => `${name} 必須介於 ${min} 到 ${max} 之間。`,
  },
  start: {
    startup: ({ version, url }) => `${name} ${version} → ${url}`,
    reusing: ({ url }) => `${name} 執行中 → ${url}`,
    openLink: ({ url }) => `在瀏覽器開啟工作區：${url}`,
    legacyDataDir: ({ dataDir }) =>
      `在 ./.bellpr 找到 ${name} 資料。${name} 現在使用 ${dataDir}，沒有搬移任何資料。若要繼續使用舊資料夾，請以此方式啟動：${bin} start --data-dir ./.bellpr`,
    alreadyRunning: ({ url }) =>
      `${name} 已在 ${url} 執行。執行 \`${bin} open\` 即可開啟；若那個 ${name} 用其他資料目錄啟動，請加上 --data-dir <dir>。`,
    portInUse: ({ port }) =>
      `埠 ${port} 已被其他程式使用。請用 \`${bin} start --port <埠>\` 在可用的埠啟動 ${name}。`,
    dataDirInUse: ({ dataDir, pid }) =>
      `${name} 已使用資料目錄 ${dataDir} 執行中（行程 ${pid}）。執行 \`${bin} open\` 即可開啟，或先停止該行程。`,
    listenFailed: ({ address, reason }) =>
      `${name} 無法在 ${address} 監聽：${reason}`,
    failed: ({ reason }) => `${name} 未能啟動：${reason}`,
    forced: `警告：--force 略過就緒檢查，仍會啟動 ${name}。執行 \`${bin} doctor\` 可查看缺少的項目。範例導覽不需要 AI 服務；真實的 Agent 工作仍然需要。`,
    notReady: `${name} 沒有啟動。上方清單列出每一項失敗的必要檢查與修正指令。若仍要啟動並走範例導覽，請執行 \`${bin} start --force\`。`,
    sampleTour: `還沒有 AI 服務？先看範例導覽：${bin} start --force`,
    uiMissing: ({ path }) =>
      `網頁介面尚未建置：${path} 中沒有 index.html。請在 ${name} 原始碼資料夾執行 \`npm run build\` 後重新啟動；在此之前只有 API 可用。`,
    uiMissingTitle: `${name}：網頁介面尚未建置`,
    uiMissingPage:
      `${name} 的網頁介面尚未建置。請在 ${name} 原始碼資料夾執行 npm run build，再重新啟動 ${name}。`,
    exposedHost: ({ host }) =>
      `${name} 正在 ${host} 上監聽，而非只在 127.0.0.1。這是 --host 或 BELLPR_HOST 明確指定的位址。API 權杖仍然必要。`,
  },
  open: {
    notRunning: ({ dataDir }) =>
      `沒有使用資料目錄 ${dataDir} 的 ${name} 在執行。請用 \`${bin}\` 啟動；若 ${name} 用其他資料目錄啟動，請執行 \`${bin} open --data-dir <dir>\`。`,
  },
  token: {
    rotated: ({ path }) =>
      `已更換 ${path} 的 API 權杖。執行中的 ${name} 會在下一個請求使用新權杖。執行 \`${bin} open\` 即可用它開啟。`,
    usage: `執行 \`${bin} token rotate\` 以更換 API 權杖。`,
    devicesCleared: "已配對的裝置都已登出，配對碼也已作廢。請用新的配對碼重新配對。",
  },
  pair: {
    created: ({ pairUrl, code, expiresAt }) =>
      [
        `在另一台裝置開啟 ${pairUrl}`,
        `並輸入配對碼：${code}`,
        `配對碼只能用一次，於 ${expiresAt} 失效（5 分鐘後）。產生新碼會取代它。`,
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
    revoked: ({ id }) => `已撤銷 ${id}，它的權杖不再有效。`,
    notFound: ({ id }) => `沒有 id 為 ${id} 的已配對裝置。執行 \`${bin} devices list\` 查看。`,
  },
  requestFailed: ({ status, error }) => `${name} 回應 ${status}：${error}`,
};
export default m;
