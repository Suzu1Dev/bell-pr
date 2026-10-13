// Run and file status labels shared by the shell, the workspace and the runs list.
import type { Run } from "../types";

export const statusLabels: Record<Run["status"], string> = {
  queued: "等待執行",
  awaiting_plan: "等待確認計畫",
  running: "開發中",
  review: "等待你的審查",
  approved: "已確認",
  published: "已送出 PR",
  failed: "執行失敗",
  cancelled: "已停止",
};
export const fileStatusLabels: Record<string, { badge: string; title: string }> = {
  added: { badge: "A", title: "新增檔案" },
  modified: { badge: "M", title: "已修改" },
  deleted: { badge: "D", title: "已刪除" },
};
export const fileStatusLabel = (status: string) =>
  fileStatusLabels[status] ?? fileStatusLabels.modified;
