/** The review surface (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/review";

const m: Translation<typeof en> = {
  diff: {
    regionLabel: ({ path }) => `${path} 的程式碼差異`,
    lineLabel: {
      added: ({ line, text }) => `新增，第 ${line} 行：${text}`,
      removed: ({ line, text }) => `刪除，第 ${line} 行：${text}`,
      context: ({ line, text }) => `未變更，第 ${line} 行：${text}`,
    },
    blankLine: "空白行",
    lineTitle: "點選行以追問，按住 Shift 可選取多行",
    noteHint: "還沒寫下你的理解",
    reviewed: "已審閱",
    blockedTitle: "這個檔案目前無法審閱",
    noTextTitle: "這個檔案沒有可顯示的文字差異",
    noTextBody: "二進位檔案或沒有文字變更的檔案，無法逐行呈現。",
    before: "變更前",
    after: "變更後",
    selectedLines: ({ count }) => `已選取 ${count} 行`,
    idleHint: "點選任何一行，讓 Agent 為你解說",
    shiftKey: "Shift",
    shiftHint: ({ key }) => `${key} 可多行選取`,
    clearSelection: "清除選取",
    askSelection: "解說這段程式碼",
  },
  selection: {
    question: ({ path, count }) =>
      `請用白話解釋 ${path} 中選取的 ${count} 行程式碼，說明它們的用途、變更原因與需要注意的地方。`,
    addedLine: ({ newLine, text }) => `新增 新 L${newLine}: ${text}`,
    removedLine: ({ oldLine, text }) => `刪除 舊 L${oldLine}: ${text}`,
    contextLine: ({ oldLine, newLine, text }) =>
      `原有 舊 L${oldLine}／新 L${newLine}: ${text}`,
    truncated:
      "[內容已節錄] 選取範圍較長，下方僅附部分內容，請優先解釋這段節錄。",
  },
};

export default m;
