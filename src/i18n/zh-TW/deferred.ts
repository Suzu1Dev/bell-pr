/**
 * The client namespaces that only lazily loaded views use (Traditional
 * Chinese, Taiwan), typed against the English ones. The app loads them the
 * first time such a view renders in zh-TW (src/i18n/index.tsx).
 */
import type { Translation } from "../../../shared/i18n/locale";
import type en from "../en/deferred";
import about from "./about";
import discovery from "./discovery";
import efficiency from "./efficiency";
import learning from "./learning";
import legal from "./legal";
import models from "./models";
import onboarding from "./onboarding";
import settings from "./settings";

const messages: Translation<typeof en> = {
  settings,
  discovery,
  learning,
  efficiency,
  models,
  onboarding,
  about,
  legal,
};

export default messages;
