/**
 * Every client namespace (Traditional Chinese, Taiwan), typed against the
 * English dictionary. The app loads this module on demand through
 * `loadLocale("zh-TW")`.
 */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en";
import about from "./about";
import app from "./app";
import common from "./common";
import discovery from "./discovery";
import draft from "./draft";
import efficiency from "./efficiency";
import home from "./home";
import learning from "./learning";
import legal from "./legal";
import license from "./license";
import mission from "./mission";
import modals from "./modals";
import models from "./models";
import onboarding from "./onboarding";
import pages from "./pages";
import repos from "./repos";
import review from "./review";
import settings from "./settings";
import setup from "./setup";
import team from "./team";
import workspace from "./workspace";

const messages: Translation<typeof en> = {
  common,
  app,
  workspace,
  repos,
  pages,
  modals,
  settings,
  mission,
  review,
  team,
  draft,
  discovery,
  learning,
  efficiency,
  models,
  setup,
  onboarding,
  license,
  home,
  about,
  legal,
};

export default messages;
