/** Labels that several parts of the UI share (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/common";

const m: Translation<typeof en> = {
  pair: {
    title: "配對此裝置",
    explainer: "請在主機電腦執行 bell-pr pair，再於此輸入配對碼。",
    remoteHint: "透過 VPN 或 Tailscale 遠端連線？請開啟此頁面配對瀏覽器，或使用你的團隊帳號登入。",
    code: "配對碼",
    name: "裝置名稱（選填）",
    submit: "配對裝置",
    pairing: "配對中…",
    invalid: "配對碼無效或已過期。請執行 bell-pr pair 取得新的配對碼。",
    locked: "配對暫時鎖定。",
    remaining: ({ seconds }) => `請於 ${seconds} 秒後再試。`,
    rateLimited: "嘗試次數過多，請稍後再試。",
    failed: "無法配對或儲存此裝置。請檢查瀏覽器儲存空間後再試。",
    open: "配對或團隊登入",
    modes: {
      label: "登入與配對方式",
      device: "裝置配對",
      login: "團隊帳號",
      register: "邀請碼註冊",
      tailscale: "Tailscale",
    },
    team: {
      loginExplainer: `透過 VPN 或 Tailscale，使用你的 ${product.name} 團隊帳號登入。`,
      registerExplainer: "輸入管理員提供的邀請碼，並設定你自己的帳號名稱與密碼。",
      tailscaleExplainer: "使用主機本機 Tailscale 代理所驗證的 Tailscale 身分直接登入。",
      tailscaleDetected: ({ login }) => `偵測到 Tailscale 身分：${login}`,
      username: "帳號名稱",
      usernameHint: "3–32 字元：小寫英數、.、_ 或 -",
      password: "密碼",
      passwordHint: "至少 8 個字元",
      inviteCode: "小組邀請碼",
      inviteCodeOptional: "小組邀請碼（僅首次綁定時填寫）",
      signIn: "登入",
      signingIn: "登入中…",
      registerSubmit: "建立帳號並加入",
      registering: "建立帳號中…",
      tailscaleSubmit: "以 Tailscale 登入",
    },
  },
  runStatus: {
    queued: "等待執行",
    awaiting_plan: "等待核准計畫",
    running: "進行中",
    review: "等待你的審閱",
    approved: "已核准",
    published: "已發布 PR",
    failed: "執行失敗",
    cancelled: "已停止",
  },
  fileStatus: {
    added: { badge: "A", title: "新增檔案" },
    modified: { badge: "M", title: "已修改" },
    deleted: { badge: "D", title: "已刪除" },
  },
  reasoningEffort: {
    none: "不啟用",
    minimal: "最低",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "很高",
    max: "最高",
    ultra: "極高",
  },
  reasoningEffortWithId: ({ effort }) =>
    `${m.reasoningEffort[effort]} · ${effort}`,
  teamTaskStatus: {
    pending: "等待前置子任務",
    ready: "可開始",
    running: "進行中",
    complete: "已整合",
    failed: "失敗",
    blocked: "受阻",
  },
  actions: {
    cancel: "取消",
    save: "儲存",
    close: "關閉",
    copy: "複製",
    retry: "重試",
  },
  optional: "選填",
  language: { label: "語言" },
  languageNames: {
    en: "English",
    "zh-TW": "繁體中文",
  },
  errors: {
    serverUnreachable: `無法連線至本機 ${product.name} 服務，請確認它仍在執行。`,
    generic: "操作未完成，請再試一次。",
    apiTokenRequired: `請在執行 ${product.name} 的電腦上執行 \`${product.binNames[0]}\`，重新開啟你的工作空間。`,
  },
  failureText: {
    label: ({ label, fullWidth }) => (fullWidth ? `${label}。` : `${label}.`),
    fallback: "執行失敗。",
    showRaw: ({ count }) => `查看原始輸出（${count} 字）`,
    hideRaw: "收起原始輸出",
  },
};

export default m;
