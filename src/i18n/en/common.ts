/**
 * Labels that several parts of the UI share (English). Components read them
 * through `useT("common")` instead of importing each other's label maps.
 */
import type { Locale } from "../../../shared/i18n/locale";
import type { ReasoningEffort } from "../../../shared/models";
import { product } from "../../../shared/product";
import type { TeamTaskStatus } from "../../../shared/team";
import type { RunStatus } from "../../../shared/types";

const common = {
  runStatus: {
    queued: "Queued",
    awaiting_plan: "Awaiting plan approval",
    running: "In progress",
    review: "Ready for your review",
    approved: "Approved",
    published: "PR published",
    failed: "Failed",
    cancelled: "Stopped",
  } satisfies Record<RunStatus, string>,
  /** Per diff file status: `badge` is Git's status letter, `title` its tooltip. */
  fileStatus: {
    added: { badge: "A", title: "New file" },
    modified: { badge: "M", title: "Modified" },
    deleted: { badge: "D", title: "Deleted" },
  },
  reasoningEffort: {
    none: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Max",
    ultra: "Ultra",
  } satisfies Record<ReasoningEffort, string>,
  /**
   * An effort as the effort picker and the model summaries list it: the
   * label, then the CLI's own id where the label does not already read as it.
   */
  reasoningEffortWithId: ({ effort }: { effort: ReasoningEffort }): string => {
    const label = common.reasoningEffort[effort];
    return label.toLowerCase() === effort ? label : `${label} · ${effort}`;
  },
  teamTaskStatus: {
    pending: "Waiting on dependencies",
    ready: "Ready to claim",
    running: "In progress",
    complete: "Integrated",
    failed: "Failed",
    blocked: "Blocked",
  } satisfies Record<TeamTaskStatus, string>,
  actions: {
    cancel: "Cancel",
    save: "Save",
    close: "Close",
    copy: "Copy",
    retry: "Retry",
    learnMore: "Learn more",
  },
  /** Marks an optional form field, next to its label. */
  optional: "Optional",
  language: { label: "Language" },
  /** Each language in its own script (autonyms), the same in every locale. */
  languageNames: {
    en: "English",
    "zh-TW": "繁體中文", // i18n-allow: autonym
  } satisfies Record<Locale, string>,
  errors: {
    serverUnreachable: `Cannot reach the local ${product.name} service. Is it still running?`,
    generic: "Something went wrong. Please try again.",
  },
  /**
   * A long error, usually the raw tail of an agent CLI's output, folded
   * behind its leading label (FailureText).
   */
  failureText: {
    /**
     * The label before the first colon, such as "claude failed", as a
     * sentence. It is in the error's language: `fullWidth` when it ended at
     * a full-width colon (Chinese text), which keeps its own punctuation.
     */
    label: ({ label, fullWidth }: { label: string; fullWidth: boolean }) =>
      fullWidth ? label : `${label}.`,
    /** The label when the error starts with no short one. */
    fallback: "The command failed.",
    showRaw: ({ count }: { count: string }) =>
      `Show the raw output (${count} characters)`,
    hideRaw: "Hide the raw output",
  },
};

export default common;
