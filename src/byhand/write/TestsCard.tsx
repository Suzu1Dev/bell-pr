import { useEffect, useState } from "react";
import { CircleStop, FlaskConical, Loader2, Play } from "lucide-react";
import {
  helpAllowed,
  testPredictions,
  type ByHandRecord,
  type ByHandTestInput,
  type ByHandTestReportInput,
  type TestCommandView,
  type TestPrediction,
} from "../../../shared/by-hand";
import { api } from "../../api";
import { useFormat } from "../../i18n";
import { ago, useWriteText } from "./text";
import { LiveTail, RecordResult } from "./TestsLive";

/**
 * The Tests card (DESIGN v1.2 F9): BELL suggests a command, the person
 * edits and confirms it in a request of its own, predicts, then runs it.
 * Never automatic. The result says what was predicted, names new files
 * the run wrote, and keeps the output folded. The command is read here
 * unless given, so the card works in the guide's panel and in the Ready
 * dialog alike.
 */
export function TestsCard({ runId, record, testCommand: given, onConfirmTestCommand, onRunTests, onStopTests, onReportTests, onExplain, busy }: {
  runId: string;
  record: ByHandRecord;
  testCommand?: TestCommandView;
  onConfirmTestCommand(command: string): Promise<void>;
  onRunTests(input: ByHandTestInput): Promise<void>;
  onStopTests(): Promise<void>;
  /** "Record my result" from the person's own terminal. */
  onReportTests(input: ByHandTestReportInput): Promise<void>;
  /** "Explain this failure" (a guide turn of kind `test`); absent where it isn't offered. */
  onExplain?: () => void;
  busy: boolean;
}) {
  const t = useWriteText().tests;
  const fmt = useFormat();
  const [read, setRead] = useState<TestCommandView>();
  useEffect(() => void (given || api<TestCommandView>(`/runs/${encodeURIComponent(runId)}/by-hand/test-command`).then(setRead, () => undefined)), [runId, given]);
  const testCommand = read ?? given;
  const confirmed = testCommand?.confirmed?.command;
  const [command, setCommand] = useState<string>();
  const shown = command ?? confirmed ?? testCommand?.suggestion ?? "";
  // Run runs only the confirmed command, so it waits while the field shows another one.
  const edited = shown.trim() !== confirmed;
  const [prediction, setPrediction] = useState<TestPrediction>();
  const [expect, setExpect] = useState("");
  const running = record.busy?.kind === "tests";
  const last = [...(record.tests ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
  const outcome = last && (t.outcomes[last.outcome] ?? last.outcome);
  return (
    <section aria-labelledby="by-hand-tests">
      <h3 id="by-hand-tests"><FlaskConical size={16} aria-hidden="true" /> {t.title}</h3>
      <label htmlFor="by-hand-command">{t.command}</label>
      <div className="by-hand-row">
        <input id="by-hand-command" className="text-input" maxLength={300} placeholder={t.none} value={shown} onChange={(event) => setCommand(event.target.value)} />
        <button type="button" className="button secondary" disabled={busy || !shown.trim() || shown.trim() === confirmed}
          onClick={() => void onConfirmTestCommand(shown.trim()).then(() => (setCommand(undefined), setRead({ suggestion: testCommand?.suggestion ?? "", confirmed: { command: shown.trim(), confirmedAt: new Date().toISOString() } })), () => undefined)}>{t.use}</button>
      </div>
      {confirmed && <p><strong>{t.confirmed({ command: confirmed })}</strong></p>}
      {confirmed && edited && <p className="field-help">{t.edited}</p>}
      <p className="field-help">{t.honesty}</p>
      <fieldset className="by-hand-row">
        <legend>{t.predict}</legend>
        {testPredictions.map((value) => (
          <label key={value} className="by-hand-chip">
            <input type="radio" name="by-hand-prediction" checked={prediction === value} onChange={() => setPrediction(value)} />
            {t.predictions[value]}
          </label>
        ))}
      </fieldset>
      <input className="text-input" aria-label={t.expect} placeholder={t.expect} maxLength={200} value={expect} onChange={(event) => setExpect(event.target.value)} />
      <div className="by-hand-row">
        <button type="button" className="button primary" disabled={busy || running || !confirmed || edited}
          onClick={() => void onRunTests({ ...(prediction ? { prediction } : {}), ...(expect.trim() ? { expect: expect.trim() } : {}) }).catch(() => undefined)}>
          {running ? <Loader2 size={15} className="spin" /> : <Play size={15} aria-hidden="true" />}
          {running ? t.running : t.run}
        </button>
        {running && <button type="button" className="button secondary" onClick={() => void onStopTests().catch(() => undefined)}><CircleStop size={15} aria-hidden="true" /> {t.stop}</button>}
      </div>
      {/* Always there, so a screen reader hears the result when a run ends. */}
      <p role="status" className="visually-hidden">{last && !running ? t.result({ predicted: last.prediction && t.predictions[last.prediction], outcome: outcome ?? "" }) : ""}</p>
      {last && !running && (
        <div>
          <p>
            {t.result({ predicted: last.prediction && t.predictions[last.prediction], outcome: outcome ?? "" })}{" "}
            <code>{last.command}</code> {last.exitCode !== undefined && `(${last.exitCode})`} {ago(fmt, last.at)}{" "}
            {last.reported && <em>{t.reported}</em>}
          </p>
          {last.outcome === "error" && <p className="field-help">{t.error}</p>}
          {!!last.newFiles?.length && <p>{t.newFiles({ n: last.newFiles.length, list: fmt.list(last.newFiles, { type: "unit" }) })}</p>}
          {last.outputTail && (
            <details>
              <summary>{t.output}</summary>
              <pre>{last.outputTail}</pre>
            </details>
          )}
          {last.outcome === "failed" && onExplain && helpAllowed({ byHand: record }, "test") && (
            <button type="button" className="mission-text-button" disabled={busy} onClick={onExplain}>
              {t.explain}
            </button>
          )}
        </div>
      )}
      {running && <LiveTail runId={runId} />}
      <RecordResult onReport={onReportTests} busy={busy || running} />
    </section>
  );
}
