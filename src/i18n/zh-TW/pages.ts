/** The discovery, learning and agent team pages (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { providerLabels } from "../../../shared/models";
import type en from "../en/pages";

const m: Translation<typeof en> = {
  discovery: {
    loading: "正在載入貢獻探索…",
  },
  learning: {
    noteTitle: "你的下一個問題，就是下一個進步。",
    noteText:
      "在工作台選取程式碼並提問。對話依檔案保留於目前工作階段，讓每個問題都有上下文。",
  },
  team: {
    eyebrow: "為協作而生",
    title: "一個目標，一支 Agent team。",
    intro: "從拆解問題到交叉審查，讓專業分工融入你的開發流程。",
    assign: "指派新任務",
    roles: {
      lead: {
        name: "Team lead",
        role: "共享計畫與相依拆解",
        text: "依貢獻方向建立任務板，明確指定檔案範圍與相依，讓你先確認計畫。",
        scope: "規劃 · 指派 · 整合",
      },
      teammates: {
        name: "Teammates",
        role: "獨立上下文與並行開發",
        text: "每位成員有獨立工作目錄；先完成相依任務，互不衝突的工作可同時執行。",
        scope: "免費方案 2 位，Pro 最多 4 位 · 共享任務板",
      },
      inbox: {
        name: "Team inbox",
        role: "成員之間能交換發現",
        text: "傳送給 Lead、任務成員或全體；訊息在下一個工作回合送達，可追蹤送達狀態。",
        scope: "共享訊息 · 保留記錄",
      },
      review: {
        name: "Review & tests",
        role: "整合後的獨立審查",
        text: "受檔案範圍約束的變更依序整合，再由獨立審查者與測試分析員檢查結果。",
        scope: "品質檢查 · 人工送出",
      },
    },
    noteTitle: "Agent 負責開發，你保有最後決定權。",
    noteText: `使用本機 ${providerLabels.codex} 或 ${providerLabels.claude} CLI 登入狀態。每個任務有獨立分支，完成後進入審查，不會自動建立 PR。`,
  },
};

export default m;
