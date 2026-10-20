/**
 * Your words (DESIGN v1.2 F11): no AI-drafted PR text in a Learn-by-hand
 * run; the project's PR template verbatim, the person's own explanation,
 * and the facts list, shown and never inserted. STUB: the props are final;
 * W2F builds it.
 */
import type { ByHandTemplate } from "../../../shared/by-hand";
import type { Run } from "../../types";

export interface DraftHelpersProps {
  run: Run;
  /** The project's PR templates (GET …/by-hand/template). */
  templates?: ByHandTemplate[];
  /** Puts the chosen template into the description, verbatim. */
  onUseTemplate(content: string): void;
  /** "Always add" is on: "Write your AI note in your own words" beside the facts list. */
  alwaysDiscloseAi?: boolean;
}

export function DraftHelpers(props: DraftHelpersProps) {
  void props;
  return null;
}
