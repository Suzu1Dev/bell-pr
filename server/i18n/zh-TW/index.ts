import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/index.js";
import analysis from "./analysis.js";
import byHand from "./by-hand.js";
import cli from "./cli.js";
import common from "./common.js";
import contribution from "./contribution.js";
import run from "./run.js";
import security from "./security.js";
import setup from "./setup.js";
import sudo from "./sudo.js";
import session from "./session.js";
import storage from "./storage.js";
import understanding from "./understanding.js";

const m: Translation<typeof en> = {
  common,
  run,
  analysis,
  setup,
  sudo,
  session,
  storage,
  security,
  cli,
  understanding,
  contribution,
  byHand,
};
export default m;
