/**
 * The coach debrief (Pro), the learning page's Coach debrief view (loaded
 * on its own).
 *
 * For one project with an approved or published contribution, **Debrief
 * my contributions to this project** asks POST /api/learning/debrief for a
 * model-written reading of the person's own records: the taste dimension
 * maintainers raised most, with quotes the server checked against the
 * records; up to 3 drills built from the person's own changes, shown as
 * two versions and a question before the trade-off; and one next step.
 * On Free the button carries the PRO badge and opens the upgrade dialog
 * without a request. Stored debriefs (GET /api/learning/debriefs) are read
 * on every plan. The demo shows the sample debrief, labelled PRO, and
 * calls neither route.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { CoachDebrief, CoachDrill } from "../../shared/coach";
import { ApiError, ProRequiredError, api, send } from "../api";
import { usePresentation } from "../app/presentation";
import { getDemo } from "../demo";
import { useFormat, useLocale, useT } from "../i18n";
import { ProBadge } from "../license/ProBadge";
import { requestUpgrade, useEntitlements } from "../license/useEntitlements";
import type { Repo, RunSummary } from "../types";
import { practiceChangedEvent } from "./practiceReady";

/** A status without a license: the plan then comes from /api/license. */
const noStatus = {};

/** The runs that make a project eligible for a debrief. */
const debriefedStatuses: readonly string[] = ["approved", "published"];

/** What a debrief needs of a run. */
export type DebriefRun = Pick<RunSummary, "repoId" | "status" | "createdAt">;

/** GET /api/runs, for the projects with an approved or published run. */
export async function fetchRuns(signal?: AbortSignal): Promise<DebriefRun[]> {
  return (await api<{ runs: DebriefRun[] }>("/runs", { signal })).runs ?? [];
}

/** GET /api/learning/debriefs?repoId=; a server without the route has none. */
export async function fetchDebriefs(
  repoId: string,
  signal?: AbortSignal,
): Promise<CoachDebrief[]> {
  try {
    const { debriefs } = await api<{ debriefs?: CoachDebrief[] }>(
      `/learning/debriefs?repoId=${encodeURIComponent(repoId)}`,
      { signal },
    );
    return debriefs ?? [];
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 404) return [];
    throw failure;
  }
}

/** POST /api/learning/debrief (Pro). */
export async function requestDebrief(repoId: string): Promise<CoachDebrief> {
  return (
    await api<{ debrief: CoachDebrief }>("/learning/debrief", send("POST", { repoId }))
  ).debrief;
}

/** Newest first, whatever order the server keeps them in. */
const newestFirst = (debriefs: readonly CoachDebrief[]) =>
  [...debriefs].sort((a, b) => b.at.localeCompare(a.at));

/**
 * The projects a debrief can read: those with an approved or published
 * run, the one worked on last first.
 */
export function debriefProjects(repos: readonly Repo[], runs: readonly DebriefRun[]) {
  const latest = new Map<string, string>();
  for (const run of runs)
    if (debriefedStatuses.includes(run.status)) {
      const seen = latest.get(run.repoId);
      if (!seen || run.createdAt > seen) latest.set(run.repoId, run.createdAt);
    }
  const lastRun = (repo: Repo) => latest.get(repo.id) ?? "";
  return repos
    .filter((repo) => latest.has(repo.id))
    .sort((a, b) => lastRun(b).localeCompare(lastRun(a)));
}

/** One drill: the two versions and the question, then the trade-off. */
function Drill({ drill, number }: { drill: CoachDrill; number: number }) {
  const t = useT("learning").debrief;
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="debrief-drill">
      <h4>{t.drill({ number })}</h4>
      <p>{drill.context}</p>
      <div className="debrief-options">
        <div>
          <strong>{t.versionA}</strong>
          <p>{drill.optionA}</p>
        </div>
        <div>
          <strong>{t.versionB}</strong>
          <p>{drill.optionB}</p>
        </div>
      </div>
      <p className="debrief-question">{drill.question}</p>
      <button
        type="button"
        className="button secondary"
        aria-expanded={shown}
        aria-controls={`${id}-trade-off`}
        onClick={() => setShown((value) => !value)}
      >
        {shown ? t.hideTradeOff : t.showTradeOff}
      </button>
      <div id={`${id}-trade-off`} className="debrief-trade-off" hidden={!shown}>
        <strong>{t.tradeOff}</strong>
        <p>{drill.reveal}</p>
      </div>
    </div>
  );
}

/** A stored debrief: the recurring dimension with quotes, the drills, the next step. */
export function DebriefCard({ debrief }: { debrief: CoachDebrief }) {
  const t = useT("learning");
  const d = t.debrief;
  const fmt = useFormat();
  const recurring = debrief.recurring;
  return (
    <article className="debrief-card">
      <div className="debrief-meta">
        <span className="note-ai-label">{d.aiWritten}</span>
        <span>{d.written({ date: fmt.date(debrief.at) })}</span>
        <span>{d.read({ count: debrief.runIds.length })}</span>
      </div>
      {recurring && (
        <div className="debrief-recurring">
          <h3>
            {d.recurring({
              dimension: t.dimensions[recurring.dimension] ?? recurring.dimension,
            })}
          </h3>
          {recurring.quotes.length > 0 && (
            <>
              <p className="debrief-label">{d.quotes}</p>
              {recurring.quotes.map((quote, index) => (
                <blockquote key={index}>{quote}</blockquote>
              ))}
            </>
          )}
        </div>
      )}
      {!!debrief.drills?.length && (
        <div className="debrief-drills">
          <h3>{d.drills}</h3>
          {debrief.drills.map((drill, index) => (
            <Drill key={index} drill={drill} number={index + 1} />
          ))}
        </div>
      )}
      <div className="debrief-next">
        <h3>{d.nextStep}</h3>
        <p>{debrief.nextStep}</p>
      </div>
    </article>
  );
}

/** The built-in sample's debrief, labelled as a sample of a Pro feature. */
function SampleDebrief() {
  const t = useT("learning");
  const [locale] = useLocale();
  const sample = getDemo(locale).debriefSample;
  if (!sample) return null;
  return (
    <section className="learning-demo debrief-sample" aria-labelledby="debrief-sample-title">
      <h2 id="debrief-sample-title">
        {t.debrief.sampleTitle}
        <span className="learning-demo-label">{t.demoTag}</span>
        <ProBadge />
      </h2>
      <p>{t.debrief.sampleIntro}</p>
      <DebriefCard debrief={sample} />
    </section>
  );
}

type Stored =
  | { status: "loading" }
  | { status: "failed"; error: string }
  | { status: "ready"; debriefs: CoachDebrief[] };

export interface CoachDebriefPanelProps {
  repos: Repo[];
  /** The demo (`demo=play`): only the sample, and no request. */
  demo?: boolean;
  /** Whether the plan locks the debrief; from the license by default. */
  locked?: boolean;
  /** The runs already read; GET /api/runs by default. */
  runs?: DebriefRun[];
  /** The selected project's stored debriefs, already read. */
  debriefs?: CoachDebrief[];
}

export function CoachDebriefPanel({
  repos,
  demo: demoFlag,
  locked: lockedFlag,
  runs: givenRuns,
  debriefs: givenDebriefs,
}: CoachDebriefPanelProps) {
  const t = useT("learning").debrief;
  const id = useId();
  const { play } = usePresentation();
  const demo = demoFlag ?? play;
  const plan = useEntitlements(noStatus);
  const locked = lockedFlag ?? plan.locked("coachDebrief", { demo });
  const [runs, setRuns] = useState<DebriefRun[] | undefined>(givenRuns);
  const [chosen, setChosen] = useState("");
  const [stored, setStored] = useState<Stored>(
    givenDebriefs ? { status: "ready", debriefs: newestFirst(givenDebriefs) } : { status: "loading" },
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const latest = useRef(0);

  const hasRuns = !!givenRuns;
  useEffect(() => {
    if (demo || hasRuns) return;
    const controller = new AbortController();
    fetchRuns(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setRuns(value);
      },
      () => {
        if (!controller.signal.aborted) setRuns([]);
      },
    );
    return () => controller.abort();
  }, [demo, hasRuns]);

  const projects = useMemo(() => debriefProjects(repos, runs ?? []), [repos, runs]);
  const repoId = projects.some((repo) => repo.id === chosen) ? chosen : (projects[0]?.id ?? "");
  const shownRepo = useRef(repoId);
  shownRepo.current = repoId;

  const hasDebriefs = !!givenDebriefs;
  useEffect(() => {
    if (demo || hasDebriefs || !repoId) return;
    const request = ++latest.current;
    const controller = new AbortController();
    setStored({ status: "loading" });
    fetchDebriefs(repoId, controller.signal).then(
      (debriefs) => {
        if (request === latest.current) setStored({ status: "ready", debriefs: newestFirst(debriefs) });
      },
      (failure: unknown) => {
        if (request === latest.current && !controller.signal.aborted)
          setStored({ status: "failed", error: failure instanceof Error ? failure.message : String(failure) });
      },
    );
    return () => controller.abort();
  }, [demo, hasDebriefs, repoId]);

  async function debrief() {
    if (locked) {
      requestUpgrade("coachDebrief");
      return;
    }
    if (working || !repoId) return;
    const forRepo = repoId;
    setWorking(true);
    setError("");
    setDone("");
    try {
      const written = await requestDebrief(forRepo);
      if (forRepo === shownRepo.current)
        setStored((value) => ({
          status: "ready",
          debriefs: newestFirst([written, ...(value.status === "ready" ? value.debriefs : [])]),
        }));
      setDone(t.ready);
      // Its drills join the practice deck.
      window.dispatchEvent(new Event(practiceChangedEvent));
    } catch (failure) {
      // A 402 opens the upgrade dialog; it says what is needed.
      if (!(failure instanceof ProRequiredError))
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setWorking(false);
    }
  }

  const own = stored.status === "ready" ? stored.debriefs : [];
  const showSample = demo || (runs !== undefined && (!repoId || (stored.status !== "loading" && !own.length)));

  return (
    <section className="debrief" aria-labelledby="debrief-title">
      <div className="practice-head">
        <h2 id="debrief-title">{t.title}</h2>
        <p>{t.intro}</p>
      </div>
      {!demo && (
        <div className="debrief-request">
          {runs === undefined ? (
            <p className="practice-help" role="status" aria-busy="true">
              <LoaderCircle className="spin" size={14} aria-hidden="true" /> {t.loadingProjects}
            </p>
          ) : !projects.length ? (
            <p className="practice-help">{t.noProjects}</p>
          ) : (
            <>
              <div className="debrief-request-row">
                <label className="debrief-project">
                  <span>{t.project}</span>
                  <select
                    value={repoId}
                    disabled={working}
                    onChange={(event) => {
                      setChosen(event.target.value);
                      setDone("");
                      setError("");
                    }}
                  >
                    {projects.map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {repo.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button primary"
                  disabled={working}
                  aria-describedby={locked ? `${id}-locked` : undefined}
                  onClick={() => void debrief()}
                >
                  {working ? (
                    <LoaderCircle className="spin" size={15} aria-hidden="true" />
                  ) : (
                    <Sparkles size={15} aria-hidden="true" />
                  )}
                  {t.request}
                  {locked && <ProBadge />}
                </button>
              </div>
              {locked && (
                <p id={`${id}-locked`} className="practice-help">
                  {t.locked}
                </p>
              )}
              <p className="practice-help" role="status" aria-busy={working || undefined}>
                {working ? t.working : done}
              </p>
              {error && (
                <p className="inline-error" role="alert">
                  {t.failed({ error })}
                </p>
              )}
            </>
          )}
        </div>
      )}
      {!demo && repoId && (
        stored.status === "loading" ? (
          <p className="practice-help" role="status" aria-busy="true">
            <LoaderCircle className="spin" size={14} aria-hidden="true" /> {t.loading}
          </p>
        ) : stored.status === "failed" ? (
          <p className="inline-error" role="alert">
            {t.loadFailed({ error: stored.error })}
          </p>
        ) : own.length ? (
          <div className="debrief-list">
            {own.map((value) => (
              <DebriefCard key={value.at} debrief={value} />
            ))}
          </div>
        ) : (
          <p className="practice-help">{t.none}</p>
        )
      )}
      {showSample && <SampleDebrief />}
    </section>
  );
}
