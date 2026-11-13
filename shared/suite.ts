// suite-contract v1 (2026-11-08)
/**
 * The part of the BELL Suite contract that BELL PR serves: its manifest and
 * its Today feed. The Suite repository's contract is the source; this copy
 * holds only what BELL PR sends. server/suite-contract.ts checks every
 * response against it.
 */

/**
 * Where the other BELL products are, as origins: BELLPR_SUITE_LINKS. The
 * contract knows three products; BELL PR itself is `pr`.
 */
export type SuiteSiblingId = "explain" | "personal" | "reader" | "campaign";
export type SuiteAppId = SuiteSiblingId | "pr";
export type SuiteLinks = Partial<Record<SuiteSiblingId, string>>;

/** The contract's limits that apply to what BELL PR sends; lengths are code points. */
export const suiteLimits = {
  title: 120,
  detail: 80,
  displayName: 40,
  summary: 40,
  items: 5,
  countMax: 100_000,
  handoffText: 2000,
  handoffTitle: 120,
  back: 512,
} as const;

/** The route of a run in BELL PR; the feed's `href` fills in the run id. */
export const suiteRunRoute = "#/runs/{id}";
/** Entry route where BELL PR accepts zero-write task drafts from sibling BELL apps. */
export const suiteHandoffRoute = "#/discover";

export const SUITE_ROUTES: Record<SuiteAppId, readonly string[]> = {
  explain: ["#/", "#/explain", "#/library", "#/graph", "#/favorites", "#/repositories", "#/review", "#/note/{id}"],
  personal: ["#/today", "#/tasks", "#/tasks/{id}", "#/events", "#/events/{id}", "#/ideas", "#/ideas/{id}", "#/inbox", "#/inbox/{id}"],
  pr: ["#/", "#/home", "#/demo", "#/repos", "#/repos/{id}", "#/discover", "#/team", "#/group", "#/learning", "#/settings", "#/runs/{id}"],
  reader: ["#/", "#/read", "#/library", "#/topics", "#/page/{id}"],
  campaign: ["#/", "#/schedule", "#/tasks", "#/partners", "#/forms", "#/files", "#/meetings", "#/inspirations", "#/notes", "#/bot"],
};

export interface SuiteManifest {
  schemaVersion: 1;
  appId: "pr";
  displayName: string;
  /** What the product is for, in the request's language. */
  summary: string;
  capabilities: (
    | { id: string; kind: "today-feed"; api: string }
    | { id: string; kind: "object-route"; route: string }
    | { id: string; kind: "accept-handoff"; route: string; accepts: ["text"]; maxChars: number }
  )[];
  links: SuiteLinks;
}

export interface SuiteTodayItem {
  sourceApp: "pr";
  type: "run";
  /** The run id. */
  id: string;
  title: string;
  href: string;
  /** needs-you: the person acts next. waiting: BELL PR is working. */
  state: "needs-you" | "waiting";
  /** ISO time in UTC. */
  updatedAt: string;
  /** The run's state in a few words, in the request's language. */
  detail: string;
}

export interface SuiteTodayFeed {
  schemaVersion: 1;
  appId: "pr";
  /** ISO time in UTC. */
  generatedAt: string;
  /** Every run the feed counts, not only the listed ones. */
  counts: { needsYou: number; waiting: number };
  items: SuiteTodayItem[];
  /** True when more runs count than `items` lists. */
  truncated: boolean;
}
