/** Legal notices the app shows (English); the documents themselves are in dist/legal. */
import { product } from "../../../shared/product";

const legal = {
  /** The non-affiliation notice (docs/brand.md); product names stay as they are. */
  trademark: `${product.name} is an independent product and is not affiliated with, endorsed by, or sponsored by GitHub, Inc., OpenAI, or Anthropic PBC. GitHub, OpenAI, Codex, Anthropic, Claude and Claude Code are trademarks of their respective owners; ${product.name} names them only to say which tools it works with.`,
  /** The credit for vendor/ponytail (MIT). */
  ponytailCredit: "Efficiency mode is based on Ponytail by DietrichGebert (MIT).",
};

export default legal;
