/** Labels that several parts of the UI share (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/common";

const m: Translation<typeof en> = {
  runStatus: {
    queued: "等待執行",
    awaiting_plan: "等待確認計畫",
    running: "開發中",
    review: "等待你的審查",
    approved: "已確認",
    published: "已送出 PR",
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
    pending: "等待相依",
    ready: "可認領",
    running: "進行中",
    complete: "已整合",
    failed: "失敗",
    blocked: "已阻擋",
  },
  actions: {
    cancel: "取消",
    save: "儲存",
    close: "關閉",
    copy: "複製",
    retry: "重試",
    learnMore: "了解更多",
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
  },
  failureText: {
    label: ({ label, fullWidth }) => (fullWidth ? `${label}。` : `${label}.`),
    fallback: "執行失敗。",
    showRaw: ({ count }) => `查看原始輸出（${count} 字）`,
    hideRaw: "收起原始輸出",
  },
};

export default m;
