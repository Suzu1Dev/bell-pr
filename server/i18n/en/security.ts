import { formatters } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";

const fmt = formatters("en");
/** Keys, files and similar items, separated as the locale separates a plain list. */
const list = (items: readonly string[]) => fmt.list(items, { type: "unit" });

/** Sign-in, session and sandbox messages, and Git safety refusals. */
export default {
  /** A repository whose own Git configuration could run commands (409). */
  gitConfigUnsafe: ({ keys }: { keys: string[] }) =>
    `This repository's Git configuration sets ${list(keys)}, which can make Git run other programs or send credentials elsewhere. ${product.name} does not run Git in it. Remove these settings from its .git/config, or import the project again.`,
  /** A teammate checkout whose .git file points somewhere else (409). */
  worktreeForged:
    "A teammate's checkout no longer points to this run's Git repository, so it is not used. Retry the task to give it a fresh checkout.",
  /** A recorded GitHub repository or branch name that is not valid (409). */
  invalidRemote:
    "The GitHub repository or branch recorded for this run is not a valid name, so nothing was fetched or pushed.",
};
