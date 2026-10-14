import { product } from "../../../shared/product.js";

/** Storage, cleanup and recovery messages. */
export default {
  /** The data directory and state.json. */
  store: {
    dataDirOwner: ({ path }: { path: string }) =>
      `The data directory ${path} belongs to another user. Start ${product.name} as that user, or choose a data directory you own with --data-dir.`,
  },
};
