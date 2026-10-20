import { Hand } from "lucide-react";
import type { RunSummary } from "../types";

/**
 * A Learn-by-hand run the person still plans or writes: their turn. Lists
 * don't hold its diff, so "still writes" is a run never marked ready (the
 * team phase turns complete at the first Ready, DESIGN v1.2 F5).
 */
export const byHandTurn = (run: Pick<RunSummary, "learnByHand" | "status" | "team">) =>
  !!run.learnByHand && (run.status === "awaiting_plan" || (run.status === "review" && run.team?.phase !== "complete"));

/** A list's Learn-by-hand chip (as in the sidebar): the hand, with its name for screen readers. */
export function ByHandChip({ label }: { label: string }) {
  return (
    <span title={label}>
      <Hand size={13} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
