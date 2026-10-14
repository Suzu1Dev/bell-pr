import { formatters, intlLocale } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";

const fmt = formatters("en");

/** A disk size such as "12.3 MB"; anything under 1 kB still shows as kB. */
const size = (bytes: number) => {
  const units = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(intlLocale("en"), {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
};

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
    resumed: "The service restarted; this run is queued again.",
    /** A retry of a run that has no plan yet. */
    retryPlanning: "Retrying the run: the lead plans the task again.",
  },
  /** A run's working files on disk. */
  workspace: {
    removed:
      "Files for this run were cleaned up to free disk space. Reports and notes are kept.",
    /** Syncing a published PR or starting a follow-up round after the files were removed. */
    removedPublished:
      "Files for this run were cleaned up to free disk space, so its pull request can no longer be synced or given a follow-up round here. Reports and notes are kept. Update the pull request's branch on GitHub directly; to keep files longer, raise BELLPR_RETENTION_DAYS.",
    /** A run log line after the person freed the space. */
    removedLog: ({ bytes }: { bytes: number }) =>
      `Removed this run's working files and freed ${size(bytes)}; reports, notes and explanations are kept.`,
    /** A run log line after the retention period removed them. */
    retentionLog: ({ bytes, days }: { bytes: number; days: number }) =>
      `Removed this run's working files ${fmt.number(days)} ${fmt.plural(days) === "one" ? "day" : "days"} after it ended and freed ${size(bytes)}; reports, notes and explanations are kept.`,
    busy: "This run is still working. Stop it or wait until it finishes, then try again.",
    outsideData:
      `This run's working directory is outside ${product.name}'s data directory, so it is left as it is.`,
  },
  repos: {
    busy: "A run of this project is still working. Stop it or wait until it finishes, then delete the project.",
  },
  erase: {
    confirm: "Type ERASE to confirm that all data should be deleted.",
    busy: "Work is still running. Stop every run and the discovery search first, then delete all data.",
  },
  learning: {
    invalidCursor: "This page of learning notes is out of date; reload the list.",
  },
};
