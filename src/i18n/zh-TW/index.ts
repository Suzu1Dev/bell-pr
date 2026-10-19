/**
 * Every client namespace (Traditional Chinese, Taiwan), typed against the
 * English dictionary. The app loads core.ts through `loadLocale("zh-TW")`
 * and deferred.ts with the first lazily loaded view that needs it.
 */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en";
import core from "./core";
import deferred from "./deferred";

const messages: Translation<typeof en> = { ...core, ...deferred };

export default messages;
