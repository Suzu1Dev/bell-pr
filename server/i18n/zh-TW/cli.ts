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
      `  start      啟動 ${name}（預設指令）`,
      "  open       印出執行中伺服器的位址，並在瀏覽器開啟",
      "  doctor     檢查 git、gh 與 Agent CLI（加 --json 輸出機器可讀格式）",
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
      "  --print             只印出位址",
      "  --no-open           不開啟瀏覽器",
      `  --data-dir <目錄>   執行中 ${name} 的資料目錄`,
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
  },
  open: {
    notRunning: ({ dataDir }) =>
      `沒有使用資料目錄 ${dataDir} 的 ${name} 在執行。請用 \`${bin}\` 啟動；若 ${name} 用其他資料目錄啟動，請執行 \`${bin} open --data-dir <dir>\`。`,
  },
};
export default m;
