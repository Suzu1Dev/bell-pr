import type { SetupNeed } from "./setup-needs.js";

/**
 * One entry of the working session: the person and an agent talking about
 * the contribution before it is published. `agent` turns may have edited the
 * checkout; `system` entries report interruptions and restarts.
 */
export interface SessionMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  at: string;
  /** Paths whose diff changed during this agent turn (BELL compared the diff before and after). */
  changedFiles?: string[];
  /** What the agent needs from the person before it can continue; answered in the next message. */
  questions?: string[];
  /** Commands BELL saw the agent run, with outcomes; not the agent's own list. */
  checks?: { command: string; outcome: string }[];
  /** Checks the agent could not run, each with the reason. */
  notRun?: { check: string; reason: string }[];
  /** What the machine lacked for checks this turn could not run. */
  setup?: SetupNeed[];
  /** True for an agent turn that ended in an error or was stopped. */
  failed?: boolean;
  /**
   * Set when this turn rewrote the PR draft's Limitations section (the person's
   * own PR text, so both versions are kept to show and undo by hand).
   */
  draftUpdate?: { before: string; after: string };
}

/** Persisted working session (`Run.session`); absent until the first message. */
export interface WorkSession {
  /** Newest entries only, oldest first. */
  messages: SessionMessage[];
  /** True while an agent turn is running; a restart clears it. */
  running?: boolean;
  /** When the running turn started; pairs with the run log entries of agent `session`. */
  startedAt?: string;
  /** Checkout HEAD before this turn, for restoring uncommitted edits after a restart. */
  startingHead?: string;
  /**
   * Counts the turns that changed the checkout. Pages that show the diff,
   * explanations, review state or draft read it to know the files moved.
   */
  revision: number;
  updatedAt: string;
}

/** Entries kept in the record; older ones are dropped. */
export const sessionMessageLimit = 40;
/** Characters kept per stored entry. */
export const sessionContentLimit = 8_000;
/** Characters the person may send in one message. */
export const sessionInputLimit = 4_000;
