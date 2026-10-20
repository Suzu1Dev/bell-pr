/**
 * The client namespaces the startup chunk uses (Traditional Chinese,
 * Taiwan), typed against the English ones. The app loads them on demand
 * through `loadLocale("zh-TW")`.
 */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/core";
import app from "./app";
import common from "./common";
import draft from "./draft";
import home from "./home";
import mission from "./mission";
import modals from "./modals";
import pages from "./pages";
import repos from "./repos";
import review from "./review";
import setup from "./setup";
import workspace from "./workspace";

const messages: Translation<typeof en> = {
  common,
  app,
  workspace,
  repos,
  pages,
  modals,
  mission,
  review,
  draft,
  setup,
  home,
};

export default messages;
