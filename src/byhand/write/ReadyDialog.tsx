/**
 * Ready for review (DESIGN v1.2 F5, F8): the facts of this version, the
 * last test run at it, "What are you least sure about?" and "Ask the guide
 * to review it". STUB: the props are final; W2D builds it.
 */
import type { ByHandReadyInput } from "../../../shared/by-hand";
import type { DiffFile, Run } from "../../types";

export interface ReadyDialogProps {
  run: Run;
  files: DiffFile[];
  open: boolean;
  onClose(): void;
  /** POST …/by-hand/ready with the current change fingerprint. */
  onReady(input: ByHandReadyInput): Promise<void>;
  /** The project's rules have an AI-related finding: one line before asking for a review. */
  aiRules?: boolean;
  busy?: boolean;
  /** The server's message for a refused request, shown as it is. */
  error?: string;
}

export function ReadyDialog(props: ReadyDialogProps) {
  void props;
  return null;
}
