/** The review panel's v1.2 strings (Traditional Chinese, Taiwan); see ../en.ts. */
import type { Translation } from "../../../../shared/i18n/locale";
import { product } from "../../../../shared/product";
import type en from "../en";

const messages: Translation<typeof en> = {
  reader: {
    title: "讀者會怎麼看你的改動",
    intro: "AI 對你在這個檔案的改動所寫的解說與程式碼解說，拿來對照你原本的想法。最多會用掉兩次 Agent 回合。",
    show: "看看讀者怎麼看",
    answerFirst: "請先在「用自己的話講一遍」回答這個檔案的問題，讓你自己的答案走在 AI 的解讀之前。",
    answerAll: "這個檔案沒有自己的問題：請先在「用自己的話講一遍」回答其中的問題。",
  },
  guide: "嚮導",
  checkYourself: "考考自己",
  walkthroughFull: `這個檔案的程式碼解說作答已達 ${product.name} 保留的上限，這一題不會存下。`,
};

export default messages;
