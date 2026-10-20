/**
 * Plan with the guide (DESIGN v1.2 F3), in the team board while the run
 * waits in `awaiting_plan`: the person's steps first, read-first ranges,
 * the outline folded until a first draft, questions on the plan, and
 * "This is my plan". STUB: the props are final; W2D builds it.
 */
import type { ByHandPlanInput } from "../../../shared/by-hand";
import type { Run } from "../../types";

export interface PlanWithGuideProps {
  run: Run;
  /** Saves the plan (PUT …/by-hand/plan), on blur and before every action. */
  onSave(input: ByHandPlanInput): Promise<void>;
  /** Shows the outline's step names, or both lists side by side (POST …/by-hand/plan/reveal). */
  onReveal(mode: "names" | "compare"): Promise<void>;
  /** "Questions on my plan" (POST …/by-hand/plan/questions, 202). */
  onAskQuestions(): Promise<void>;
  /** "This is my plan" (POST …/plan/approve). */
  onConfirm(): Promise<void>;
  busy?: boolean;
  /** The server's message for a refused action, shown as it is. */
  error?: string;
}

export function PlanWithGuide(props: PlanWithGuideProps) {
  void props;
  return null;
}
