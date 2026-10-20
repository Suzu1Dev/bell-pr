/**
 * The guide (DESIGN v1.2 F6, F9, F12): the aside of the Changes tab while
 * the run is not at its ready version: the person's steps, the hint ladder
 * (R0 local, R1-R4 behind the attempt gate), free questions, the exits,
 * the stuck card, the Tests card, and the banner of a run that can't
 * publish here or is fitted to the project's rules. STUB: the props are
 * final; W2D builds it.
 */
import type {
  ByHandCheckInInput,
  ByHandGuideInput,
  ByHandStepInput,
  ByHandTestInput,
  ByHandTestReportInput,
  LiveTests,
  TestCommandView,
} from "../../../shared/by-hand";
import type { ByHandRulesCase } from "../../../shared/by-hand-rules";
import type { HelpChannel } from "../../../shared/contribution";
import type { DiffFile, Run } from "../../types";

export interface GuidePanelProps {
  run: Run;
  files: DiffFile[];
  /** A diff selection's Ask: prefills the question with `path:start-end`. */
  selection?: { path: string; startLine: number; endLine: number };
  /** Ask, a hint rung or "Explain this failure" (POST …/by-hand/guide, 202). */
  onGuide(input: ByHandGuideInput): Promise<void>;
  /** Done, Park, the why after R3 or R4, the R3 choice, an R0 use (PATCH …/by-hand/steps/:stepId). */
  onStep(stepId: string, input: ByHandStepInput): Promise<void>;
  /** The stuck card and the exit taken (POST …/by-hand/check-ins). */
  onCheckIn(input: ByHandCheckInInput): Promise<void>;
  testCommand?: TestCommandView;
  /** Confirms the project's test command in a request of its own (PUT /api/repos/:id/test-command). */
  onConfirmTestCommand(command: string): Promise<void>;
  onRunTests(input: ByHandTestInput): Promise<void>;
  liveTests?: LiveTests;
  onStopTests(): Promise<void>;
  /** "Record my result" from the person's own terminal. */
  onReportTests(input: ByHandTestReportInput): Promise<void>;
  /** "Hand this task to the agent team": records leaving, then opens the task dialog. */
  onLeave(): Promise<void>;
  /** "Ask a human": the issue and the project's own channels. */
  issueUrl?: string;
  channels?: HelpChannel[];
  /** The F12 case this run started in: the banner, and the helps a fitted run offers. */
  rulesCase?: ByHandRulesCase;
  busy?: boolean;
  /** The server's message for a refused request, shown as it is. */
  error?: string;
}

export function GuidePanel(props: GuidePanelProps) {
  void props;
  return null;
}
