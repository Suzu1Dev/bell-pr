/**
 * "Who writes the code?" in the task dialog (DESIGN v1.2 F1): the agent
 * team (the default) or Learn by hand, with the fitted or full-help choice
 * when the project's rules allow the quoted confirm. STUB: the props are
 * final; W2D builds it in the NewTaskModal chunk (strings in `modals`).
 */
import type { ByHandRulesCase } from "../../shared/by-hand-rules";

/** Who writes the change; sent as POST /api/runs `learnByHand`. */
export type RunMode = "agents" | "hand";

export interface ModeChoiceProps {
  mode: RunMode;
  onModeChange(mode: RunMode): void;
  /**
   * The F12 case of the project's rules for this task (byHandRulesCase);
   * undefined while the rules are unread. Learn by hand is never
   * preselected where the case is not `none`.
   */
  rulesCase?: ByHandRulesCase;
  /** "Fit the guide to the project's rules" (the `fitted` case only); sent as `byHandFit`. */
  fitted: boolean;
  onFittedChange(fitted: boolean): void;
  /** The sample shows the agent team only: Learn by hand is disabled with the reason. */
  sample?: boolean;
  disabled?: boolean;
}

export function ModeChoice(props: ModeChoiceProps) {
  void props;
  return null;
}
