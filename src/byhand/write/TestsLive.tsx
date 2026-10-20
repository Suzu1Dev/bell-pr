import { useEffect, useState } from "react";
import type { ByHandTestReportInput, LiveTests } from "../../../shared/by-hand";
import { api } from "../../api";
import { useT } from "../../i18n";
import { useWriteText } from "./text";

/** While BELL runs the tests (DESIGN v1.2 F9; cut K3): the output so far, read every 1.5 s. */
export function LiveTail({ runId }: { runId: string }) {
  const t = useWriteText().live;
  const [tail, setTail] = useState("");
  useEffect(() => {
    let live = true;
    const read = () =>
      api<LiveTests>(`/runs/${encodeURIComponent(runId)}/by-hand/tests/live`).then((view) => live && setTail(view.tail), () => undefined);
    void read();
    const timer = setInterval(read, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [runId]);
  return (
    <details open>
      <summary>{t.tail}</summary>
      <pre>{tail}</pre>
    </details>
  );
}

/** "Record my result" (cut K3): a run in the person's own terminal, marked as reported by them. */
export function RecordResult({ onReport, busy }: { onReport(input: ByHandTestReportInput): Promise<void>; busy: boolean }) {
  const t = useWriteText().live;
  const save = useT("common").actions.save;
  const [outcome, setOutcome] = useState<"passed" | "failed">();
  const [output, setOutput] = useState("");
  return (
    <details>
      <summary>{t.record}</summary>
      <p className="field-help">{t.recordText}</p>
      <fieldset className="by-hand-row" aria-label={t.record}>
        {(["passed", "failed"] as const).map((value) => (
          <label key={value} className="by-hand-chip">
            <input type="radio" name="by-hand-report" checked={outcome === value} onChange={() => setOutcome(value)} />
            {t[value]}
          </label>
        ))}
      </fieldset>
      <textarea className="text-input" aria-label={t.output} placeholder={t.output} rows={3} maxLength={4000} value={output} onChange={(event) => setOutput(event.target.value)} />
      <button type="button" className="button secondary" disabled={busy || !outcome}
        onClick={() => outcome && void onReport({ outcome, ...(output.trim() ? { output } : {}) }).then(() => setOutput(""), () => undefined)}>
        {save}
      </button>
    </details>
  );
}
