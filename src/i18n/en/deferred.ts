/**
 * The client namespaces that only lazily loaded views use (English):
 * Settings, discovery, the learning page, the efficiency and model
 * summaries, onboarding, About and the legal texts. The app loads them, in
 * the active locale, the first time such a view renders (`useT` in
 * src/i18n/index.tsx), so they stay out of the startup chunk.
 */
import about from "./about";
import discovery from "./discovery";
import efficiency from "./efficiency";
import learning from "./learning";
import legal from "./legal";
import models from "./models";
import onboarding from "./onboarding";
import settings from "./settings";

const messages = {
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
