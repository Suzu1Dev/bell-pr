/**
 * Plan with the guide (DESIGN v1.2 F3), in the team board while the run
 * waits in `awaiting_plan` (and, to split a step, while the person
 * writes), under the guide's summary on the board: the premise check
 * (the board leaves it to this panel), the person's steps first,
 * read-first ranges, the outline folded until a first draft, questions on
 * the plan, and "This is my plan".
 */
import { useEffect, useRef, useState } from "react";
import { ListChecks, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { useFocusHome } from "./focus";
import { byHandLimits, helpAllowed, type ByHandPlanInput } from "../../../shared/by-hand";
import { PremiseNotice } from "../../team/PremiseNotice";
import { PlanCompare } from "./PlanCompare";
import type { Run } from "../../types";
import { CopyRef } from "./CopyRef";
import { PlanQuestions } from "./PlanQuestions";
import { useWriteText } from "./text";
import "./byhand.css";

export interface PlanWithGuideProps {
  run: Run;
  /** Saves the plan (PUT …/by-hand/plan), on blur and before every action. */
  onSave(input: ByHandPlanInput): Promise<void>;
  /** Shows the outline's step names, or both lists side by side (POST …/by-hand/plan/reveal). */
  onReveal(mode: "names" | "compare"): Promise<void>;
  /** "Questions on my plan" (POST …/by-hand/plan/questions, 202). */
  onAskQuestions(): Promise<void>;
  /** "This is my plan" (POST …/plan/approve). */
  onConfirm(): Promise<void>;
  busy?: boolean;
  /** The server's message for a refused action, shown as it is. */
  error?: string;
}

type Draft = { id?: string; title: string; files: string; how: string };

const ignore = () => undefined;

/**
 * The ids the server gave new steps (in the order sent): the n-th written
 * step takes the n-th saved one's id when it still has that title and no
 * other step holds it.
 */
export function withSavedIds<T extends Pick<Draft, "id" | "title">>(drafts: T[], saved: readonly { id: string; title: string }[] = []) {
  const used = new Set(drafts.map((draft) => draft.id));
  let at = -1;
  return drafts.map((draft) => {
    if (!draft.title.trim()) return draft;
    const step = saved[++at];
    if (draft.id || !step || used.has(step.id) || step.title !== draft.title.trim()) return draft;
    used.add(step.id);
    return { ...draft, id: step.id };
  });
}

export function PlanWithGuide(props: PlanWithGuideProps) {
  const { run, onSave, onReveal, onConfirm, busy: requesting = false, error } = props;
  const t = useWriteText().plan;
  const home = useFocusHome<HTMLElement>();
  const record = run.byHand ?? {};
  const saved = record.plan;
  const outline = record.guidePlan;
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    saved?.steps.length ? saved.steps.map((step) => ({ id: step.id, title: step.title, files: (step.files ?? []).join(", "), how: step.how ?? "" })) : [{ title: "", files: "", how: "" }]);
  const [tests, setTests] = useState(saved?.tests ?? "");
  const [unsure, setUnsure] = useState(saved?.unsure ?? "");
  const [prediction, setPrediction] = useState(saved?.prediction ?? "");
  // New steps get their ids from the server; later saves keep them.
  useEffect(() => setDrafts((list) => withSavedIds(list, saved?.steps)), [saved]);
  const plan = (): ByHandPlanInput | undefined => {
    const steps = drafts
      .filter((draft) => draft.title.trim())
      .map(({ id, title, files, how }) => ({
        ...(id ? { id } : {}), title: title.trim(),
        files: files.split(",").map((file) => file.trim()).filter(Boolean),
        ...(how.trim() ? { how: how.trim() } : {}),
      }));
    if (!steps.length) return undefined;
    // An emptied answer is sent empty, so the server drops it rather than keeping the last one.
    return { steps, tests: tests.trim(), unsure: unsure.trim(), prediction: prediction.trim() };
  };
  // What was saved or is on its way, the ids the server gives aside: a blur that changed nothing sends nothing,
  // and a save on blur leaves the buttons on, so the click that took the focus still counts.
  const keyOf = (value = plan()) => JSON.stringify(value ?? null, (name, field) => (name === "id" ? undefined : field));
  const sent = useRef<{ key: string; done?: Promise<void> }>({ key: keyOf() });
  const busy = requesting && !sent.current.done;
  /** Saves what changed since the last save (a refusal rejects, and the next blur tries again). */
  const save = () => {
    const value = plan();
    if (!value || keyOf(value) === sent.current.key) return sent.current.done ?? Promise.resolve();
    const done: Promise<void> = onSave(value).then(
      () => void (sent.current.done === done && delete sent.current.done),
      (cause) => ((sent.current = { key: "" }), Promise.reject(cause)),
    );
    sent.current = { key: keyOf(value), done };
    return done;
  };
  const edit = (index: number, change: Partial<Draft>) =>
    setDrafts((list) => list.map((draft, at) => (at === index ? { ...draft, ...change } : draft)));
  // A step written counts: every action saves the plan first.
  const drafted = (saved?.steps.length ?? 0) > 0 || !!plan();
  const confirmed = !!saved?.confirmedAt;
  const planHelp = helpAllowed(run, "plan");
  const revealed = !!saved?.outlineAt;
  const action = (go: () => Promise<void>) => () => void save().then(go).catch(ignore);
  // The answers before writing stay as confirmed (as the server keeps them), so they're read-only afterwards.
  const field = (id: string, label: string, value: string, set: (value: string) => void, max: number) => (
    <label htmlFor={`${run.id}-${id}`}>
      {label}
      <textarea id={`${run.id}-${id}`} className="text-input" rows={2} maxLength={max} value={value} readOnly={confirmed} onChange={(event) => set(event.target.value)} />
    </label>
  );
  return (
    <section className="by-hand" aria-labelledby={`${run.id}-plan`} onBlur={() => void save().catch(ignore)} {...home}>
      <h3 id={`${run.id}-plan`}>
        <ListChecks size={17} aria-hidden="true" /> {t.title}
      </h3>
      <PremiseNotice premise={run.team?.premise} />
      <p>{t.intro}</p>
      <ol className="by-hand-steps">
        {drafts.map((draft, index) => (
          <li key={draft.id ?? `new-${index}`}>
            <label id={`${run.id}-step-${index}-name`} htmlFor={`${run.id}-step-${index}`}>{t.step({ number: index + 1 })}</label>
            <input id={`${run.id}-step-${index}`} className="text-input" maxLength={byHandLimits.stepTitleChars} value={draft.title} onChange={(event) => edit(index, { title: event.target.value })} />
            <input className="text-input" aria-label={t.files} aria-describedby={`${run.id}-step-${index}-name`} placeholder={t.files} value={draft.files} onChange={(event) => edit(index, { files: event.target.value })} />
            <textarea className="text-input" aria-label={t.how} aria-describedby={`${run.id}-step-${index}-name`} placeholder={t.how} rows={2} maxLength={byHandLimits.stepHowChars} value={draft.how} onChange={(event) => edit(index, { how: event.target.value })} />
            {drafts.length > 1 && (
              <button type="button" className="icon-button" aria-label={t.remove} aria-describedby={`${run.id}-step-${index}-name`} title={t.remove} onClick={() => setDrafts((list) => list.filter((_, at) => at !== index))}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ol>
      {drafts.length < byHandLimits.planSteps && (
        <button type="button" className="mission-text-button" onClick={() => setDrafts((list) => [...list, { title: "", files: "", how: "" }])}>
          <Plus size={14} aria-hidden="true" /> {t.add}
        </button>
      )}
      {field("tests", t.tests, tests, setTests, byHandLimits.planTestsChars)}
      {field("unsure", t.unsure, unsure, setUnsure, byHandLimits.planUnsureChars)}
      {field("prediction", t.prediction, prediction, setPrediction, byHandLimits.predictionChars)}
      <PlanQuestions run={run} onAsk={() => save().then(props.onAskQuestions)} busy={busy} />
      {!!outline?.readFirst?.length && (
        <>
          <h4>{t.readFirst}</h4>
          <ul>
            {outline.readFirst.map((range) => (
              <li key={`${range.path}:${range.startLine}`}>
                <CopyRef text={`${range.path}:${range.startLine}-${range.endLine}`} /> {range.why}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>{t.outline}</h4>
      {!planHelp ? (
        <p className="by-hand-note">{t.closed}</p>
      ) : revealed ? (
        <>
          <ol>
            {(outline?.steps ?? []).map((step, index) => (
              <li key={index}>{step.title}</li>
            ))}
          </ol>
          {saved?.outlineBeforeDraft && <p>{t.early}</p>}
        </>
      ) : (
        <div className="by-hand-row">
          {!drafted && <span>{t.folded}</span>}
          <button type="button" className="button secondary" disabled={busy} onClick={action(() => onReveal(drafted ? "compare" : "names"))}>
            {drafted ? t.names : t.noIdea}
          </button>
        </div>
      )}
      {planHelp && drafted && <PlanCompare run={run} onReveal={() => save().then(() => (revealed ? undefined : onReveal("compare")))} busy={busy} />}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!confirmed && (
        <div className="by-hand-row">
          <button type="button" className="button primary" disabled={busy || !drafted} onClick={action(onConfirm)}>
            {busy ? <Loader2 size={15} className="spin" /> : <Play size={15} aria-hidden="true" />}
            {t.confirm}
          </button>
        </div>
      )}
    </section>
  );
}
