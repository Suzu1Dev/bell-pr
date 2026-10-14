/**
 * Every client namespace (English). The English dictionary defines the
 * message types; zh-TW is checked against it. Namespaces are registered here
 * once, so later work only fills the namespace files.
 */
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

const messages = {
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
