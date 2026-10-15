import type { ReviewabilitySnapshot as Snapshot, WeakenedTest } from "../../shared/reviewability";

/**
 * How reviewable the change is (DESIGN F9): its size against BELL's bands
 * and the project's own merged sizes, tests, new dependencies, files
 * outside the plan, whitespace-only changes, and a one-line reason for each
 * weakened test.
 *
 * L1 stub with the final props; L2F fills it in.
 */
export interface ReviewabilitySnapshotProps {
  snapshot: Snapshot;
  weakened: Pick<WeakenedTest, "id" | "path" | "line" | "text">[];
  /** The saved reason of each weakened-test item, by its id. */
  reasons: Record<string, string>;
  onSaveReasons?(reasons: Record<string, string>): void;
  /** Opens the Ask-the-agent preset "How could this be split into separate changes?". */
  onAskSplit?(): void;
  /** The short form at the top of the check panel. */
  compact?: boolean;
}

export default function ReviewabilitySnapshot(_props: ReviewabilitySnapshotProps) {
  return null;
}
