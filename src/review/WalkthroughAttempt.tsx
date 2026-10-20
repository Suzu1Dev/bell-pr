import {
  understandingLimits,
  walkthroughUnitKey,
  type FileAttempt,
  type FileAttemptInput,
} from "../../shared/understanding";
import type { FunctionWalkthrough } from "../../shared/walkthroughs";
import { usePanelStrings } from "./i18n";
import { QuizAttempt } from "./QuizAttempt";

/** What a unit's save sends: PATCH /api/runs/:id/attempts `walkthrough`. */
export type WalkthroughInput = NonNullable<FileAttemptInput["walkthrough"]>;

/**
 * A walkthrough unit's "Check yourself", tried first (DESIGN v1.2 D1): the
 * quiz card of the explanation, an answer and a confidence saved before
 * the answer shows, then a grade; Show answer with the field empty skips.
 * Each unit is saved under its key `name:startLine`. In an agent run a
 * graded answer can fill the file's check question (the server decides);
 * in a Learn-by-hand run it credits nothing. Without `onAttempt` (a run
 * that takes no attempts, such as a published one) the saved answer shows
 * read-only. A confident miss promises no practice deck: the deck asks one
 * answer per file, its explanation's quiz before any unit. Once the file
 * has the most unit answers the server keeps at this version (a
 * walkthrough made again brings new units), a new unit is still tried
 * first but stays on the page, since its save would be refused.
 */
export function WalkthroughAttempt({
  unit,
  attempts,
  onAttempt,
  demo,
}: {
  unit: FunctionWalkthrough;
  attempts?: FileAttempt["walkthroughs"];
  onAttempt?: (input: WalkthroughInput) => Promise<void>;
  demo: boolean;
}) {
  const t = usePanelStrings();
  const key = walkthroughUnitKey(unit);
  const saved = attempts?.[key];
  const full =
    !saved && Object.keys(attempts ?? {}).length >= understandingLimits.walkthroughUnits;
  return (
    <>
      <QuizAttempt
        title={t.checkYourself}
        question={unit.selfCheck.question}
        reference={unit.selfCheck.answer}
        saved={saved}
        onSave={onAttempt && !full ? (quiz) => onAttempt({ unit: key, ...quiz }) : undefined}
        readOnly={!onAttempt}
        practised={false}
        demo={demo}
      />
      {onAttempt && full && <p className="tf-hint">{t.walkthroughFull}</p>}
    </>
  );
}
