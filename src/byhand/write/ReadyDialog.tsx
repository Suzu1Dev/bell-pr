/**
 * Ready for review (DESIGN v1.2 F5, F8): the facts of this version, the
 * last test run at it, "What are you least sure about?" and "Ask the guide
 * to review it". Nothing is explained or reviewed before it.
 */
import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { byHandLimits, helpAllowed, type ByHandReadyInput } from "../../../shared/by-hand";
import { changeFingerprint } from "../../../shared/change-fingerprint";
import { useFormat, useT } from "../../i18n";
import { Modal } from "../../modals/Modal";
import type { DiffFile, Run } from "../../types";
import { ago, useWriteText } from "./text";
import "./byhand.css";

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

export function ReadyDialog({ run, files, open, onClose, onReady, aiRules = false, busy = false, error }: ReadyDialogProps) {
  const text = useWriteText();
  const t = text.ready;
  const cancel = useT("common").actions.cancel;
  const fmt = useFormat();
  const [leastSure, setLeastSure] = useState("");
  const [review, setReview] = useState(true);
  if (!open) return null;
  const record = run.byHand ?? {};
  const fingerprint = changeFingerprint(files.map(({ path, fingerprint }) => ({ path, fingerprint: fingerprint ?? "" })));
  // The last test run at this version, BELL's or one the person reported.
  const last = (record.tests ?? [])
    .filter((test) => test.changeFingerprint === fingerprint)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .at(-1);
  // A second review waits for a test run at the new version.
  const reviewedBefore = !!record.reviews?.length || !!record.ready?.review || !!record.readyHistory?.some((ready) => ready.review);
  const testFirst = reviewedBefore && !last;
  const offered = helpAllowed(run, "review");
  const asked = offered && review && !testFirst;
  const predicted = last?.prediction && text.tests.predictions[last.prediction];
  return (
    <Modal title={t.title} subtitle={t.quiet} onClose={onClose} mark={<CheckCheck size={22} aria-hidden="true" />}>
      <div className="by-hand">
        <ul>
          <li>
            {t.facts({
              n: files.length,
              additions: files.reduce((sum, file) => sum + file.additions, 0),
              deletions: files.reduce((sum, file) => sum + file.deletions, 0),
            })}
          </li>
          <li>
            {last ? (
              t.tested({ outcome: text.tests.outcomes[last.outcome] ?? last.outcome, when: ago(fmt, last.at), predicted })
            ) : (
              <span className="by-hand-note">{t.untested}</span>
            )}
          </li>
          {!!last?.newFiles?.length && (
            <li>{text.tests.newFiles({ n: last.newFiles.length, list: fmt.list(last.newFiles, { type: "unit" }) })}</li>
          )}
        </ul>
        <label className="field-label" htmlFor="by-hand-least-sure">
          {t.leastSure}
        </label>
        <textarea id="by-hand-least-sure" className="text-input" rows={2} maxLength={byHandLimits.leastSureChars} value={leastSure}
          onChange={(event) => setLeastSure(event.target.value)} />
        {offered ? (
          <>
            <label className="mission-plan-option">
              <input type="checkbox" checked={asked} disabled={testFirst} onChange={(event) => setReview(event.target.checked)} />
              <span className="mission-plan-copy">
                <strong>{t.review}</strong>
                <small>{testFirst ? t.testFirst : t.reviewText}</small>
              </span>
            </label>
            {aiRules && <p className="by-hand-note">{t.aiRules}</p>}
            {asked && <p className="field-help">{t.cost}</p>}
          </>
        ) : (
          <p className="field-help">{t.noReview}</p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {cancel}
          </button>
          <button type="button" className="button primary" disabled={busy || !files.length}
            onClick={() => void onReady({ changeFingerprint: fingerprint, ...(leastSure.trim() ? { leastSure: leastSure.trim() } : {}), review: asked }).catch(() => undefined)}>
            <CheckCheck size={16} aria-hidden="true" /> {t.confirm}
          </button>
        </div>
      </div>
    </Modal>
  );
}
