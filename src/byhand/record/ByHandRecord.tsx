/**
 * The run record (DESIGN v1.2 F13): the canonical claim only while the
 * run's history is clean (byHandClean), the help used and plain counts,
 * the help set a fitted run started with, and what BELL can't see; in the
 * publish dialog next to the `by-hand-rules` confirm, in the Draft tab's
 * checklist and on the learning page. An agent run has no record.
 */
import { Hand, LoaderCircle, RefreshCw } from "lucide-react";
import { allHelpKinds, byHandClean, byHandSummary, type ByHandSummary } from "../../../shared/by-hand";
import type { Formatters } from "../../../shared/i18n/locale";
import { useFormat, useLocale, useT } from "../../i18n";
import type { Run } from "../../types";
import en from "./i18n/en";
import zhTW from "./i18n/zh-TW";
import "./record.css";

export interface ByHandRecordProps {
  /** The open run (publish dialog, Draft tab). */
  run?: Run;
  /** The learning page's counts (LearningRun.byHandSummary), without the full run. */
  summary?: ByHandSummary;
  place: "publish" | "draft" | "learning";
  /** Publish dialog: the server's checks are being read, or couldn't be (`failed`; its retry stays focusable). Never a pass (F12). */
  unchecked?: { checking: boolean; failed: boolean; onRetry(): void };
}

/** The test runs `byHand.tests` keeps (byHandLimits.tests): with that many, older ones may be gone. */
export const keptTests = 10;

/** The record's dictionary in the UI language (module-local, DESIGN v1.2 §11.1). */
export function useRecordMessages() {
  return useLocale()[0] === "zh-TW" ? zhTW : en;
}

/** "Help you used: explanations (3), answers (6)…", from the run's help events. */
export function helpsLine(m: typeof en, fmt: Formatters, { helps }: ByHandSummary) {
  const used = allHelpKinds.filter((kind) => helps[kind]);
  return used.length
    ? m.helps({ list: fmt.list(used.map((kind) => m.helpCount({ kind: m.kinds[kind], count: helps[kind]! }))) })
    : m.noHelp;
}

/** The record's lines; the claim only for a run whose history is clean (never on the learning page, which has no history). */
export function recordLines(m: typeof en, fmt: Formatters, run: Run | undefined, summary: ByHandSummary) {
  const clean = run && byHandClean(run);
  const tests = run?.byHand?.tests ?? [];
  const runs = tests.filter((test) => !test.reported).length;
  return {
    claim: clean?.clean ? m.claimed({ claim: m.claim, quotes: m.quotes }) : "",
    lines: [
      ...(clean && !clean.clean ? [m.unclean({ reason: m.reasons[clean.reason] })] : []),
      ...(summary.removedAnswers ? [m.removed({ count: summary.removedAnswers })] : []),
      helpsLine(m, fmt, summary),
      ...(runs ? [m.tests({ runs, more: tests.length >= keptTests, ...summary.predictions })] : []),
      ...(summary.fittedKinds
        ? [m.fitted({ kinds: fmt.list(summary.fittedKinds.map((kind) => m.kinds[kind as keyof typeof m.kinds] ?? kind)) })]
        : []),
      ...(run ? [m.otherTools] : []),
    ],
  };
}

export function ByHandRecord({ run, summary: counts, place, unchecked }: ByHandRecordProps) {
  const m = useRecordMessages();
  const fmt = useFormat();
  const [checking, retry] = [useT("mission").rules.checking, useT("workspace").check.retry];
  const summary = counts ?? (run?.learnByHand ? byHandSummary(run) : undefined);
  if (!summary || (run && !run.learnByHand)) return null;
  const { claim, lines } = recordLines(m, fmt, run, summary);
  const list = (
    <ul className="draft-checklist-sources">
      {lines.map((line) => <li key={line}>{line}</li>)}
    </ul>
  );
  if (place === "learning")
    return (
      <div className="byhand-record">
        <span className="draft-guidance-badge"><Hand size={12} aria-hidden="true" /> {m.badge}</span>
        {list}
      </div>
    );
  const body = (
    <>
      {claim && <p className="byhand-record-claim">{claim}</p>}
      {list}
      <p className="field-help">{m.forYou}</p>
    </>
  );
  return place === "draft" ? (
    <div className="checklist-item">
      <Hand size={18} aria-hidden="true" />
      <details className="byhand-record">
        <summary>{m.title}</summary>
        {body}
      </details>
    </div>
  ) : (
    <>
      {unchecked &&
        (unchecked.failed ? (
          <div className="publish-block" role="alert">
            <span>{m.unchecked}</span>
            <button type="button" className="button secondary" aria-disabled={unchecked.checking} onClick={() => !unchecked.checking && unchecked.onRetry()}>
              {unchecked.checking ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} {retry}
            </button>
          </div>
        ) : (
          <p className="publish-fact" role="status"><LoaderCircle className="spin" size={14} aria-hidden="true" /> {checking}</p>
        ))}
      <section className="byhand-record draft-guidance-disclosure" aria-label={m.title}>
        <h3><Hand size={15} aria-hidden="true" /> {m.title}</h3>
        {body}
      </section>
    </>
  );
}
