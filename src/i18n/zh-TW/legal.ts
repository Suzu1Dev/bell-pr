/** Legal notices the app shows (Traditional Chinese, Taiwan). */
import type { Translation } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type en from "../en/legal";

const m: Translation<typeof en> = {
  trademark: `${product.name} 是獨立產品，與 GitHub, Inc.、OpenAI 及 Anthropic PBC 皆無關聯，也未獲其認可或贊助。GitHub、OpenAI、Codex、Anthropic、Claude 與 Claude Code 均為其各自擁有者的商標；${product.name} 提及這些名稱，僅為說明可搭配使用的工具。`,
  ponytailCredit: "效率模式以 DietrichGebert 的 Ponytail（MIT 授權）為基礎。",
};

export default m;
