/** The discovery and agent team pages (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { providerLabels } from "../../../shared/models";
import type en from "../en/pages";

const m: Translation<typeof en> = {
  discovery: {
    loading: "正在載入貢獻探索…",
  },
  team: {
    title: "AI 團隊如何分工",
    intro: "從拆解問題到交叉審查，讓專業分工融入你的開發流程。",
    assign: "指派新任務",
    roles: {
      lead: {
        name: "Team lead",
        role: "共享計畫與相依拆解",
        text: "依貢獻方向建立任務板，明確指定檔案範圍與相依，讓你先核准計畫。",
        scope: "規劃 · 指派 · 整合",
      },
      teammates: {
        name: "Teammates",
        role: "獨立上下文與並行開發",
        text: "每位隊友有獨立工作目錄；先完成相依任務，互不衝突的工作可同時執行。",
        scope: "2 至 4 位隊友 · 共享任務板",
      },
      inbox: {
        name: "Team inbox",
        role: "隊友之間能交換發現",
        text: "傳送給 Lead、某個任務的隊友或全體；訊息在下一個工作回合送達，可追蹤送達狀態。",
        scope: "共享訊息 · 保留記錄",
      },
      review: {
        name: "Review & tests",
        role: "整合後的獨立審查",
        text: "受檔案範圍約束的變更依序整合，再由獨立的 Reviewer 與 Test analyst 檢查結果。",
        scope: "品質檢查 · 人工送出",
      },
    },
    noteTitle: "Agent 負責開發，你保有最後決定權。",
    noteText: `使用本機 ${providerLabels.codex}、${providerLabels.claude} 或 ${providerLabels.antigravity} CLI 登入狀態。每個任務有獨立分支，完成後進入審查，不會自動建立 PR。`,
  },
};

export default m;
