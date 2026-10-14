import { product } from "../../../shared/product.js";

/** Storage, cleanup and recovery messages. */
export default {
  /** The data directory and state.json. */
  store: {
    dataDirOwner: ({ path }: { path: string }) =>
      `The data directory ${path} belongs to another user. Start ${product.name} as that user, or choose a data directory you own with --data-dir.`,
  },
  /** What a restart explains on the runs it interrupted. */
  recovery: {
    publishingInterrupted:
      "Publishing was interrupted. Check GitHub, then publish again.",
    /** A run log line when a queued run starts again after a restart. */
    resumed: "The service restarted; this queued run starts again.",
    /** A retry of a run that has no plan yet. */
    retryPlanning: "Retrying the run: the lead plans the task again.",
  },
};
