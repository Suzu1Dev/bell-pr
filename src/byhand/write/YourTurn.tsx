/** Your turn (DESIGN v1.2 F4): in the Changes tab while the diff is empty, the run's folder to open in the person's editor and the first open step. */
import { SquarePen } from "lucide-react";
import { usePresentation } from "../../app/presentation";
import type { Run } from "../../types";
import { CopyRef } from "./CopyRef";
import { useWriteText } from "./text";
import "./byhand.css";

export interface YourTurnProps {
  run: Run;
  /** The run's worktree, masked while presenting (as WorktreeHint does). */
  worktreePath: string;
  presenting?: boolean;
}

export function YourTurn({ run, worktreePath, presenting = false }: YourTurnProps) {
  const t = useWriteText().turn;
  const { maskPath } = usePresentation();
  const first = run.byHand?.plan?.steps.find((step) => !step.doneAt && !step.parkedAt);
  return (
    <div className="empty-state by-hand">
      <div className="empty-icon"><SquarePen /></div>
      <h3>{t.title}</h3>
      {/* While presenting the path loses its folders and is not copied. */}
      {presenting ? <code>{maskPath(worktreePath)}</code> : <CopyRef text={worktreePath} />}
      <p>{t.open}</p>
      {first && <p>{t.first({ step: first.title })}</p>}
    </div>
  );
}
