import type { Translation } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";
import type en from "../en/by-hand-flow.js";

const flow: Translation<typeof en> = {
  yourTurn: "換你寫：動手改程式吧。",
  stepFirst: "請先寫下至少一個你自己計畫的步驟。",
  reviseRefused: "在親手學裡，計畫是你的：改寫你的步驟，或請嚮導「看看我的計畫」。",
  draftRefused: `在親手學裡，Pull Request 的文字由你來寫；${product.name} 不會替你起草。`,
  changed: "你打開這裡之後，變更又更新了。請再看一次，然後標成可以審查了。",
};

export default flow;
