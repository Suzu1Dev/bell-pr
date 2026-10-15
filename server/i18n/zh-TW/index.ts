import type { Translation } from "../../../shared/i18n/locale.js";
import type en from "../en/index.js";
import analysis from "./analysis.js";
import cli from "./cli.js";
import common from "./common.js";
import contribution from "./contribution.js";
import license from "./license.js";
import run from "./run.js";
import security from "./security.js";
import setup from "./setup.js";
import storage from "./storage.js";
import understanding from "./understanding.js";

const m: Translation<typeof en> = {
  common,
  run,
  analysis,
  setup,
  license,
  storage,
  security,
  cli,
  understanding,
  contribution,
};
export default m;
