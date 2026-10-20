/**
 * Plan with the guide (DESIGN v1.2 F3), in the team board while the run
 * waits in `awaiting_plan` (and, to split a step, while the person
 * writes): the person's steps first, read-first ranges, the outline folded
 * until a first draft, questions on the plan, and "This is my plan".
 */
import { useEffect, useState } from "react";
import { ListChecks, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { byHandLimits, helpAllowed, type ByHandPlanInput } from "../../../shared/by-hand";
import { PremiseNotice } from "../../team/PremiseNotice";
import type { Run } from "../../types";
import { CopyRef } from "./CopyRef";
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

export function PlanWithGuide(props: PlanWithGuideProps) {
  const { run, onSave, onReveal, onConfirm, busy = false, error } = props;
  const t = useWriteText().plan;
  const record = run.byHand ?? {};
  const saved = record.plan;
  const outline = record.guidePlan;
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    saved?.steps.length
      ? saved.steps.map((step) => ({ id: step.id, title: step.title, files: (step.files ?? []).join(", "), how: step.how ?? "" }))
      : [{ title: "", files: "", how: "" }],
  );
  const [tests, setTests] = useState(saved?.tests ?? "");
  const [unsure, setUnsure] = useState(saved?.unsure ?? "");
  const [prediction, setPrediction] = useState(saved?.prediction ?? "");
  // New steps get their ids from the server; later saves keep them.
  useEffect(() => {
    const ids = saved?.steps.map((step) => step.id) ?? [];
    setDrafts((list) => {
      let at = 0;
      return list.map((draft) => (draft.title.trim() ? { ...draft, id: draft.id ?? ids[at++] } : draft));
    });
  }, [saved]);
  const plan = (): ByHandPlanInput | undefined => {
    const steps = drafts
      .filter((draft) => draft.title.trim())
      .map(({ id, title, files, how }) => ({
        ...(id ? { id } : {}),
        title: title.trim(),
        files: files.split(",").map((file) => file.trim()).filter(Boolean),
        ...(how.trim() ? { how: how.trim() } : {}),
      }));
    if (!steps.length) return undefined;
    const optional = (key: "tests" | "unsure" | "prediction", value: string) => (value.trim() ? { [key]: value.trim() } : {});
    return { steps, ...optional("tests", tests), ...optional("unsure", unsure), ...optional("prediction", prediction) };
  };
  const [last, setLast] = useState("");
  /** Saves what changed since the last save; the caller shows a refusal. */
  const save = async () => {
    const value = plan();
    const key = JSON.stringify(value ?? null);
    if (!value || key === last) return;
    await onSave(value);
    setLast(key);
  };
  const edit = (index: number, change: Partial<Draft>) =>
    setDrafts((list) => list.map((draft, at) => (at === index ? { ...draft, ...change } : draft)));
  // A step written counts: every action saves the plan first.
  const drafted = (saved?.steps.length ?? 0) > 0 || !!plan();
  const confirmed = !!saved?.confirmedAt;
  const planHelp = helpAllowed(run, "plan");
  const revealed = !!saved?.outlineAt;
  const action = (go: () => Promise<void>) => () => void save().then(go).catch(ignore);
  const field = (id: string, label: string, value: string, set: (value: string) => void, max: number) => (
    <label htmlFor={`${run.id}-${id}`}>
      {label}
      <textarea id={`${run.id}-${id}`} className="text-input" rows={2} maxLength={max} value={value} onChange={(event) => set(event.target.value)} />
    </label>
  );
  return (
    <section className="by-hand" aria-labelledby={`${run.id}-plan`} onBlur={() => void save().catch(ignore)}>
      <h3 id={`${run.id}-plan`}>
        <ListChecks size={17} aria-hidden="true" /> {t.title}
      </h3>
      <PremiseNotice premise={run.team?.premise} />
      {outline?.summary && (
        <details>
          <summary>{t.summary}</summary>
          <p>{outline.summary}</p>
        </details>
      )}
      <p>{t.intro}</p>
      <ol className="by-hand-steps">
        {drafts.map((draft, index) => (
          <li key={draft.id ?? `new-${index}`}>
            <label htmlFor={`${run.id}-step-${index}`}>{t.step({ number: index + 1 })} · {t.stepTitle}</label>
            <input id={`${run.id}-step-${index}`} className="text-input" maxLength={byHandLimits.stepTitleChars} value={draft.title} onChange={(event) => edit(index, { title: event.target.value })} />
            <input className="text-input" aria-label={t.files} placeholder={t.files} value={draft.files} onChange={(event) => edit(index, { files: event.target.value })} />
            <textarea className="text-input" aria-label={t.how} placeholder={t.how} rows={2} maxLength={byHandLimits.stepHowChars} value={draft.how} onChange={(event) => edit(index, { how: event.target.value })} />
            {drafts.length > 1 && (
              <button type="button" className="icon-button" aria-label={t.remove} title={t.remove} onClick={() => setDrafts((list) => list.filter((_, at) => at !== index))}>
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
