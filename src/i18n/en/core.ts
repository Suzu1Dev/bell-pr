/**
 * The client namespaces the startup chunk uses (English): the shell, home,
 * projects, the workspace with its review and draft, and the dialogs it
 * opens. English is bundled with the app; other locales load theirs on
 * demand. The namespaces that only lazily loaded views use are in
 * deferred.ts.
 */
import app from "./app";
import common from "./common";
import draft from "./draft";
import home from "./home";
import license from "./license";
import mission from "./mission";
import modals from "./modals";
import pages from "./pages";
import repos from "./repos";
import review from "./review";
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
  mission,
  review,
  team,
  draft,
  setup,
  license,
  home,
};

export default messages;
