/**
 * The coach debrief: a read-only agent turn over the person's own
 * records for one project, stored on the repository
 * (`Repository.debriefs`, at most 5). It
 * describes the work, never the person, and quotes only the records.
 */
import type { Locale } from "./i18n/locale.js";
import type { TasteDimension } from "./understanding.js";

/** A contrasting-case drill built from the person's own diffs. */
export interface CoachDrill {
  /** What the code is for. */
  context: string;
  optionA: string;
  optionB: string;
  /** "Which fits this project, and why?" */
  question: string;
  /** The trade-off, shown after the person answers. */
  reveal: string;
}

export interface CoachDebrief {
  at: string;
  /** The language it was written in (the runs' locale). */
  locale: Locale;
  /** The runs whose records it read, newest first. */
  runIds: string[];
  /** The taste dimension maintainers raised most, with verbatim quotes the server checked against the records. */
  recurring?: { dimension: TasteDimension; quotes: string[] };
  drills?: CoachDrill[];
  /** One concrete next step. */
  nextStep: string;
}

/** Write caps of a debrief; persisted reads allow four times as much. */
export const coachLimits = {
  runIds: 20,
  quotes: 3,
  quoteChars: 300,
  drills: 3,
  contextChars: 600,
  optionChars: 1200,
  questionChars: 300,
  revealChars: 1200,
  nextStepChars: 300,
  /** Debriefs kept per repository. */
  debriefs: 5,
} as const;
