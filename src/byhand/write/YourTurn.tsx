/**
 * Your turn (DESIGN v1.2 F4): in the Changes tab while the diff is empty,
 * the run's folder to open in the person's editor and the first open step.
 * STUB: the props are final; W2D builds it.
 */
import type { Run } from "../../types";

export interface YourTurnProps {
  run: Run;
  /** The run's worktree, masked while presenting (as WorktreeHint does). */
  worktreePath: string;
  presenting?: boolean;
}

export function YourTurn(props: YourTurnProps) {
  void props;
  return null;
}
