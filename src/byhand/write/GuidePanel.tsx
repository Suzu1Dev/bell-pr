/**
 * The guide (DESIGN v1.2 F6, F9, F12): the aside of the Changes tab while
 * the run is not at its ready version: the person's steps, the hint ladder
 * (R1-R3 behind the attempt gate), free questions, the exits, the stuck
 * card, the Tests card, and the banner of a run that can't publish here or
 * is fitted to the project's rules. A fitted run never offers a kind of
 * help outside its help set; the server refuses it anyway.
 */
import { useEffect, useRef, useState } from "react";
import { Check, CircleMinus, Hand, Lightbulb, Loader2, MessageSquare } from "lucide-react";
import { allHelpKinds, askEntries, attemptSince, byHandClean, helpAllowed, helpKindOf, needsWhy, repeatFailure } from "../../../shared/by-hand";
import type { AskEntry, ByHandCheckInInput, ByHandGuideInput, ByHandStepInput, ByHandTestInput, ByHandTestReportInput, LiveTests, TestCommandView } from "../../../shared/by-hand";
import { byHandRulesCase, type ByHandRulesCase } from "../../../shared/by-hand-rules";
import { changeFingerprint } from "../../../shared/change-fingerprint";
import { byHandBlockClause, learningLabel, type ContributionRules, type HelpChannel } from "../../../shared/contribution";
import { api } from "../../api";
import { useLocale, useT } from "../../i18n";
import { helpKindList, rulesFrom } from "../../mission/respect";
import type { DiffFile, Run } from "../../types";
import { useFocusHome } from "./focus";
import { GuideExits } from "./GuideExits";
import { GuideThread } from "./GuideThread";
import { TestsCard } from "./TestsCard";
import { RepeatFailure, TalkItThrough } from "./TalkItThrough";
import { useWriteText } from "./text";
import "./byhand.css";

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

const quiet = () => undefined;

export function GuidePanel(props: GuidePanelProps) {
  const { run, files, selection, onGuide, onStep, busy = false, error } = props;
  const text = useWriteText();
  const t = text.guide;
  const [locale] = useLocale();
  const reviewing = useT("workspace").byHand.reviewing;
  const record = run.byHand ?? {};
  const steps = record.plan?.steps ?? [];
  const step = steps.find((item) => !item.doneAt && !item.parkedAt);
  const lock = record.helpLock;
  // What the workspace didn't pass, read here (both local reads): the test
  // command, and the project's stored rules for the case of a run that
  // won't publish there (a fitted run says its own help set instead).
  const [read, setRead] = useState<{ rules?: ContributionRules; command?: TestCommandView }>({});
  const runPath = `/runs/${encodeURIComponent(run.id)}/by-hand`;
  useEffect(() => {
    let live = true;
    const keep = (value: typeof read) => live && setRead((current) => ({ ...current, ...value }));
    api<TestCommandView>(`${runPath}/test-command`).then((command) => keep({ command }), quiet);
    api<unknown>(`/repos/${encodeURIComponent(run.repoId)}/contribution-rules`).then((body) => keep({ rules: rulesFrom(body) }), quiet);
    return () => void (live = false);
  }, [runPath, run.repoId]);
  const testCommand = props.testCommand ?? read.command;
  const learningIssue = (run.contributionFacts?.issue?.labels ?? []).some(learningLabel);
  const rulesCase = props.rulesCase ?? (read.rules && byHandRulesCase(read.rules, { learningIssue, now: new Date().toISOString() }));
  const fingerprint = changeFingerprint(files.map(({ path, fingerprint }) => ({ path, fingerprint: fingerprint ?? "" })));
  const clean = byHandClean(run);
  // A run with every kind of help where it could have been fitted won't publish there either.
  const blocked = rulesCase?.case === "blocked" ? rulesCase : rulesCase?.case === "fitted" && !lock ? { reason: "not-fitted" as const, finding: undefined } : undefined;
  const banner = lock && clean.clean
    ? t.fitted({ kinds: helpKindList(lock.kinds, locale) })
    : blocked && t.blocked({ clause: byHandBlockClause(blocked.reason, locale, { checkedOn: blocked.finding?.source?.checkedOn }) });
  const missing = lock ? allHelpKinds.filter((kind) => !lock.kinds.includes(kind)) : [];
  const thinking = record.busy?.kind === "guide" || record.busy?.kind === "plan";
  // Why the guide's buttons are off: its answer, the review at Ready or the person's tests (said by the Tests card too).
  const doing = thinking ? t.working : { review: reviewing, tests: text.tests.running }[record.busy?.kind ?? ""] ?? "";
  const working = busy || !!record.busy;

  const [entry, setEntry] = useState<AskEntry>("project");
  const [question, setQuestion] = useState("");
  const [tried, setTried] = useState("");
  const [why, setWhy] = useState<{ stepId: string; text: string }>();
  const box = useRef<HTMLTextAreaElement>(null);
  const home = useFocusHome<HTMLDivElement>();
  const ask = (prefill: string) => {
    setQuestion((current) => `${prefill}${current}`);
    box.current?.focus();
  };
  useEffect(() => {
    if (!selection) return;
    const { path, startLine, endLine } = selection;
    setQuestion((current) => `${startLine ? `${path}:${startLine}-${endLine}` : path} ${current}`);
    box.current?.focus();
  }, [selection]);

  // The ladder of the step the person is on: the next rung after the
  // highest so far, if the run offers its kind, behind the attempt gate.
  const hintState = step ? record.hints?.[step.id] : undefined;
  const rungs = [1, 2, 3, 4].filter((rung) => helpAllowed(run, helpKindOf("hint", rung)));
  const next = (hintState?.rung ?? 0) + 1;
  const offered = !!step && rungs.includes(next);
  // As on the server, R4 also follows the same failure three test runs in a row.
  const attempt = attemptSince(hintState, { fingerprint, tests: record.tests, tried }) || (next === 4 && repeatFailure(record.tests));
  // "My change" goes to that next rung, so it is offered only with it.
  const entries = askEntries.filter((value) => value !== "change" || offered);
  const asked = entries.includes(entry) ? entry : "project";
  const review = record.reviews?.at(-1);
  const send = (input: ByHandGuideInput) =>
    void onGuide({ ...input, ...(step ? { stepId: step.id } : {}), ...(tried.trim() ? { tried: tried.trim() } : {}) }).then(() => (setQuestion(""), setTried("")), quiet);
  // After R3 or R4, Done first asks why the change works: the field takes the focus, and Enter sends it.
  const done = (id: string, why?: string) =>
    why === undefined && needsWhy(steps.find((item) => item.id === id) ?? {}) ? setWhy({ stepId: id, text: "" }) : void onStep(id, { done: true, ...(why === undefined ? {} : { why: why.trim() }) }).then(() => setWhy(undefined), quiet);
  const where = selection?.startLine ? { path: selection.path, startLine: selection.startLine, endLine: selection.endLine } : {};
  return (
    <div className="by-hand guide-panel" {...home}>
      <h3><Hand size={17} aria-hidden="true" /> {t.title}</h3>
      {banner && <p className="by-hand-note">{banner}</p>}
      <p className="field-help">{clean.clean ? t.clean : t.unclean({ reason: t.reasons[clean.reason] ?? clean.reason })}</p>
      {missing.length > 0 && <p className="field-help">{t.notOffered({ kinds: helpKindList(missing, locale) })}</p>}
      {steps.length > 0 && (
        <section aria-label={t.steps}>
          <h3>{t.steps}</h3>
          <ol className="by-hand-steps">
            {steps.map((item) => (
              <li key={item.id} aria-current={item === step ? "step" : undefined}>
                {item.doneAt ? <Check size={14} aria-label={t.done} /> : item.parkedAt ? <CircleMinus size={14} aria-label={t.park} /> : null}
                <span id={`${run.id}-on-${item.id}`}>{item.title}</span>
                {!item.doneAt && (
                  <span className="by-hand-row">
                    <button type="button" className="mission-text-button" aria-describedby={`${run.id}-on-${item.id}`} disabled={working} onClick={() => done(item.id, why?.stepId === item.id ? why.text : undefined)}>
                      {t.done}
                    </button>
                    {!item.parkedAt && <button type="button" className="mission-text-button" aria-describedby={`${run.id}-on-${item.id}`} disabled={working} onClick={() => void onStep(item.id, { parked: true }).catch(quiet)}>{t.park}</button>}
                  </span>
                )}
                {why?.stepId === item.id && <input className="text-input" aria-label={t.why} placeholder={t.why} maxLength={300} value={why.text} autoFocus
                  onChange={(event) => setWhy({ stepId: item.id, text: event.target.value })} onKeyDown={(event) => event.key === "Enter" && done(item.id, why.text)} />}
              </li>
            ))}
          </ol>
        </section>
      )}
      {review && review.changeFingerprint !== fingerprint && review.findings.length > 0 && (
        <ul aria-label={t.aboutReview}>
          {review.findings.map((finding, index) => (
            <li key={`${finding.path}:${finding.line}`}>
              <span id={`${run.id}-finding-${index}`}>{finding.observed}</span>{" "}
              <button type="button" className="mission-text-button" aria-describedby={`${run.id}-finding-${index}`} onClick={() => ask(t.reviewAsk({ at: `${finding.path}${finding.line ? `:${finding.line}` : ""}`, observed: finding.observed }))}>{t.aboutReview}</button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="by-hand"
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim()) send({ kind: "ask", entry: asked, question: question.trim(), ...where });
        }}
      >
        <h3><MessageSquare size={16} aria-hidden="true" /> {t.ask}</h3>
        <fieldset className="by-hand-row" aria-label={t.ask}>
          {entries.map((value) => (
            <label key={value} className="by-hand-chip">
              <input type="radio" name="by-hand-entry" checked={asked === value} onChange={() => setEntry(value)} />
              {t.entries[value]}
            </label>
          ))}
        </fieldset>
        <textarea ref={box} className="text-input" aria-label={t.question} placeholder={t.question} rows={3} maxLength={600} value={question} onChange={(event) => setQuestion(event.target.value)} />
        <details>
          <summary>{t.tried}</summary>
          <textarea className="text-input" aria-label={t.tried} rows={2} maxLength={300} value={tried} onChange={(event) => setTried(event.target.value)} />
        </details>
        <div className="by-hand-row">
          <button type="submit" className="button primary" disabled={working || !question.trim()}>
            <MessageSquare size={15} aria-hidden="true" /> {t.ask}
          </button>
          {offered && (
            <button type="button" className="button secondary" disabled={working || !attempt} onClick={() => send({ kind: "hint", rung: next })}>
              <Lightbulb size={15} aria-hidden="true" /> {t.next({ rung: t.rungs[next] })}
            </button>
          )}
        </div>
        {step && (offered ? !attempt && <p className="field-help">{t.tryFirst}</p> : <p className="field-help">{t.noRung}</p>)}
        {/* Always there, so a screen reader hears the guide start and finish an answer. */}
        <p role="status" className="visually-hidden">{doing}</p>
      </form>
      {step && <TalkItThrough step={step} tests={record.tests ?? []} fingerprint={fingerprint} onStep={onStep} />}
      <RepeatFailure key={step?.id} step={step} tests={record.tests ?? []} onCheckIn={props.onCheckIn} />
      {doing && record.busy?.kind !== "tests" && <p aria-hidden="true"><Loader2 size={14} className="spin" /> {doing}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <GuideExits runId={run.id} step={step} tests={record.tests ?? []} fingerprint={fingerprint} issueUrl={props.issueUrl}
        channels={props.channels} onStep={onStep} onCheckIn={props.onCheckIn} onLeave={props.onLeave} busy={working} />
      <TestsCard runId={run.id} record={record} testCommand={testCommand} onRunTests={props.onRunTests} onReportTests={props.onReportTests} onStopTests={props.onStopTests}
        onConfirmTestCommand={(command) => props.onConfirmTestCommand(command).then(() => setRead((current) => ({ ...current, command: { suggestion: testCommand?.suggestion ?? "", confirmed: { command, confirmedAt: new Date().toISOString() } } })))}
        onExplain={() => send({ kind: "test" })} busy={working} />
      <GuideThread entries={record.thread ?? []} steps={steps} onStep={onStep} busy={working} />
      <p className="field-help">{t.wrong}</p>
    </div>
  );
}
