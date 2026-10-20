/**
 * The run record (DESIGN v1.2 F13): the canonical claim only while the
 * run's history is clean (byHandClean), the help used and plain counts,
 * the help set a fitted run started with, and what BELL can't see; in the
 * publish dialog next to the `by-hand-rules` confirm, in the Draft tab's
 * checklist and on the learning page. STUB: the props are final; W2F
 * builds it.
 */
import type { ByHandSummary } from "../../../shared/by-hand";
import type { Run } from "../../types";

export interface ByHandRecordProps {
  /** The open run (publish dialog, Draft tab). */
  run?: Run;
  /** The learning page's counts (LearningRun.byHandSummary), without the full run. */
  summary?: ByHandSummary;
  place: "publish" | "draft" | "learning";
}

export function ByHandRecord(props: ByHandRecordProps) {
  void props;
  return null;
}
