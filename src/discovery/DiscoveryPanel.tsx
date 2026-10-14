import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Compass,
  ExternalLink,
  FolderGit2,
  GitFork,
  Languages,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import {
  defaultDiscoveryPreferences,
  type ContributionOpportunity,
  type DiscoveryCandidate,
  type DiscoveryJob,
  type DiscoveryPreferences,
} from "../../shared/discovery";
import {
  agentProviders,
  providerLabels,
  type AgentProvider,
  type ModelCatalog,
  type ReasoningEffort,
} from "../../shared/models";
import {
  trialDays,
  type Entitlements,
  type LicenseSummary,
} from "../../shared/plans";
import { api, send } from "../api";
import { usePresentation } from "../app/presentation";
import { getSampleDiscoveryJob } from "../demo/discovery";
import { useFormat, useLocale, useT } from "../i18n";
import { ProBadge } from "../license/ProBadge";
import { requestUpgrade, startTrial } from "../license/useEntitlements";
import { usePlan } from "../mission/plan";
import { providerReadiness, withProvider } from "../mission/readiness";
import { ModelSummary } from "../models/ModelSummary";
import { EfficiencySummary } from "../efficiency/EfficiencySummary";
import { MarkdownContent } from "../review/MarkdownContent";
import { ReadinessMessage, readinessOf } from "../setup/ReadinessNotice";
import { useDoctor, type DoctorState } from "../setup/useDoctor";
import "../review/review.css";
import "./discovery.css";

/** Search orders in the order the form offers them. */
const sortOptions: DiscoveryPreferences["sort"][] = [
  "updated",
  "relevance",
  "stars",
];
const phaseSteps = ["searching", "screening", "analyzing"] as const;
/** The four angles every opportunity is weighed from, in display order. */
const angles = ["rules", "activity", "needs", "barrier"] as const;

/** Whether a saved job has results to read, or is still running. */
function hasResults(job: DiscoveryJob | null) {
  return (
    !!job &&
    (job.status === "running" ||
      job.opportunities.length > 0 ||
      !!job.previousResult?.opportunities.length)
  );
}

export default function DiscoveryPanel({
  onChoose,
  initialJob,
  entitlements,
  license,
  demo: demoProp,
  doctor,
}: {
  onChoose: (
    opportunity: ContributionOpportunity,
    candidate: DiscoveryCandidate,
  ) => void | Promise<void>;
  /**
   * A job to show, with its preferences, before the saved one has loaded,
   * such as a fixture in tests. The panel still loads the saved job when it
   * mounts.
   */
  initialJob?: DiscoveryJob | null;
  /** What the plan unlocks, when the parent knows it; read otherwise. */
  entitlements?: Entitlements;
  /** The license summary (GET /api/status), for the trial button. */
  license?: LicenseSummary;
  /**
   * The sample project: the sample results with a PRO chip, and nothing
   * is sent to the server. Default: the `demo=play` flag.
   */
  demo?: boolean;
  /** A useDoctor() state to share; the panel loads its own otherwise. */
  doctor?: DoctorState;
}) {
  const t = useT("discovery");
  const effortLabels = useT("common").reasoningEffort;
  const fmt = useFormat();
  const [locale] = useLocale();
  const presentation = usePresentation();
  const demo = demoProp ?? presentation.play;
  const plan = usePlan({ entitlements, license, demo });
  // Discovery is Pro: Free sees sample results and never sends a search.
  // While the plan is read nothing is sent either.
  const locked = plan.locked("discovery");
  const live = !demo && !locked && !plan.checking;
  const sampleJob = useMemo(() => getSampleDiscoveryJob(locale), [locale]);
  const date = (value: string) => (value ? fmt.dateTime(value) : undefined);
  const [preferences, setPreferences] = useState<DiscoveryPreferences>(() => ({
    ...(initialJob?.preferences ??
      (demo ? sampleJob.preferences : defaultDiscoveryPreferences)),
  }));
  const [job, setJob] = useState<DiscoveryJob | null>(initialJob ?? null);
  const [loading, setLoading] = useState(initialJob === undefined && !demo);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState("");
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<ModelCatalog>({
    source: "codex",
    models: [],
  });
  const mounted = useRef(false);
  const epoch = useRef(0);
  const reads = useRef(0);
  const mutating = useRef(false);
  const polling = useRef(false);
  const running = job?.status === "running";

  async function reload(restorePreferences = false) {
    const requestEpoch = epoch.current;
    const requestId = ++reads.current;
    try {
      const result = await api<{ job: DiscoveryJob | null }>("/discovery");
      if (
        !mounted.current ||
        requestEpoch !== epoch.current ||
        requestId !== reads.current ||
        mutating.current
      )
        return;
      setJob(result.job);
      setError("");
      if (restorePreferences && result.job)
        setPreferences(result.job.preferences);
    } catch (cause) {
      if (
        mounted.current &&
        requestEpoch === epoch.current &&
        requestId === reads.current
      )
        setError((cause as Error).message);
    } finally {
      if (
        mounted.current &&
        requestEpoch === epoch.current &&
        requestId === reads.current
      )
        setLoading(false);
    }
  }
  const provider = preferences.provider ?? "codex";
  const providerLabel = providerLabels[provider];
  useEffect(() => {
    mounted.current = true;
    // The demo shows the sample; results already saved stay readable on Free.
    if (!demo) void reload(true);
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, [demo]);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog({ source: provider, models: [] });
    void api<ModelCatalog>(`/models?provider=${provider}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setCatalog(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setCatalog({
            source: provider,
            models: [],
            error: (cause as Error).message,
          });
      });
    return () => controller.abort();
  }, [provider]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (mutating.current || polling.current) return;
      polling.current = true;
      void reload().finally(() => {
        polling.current = false;
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [running, job?.id]);

  async function mutate(cancel = false) {
    if (mutating.current) return;
    // Never POST /api/discovery without Pro; cancelling stays open.
    if (!cancel && !live) return;
    mutating.current = true;
    epoch.current++;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ job: DiscoveryJob | null }>(
        cancel ? "/discovery/cancel" : "/discovery",
        send("POST", cancel ? {} : preferences),
      );
      if (mounted.current) setJob(result.job);
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      epoch.current++;
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function choose(
    opportunity: ContributionOpportunity,
    candidate: DiscoveryCandidate,
  ) {
    setChoosing(opportunity.id);
    setError("");
    try {
      await onChoose(opportunity, candidate);
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      if (mounted.current) setChoosing("");
    }
  }
  const update = (value: Partial<DiscoveryPreferences>) =>
    setPreferences((previous) => ({ ...previous, ...value }));
  const selectedModel =
    catalog.models.find((value) => value.id === preferences.model) ??
    (!preferences.model
      ? catalog.models.find((value) => value.isDefault)
      : undefined);
  // Free (and the demo) show the sample unless saved results are there to read.
  const sampleShown = demo || (locked && !loading && !hasResults(job));
  const shown = sampleShown ? sampleJob : job;
  const sample = shown?.sample === true;
  const previous = !shown?.opportunities.length
    ? shown?.previousResult
    : undefined;
  const opportunities = previous
    ? previous.opportunities
    : (shown?.opportunities ?? []);
  const candidates = previous
    ? previous.candidates
    : (shown?.candidates ?? []);
  const disabled = loading || busy || running || !!choosing;
  // Until the plan is known it is not clear whether the sample shows.
  const settling = loading || (!demo && plan.checking);
  // Saved results in another language than the UI's say so.
  const resultsLocale =
    !sample && shown?.locale && shown.locale !== locale
      ? shown.locale
      : undefined;
  // A live search needs the GitHub CLI and the chosen provider.
  const ownDoctor = useDoctor({ enabled: live && !doctor });
  const report = live ? (doctor ?? ownDoctor).report : null;
  const readiness = report
    ? withProvider(readinessOf(report, ["gh"]), providerReadiness(report, provider))
    : undefined;
  // The demo's button stays open: it shows the sample results.
  const submitDisabled =
    disabled ||
    (!demo && (!live || (readiness !== undefined && !readiness.ready)));
  const trialOffered =
    plan.summary?.trialAvailable !== false && plan.summary?.envLocked !== true;
  const [trialStarting, setTrialStarting] = useState(false);
  const [trialError, setTrialError] = useState("");
  async function beginTrial() {
    setTrialStarting(true);
    setTrialError("");
    try {
      // The license change unlocks the form through usePlan.
      await startTrial();
    } catch (cause) {
      if (mounted.current) setTrialError((cause as Error).message);
    } finally {
      if (mounted.current) setTrialStarting(false);
    }
  }

  return (
    <div className="discovery-page">
      <header className="discovery-hero">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>
            {t.title.lead}
            <br />
            <em>{t.title.emphasis}</em>
          </h1>
          <p>
            {t.intro.lead}
            <br className="discovery-desktop-break" />
            {t.intro.rest}
          </p>
        </div>
        <div className="discovery-hero-art" aria-hidden="true">
          <span className="discovery-orbit">
            <Compass size={58} strokeWidth={1.2} />
          </span>
          <span className="discovery-orbit-label">
            <FolderGit2 size={15} /> {t.heroCaption}
          </span>
          <span className="discovery-hero-dot" />
        </div>
      </header>
      <form
        className="discovery-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          // The demo searches nothing: its sample results are the answer.
          if (demo)
            document
              .getElementById("discovery-results")
              ?.scrollIntoView({ block: "start" });
          else void mutate();
        }}
      >
        <div className="discovery-section-label">
          <Search size={17} />
          <h2>{t.form.heading}</h2>
          {plan.marked("discovery") && <ProBadge />}
          <span>{t.form.hint}</span>
        </div>
        <fieldset disabled={!!disabled || locked} className="discovery-fields">
          <label className="discovery-interest">
            {t.form.interests}
            <input
              value={preferences.interests}
              maxLength={300}
              onChange={(event) => update({ interests: event.target.value })}
              placeholder={t.form.interestsPlaceholder}
            />
            <small>{t.form.interestsHint}</small>
          </label>
          <label>
            {t.form.language}
            <input
              value={preferences.language}
              maxLength={40}
              onChange={(event) => update({ language: event.target.value })}
              placeholder={t.form.languagePlaceholder}
              list="discovery-languages"
            />
            <datalist id="discovery-languages">
              {[
                "TypeScript",
                "JavaScript",
                "Python",
                "Go",
                "Rust",
                "Java",
                "C++",
              ].map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>
          <label>
            {t.form.difficulty}
            <select
              value={preferences.difficulty}
              onChange={(event) =>
                update({
                  difficulty: event.target
                    .value as DiscoveryPreferences["difficulty"],
                })
              }
            >
              <option value="beginner">{t.form.difficulties.beginner}</option>
              <option value="intermediate">
                {t.form.difficulties.intermediate}
              </option>
              <option value="any">{t.form.difficulties.any}</option>
            </select>
          </label>
          <label>
            {t.form.sort}
            <select
              value={preferences.sort}
              onChange={(event) =>
                update({
                  sort: event.target.value as DiscoveryPreferences["sort"],
                })
              }
            >
              {sortOptions.map((value) => (
                <option key={value} value={value}>
                  {t.sorts[value]}
                </option>
              ))}
            </select>
            <small>{t.form.sortHint}</small>
          </label>
          <label>
            {t.form.minStars}
            <input
              type="number"
              min={0}
              max={1000000}
              required
              value={preferences.minStars}
              onChange={(event) =>
                update({ minStars: event.target.valueAsNumber })
              }
            />
          </label>
        </fieldset>
        <details className="discovery-advanced">
          <summary>{t.form.advanced}</summary>
          <fieldset
            disabled={!!disabled || locked}
            className="discovery-fields discovery-model-fields"
          >
            <label>
              {t.form.agent}
              <select
                value={provider}
                onChange={(event) =>
                  update({
                    provider: event.target.value as AgentProvider,
                    model: "",
                    reasoningEffort: "",
                  })
                }
              >
                {agentProviders.map((value) => (
                  <option key={value} value={value}>
                    {providerLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.form.model}
              <select
                value={preferences.model || ""}
                onChange={(event) =>
                  update({ model: event.target.value, reasoningEffort: "" })
                }
              >
                <option value="">
                  {t.form.defaultModel({ provider: providerLabel })}
                </option>
                {preferences.model &&
                  !catalog.models.some(
                    (item) => item.id === preferences.model,
                  ) && (
                    <option value={preferences.model}>
                      {t.form.modelNotInCatalog({ model: preferences.model })}
                    </option>
                  )}
                {catalog.models.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.form.reasoningEffort}
              <select
                value={preferences.reasoningEffort || ""}
                onChange={(event) =>
                  update({
                    reasoningEffort: event.target.value as ReasoningEffort | "",
                  })
                }
              >
                <option value="">{t.form.modelDefault}</option>
                {preferences.reasoningEffort &&
                  !selectedModel?.reasoningEfforts.includes(
                    preferences.reasoningEffort,
                  ) && (
                    <option value={preferences.reasoningEffort}>
                      {t.form.effortNotInCatalog({
                        effort: effortLabels[preferences.reasoningEffort],
                      })}
                    </option>
                  )}
                {selectedModel?.reasoningEfforts.map((value) => (
                  <option key={value} value={value}>
                    {effortLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label title={t.form.ponytailCredit}>
              {t.form.ponytailMode}
              <select
                value={preferences.ponytailMode}
                onChange={(event) =>
                  update({
                    ponytailMode: event.target
                      .value as DiscoveryPreferences["ponytailMode"],
                  })
                }
              >
                <option value="lite">{t.form.ponytailModes.lite}</option>
                <option value="full">{t.form.ponytailModes.full}</option>
                <option value="off">{t.form.ponytailModes.off}</option>
              </select>
            </label>
          </fieldset>
          <p className="discovery-hint">
            {catalog.error ||
              t.form.accountHint({ provider: providerLabel })}
          </p>
        </details>
        <div className="discovery-form-footer">
          <p>
            <ShieldCheck size={15} /> {t.form.publicDataOnly}
          </p>
          <button
            type="submit"
            className="button primary"
            disabled={submitDisabled}
          >
            {busy || running ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <Sparkles size={17} />
            )}
            {t.form.submit}
            {plan.marked("discovery") && <ProBadge />}
          </button>
        </div>
        {readiness && (
          <ReadinessMessage
            readiness={readiness}
            maskUser={presentation.maskUser}
          />
        )}
        {locked && (
          <div className="discovery-locked">
            <p>
              <Lock size={15} aria-hidden="true" />
              <span>{t.locked.body}</span>
            </p>
            <div className="discovery-locked-actions">
              {trialOffered && (
                <button
                  type="button"
                  className="button primary"
                  disabled={trialStarting}
                  onClick={() => void beginTrial()}
                >
                  {trialStarting && <Loader2 size={16} className="spin" />}
                  {t.locked.startTrial({ days: trialDays })}
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={() => requestUpgrade("discovery")}
              >
                {t.locked.upgrade}
              </button>
            </div>
            {trialError && (
              <p className="discovery-locked-error" role="alert">
                {trialError}
              </p>
            )}
          </div>
        )}
      </form>
      {error && (
        <div className="discovery-alert" role="alert">
          <span>{error}</span>
          <button
            className="button secondary"
            onClick={() => void reload()}
            disabled={busy}
          >
            {t.reload}
          </button>
        </div>
      )}
      {settling && (
        <p className="discovery-status" role="status">
          <Loader2 size={18} className="spin" />
          {t.loading}
        </p>
      )}
      {running && (
        <section className="discovery-progress" aria-label={t.progress.label}>
          <div className="discovery-progress-top">
            <div>
              <span className="eyebrow">{t.progress.eyebrow}</span>
              <h2 role="status">{job.message}</h2>
            </div>
            <button
              className="button secondary"
              onClick={() => void mutate(true)}
              disabled={busy}
            >
              <X size={15} />
              {t.progress.stop}
            </button>
          </div>
          <ol>
            {phaseSteps.map((phase, index) => {
              const current = phaseSteps.indexOf(
                job.phase as (typeof phaseSteps)[number],
              );
              return (
                <li
                  key={phase}
                  className={index <= current ? "is-current" : ""}
                >
                  <span>
                    {index < current ? <Check size={15} /> : `0${index + 1}`}
                  </span>
                  <div>
                    <strong>{t.progress.phases[phase].title}</strong>
                    <small>{t.progress.phases[phase].detail}</small>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {sample && (
        <div className="discovery-sample-banner" role="note">
          <strong>{t.sample.title}</strong>
          <ProBadge />
          <span>{t.sample.body}</span>
        </div>
      )}
      {shown && !running && (
        <div
          className={`discovery-status ${shown.status === "failed" ? "has-error" : ""}`}
          role="status"
        >
          <span>{shown.error || shown.message}</span>
          <small>{t.searchedAt({ date: date(shown.createdAt) })}</small>
        </div>
      )}
      {resultsLocale && (
        <p className="discovery-locale-notice" role="status">
          <Languages size={15} aria-hidden="true" />
          <span>
            {live
              ? t.localeNotice.searchAgain({
                  language: t.languages[resultsLocale],
                  current: t.languages[locale],
                })
              : t.localeNotice.writtenIn({
                  language: t.languages[resultsLocale],
                })}
          </span>
        </p>
      )}
      {!!shown?.warnings.length && (
        <details className="discovery-limitations">
          <summary>{t.limitations({ count: shown.warnings.length })}</summary>
          <ul>
            {shown.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {!settling && !running && !opportunities.length && (
        <section className="discovery-empty">
          <Compass size={34} strokeWidth={1.3} />
          <h2>{shown ? t.empty.retryTitle : t.empty.title}</h2>
          <p>{shown ? t.empty.retryBody : t.empty.body}</p>
          <div>
            {angles.map((angle, index) => (
              <div key={angle}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{t.empty.angles[angle].title}</strong>
                <small>{t.empty.angles[angle].detail}</small>
              </div>
            ))}
          </div>
        </section>
      )}
      {!!opportunities.length && (
        <section
          className="discovery-results"
          id="discovery-results"
          aria-label={t.results.label}
        >
          <div className="discovery-results-heading">
            <div>
              <span className="eyebrow">
                {previous ? t.results.previousEyebrow : t.results.eyebrow}
              </span>
              <h2>{previous ? t.results.previousTitle : t.results.title}</h2>
              <p>
                {previous
                  ? t.results.previousNote({ date: date(previous.createdAt) })
                  : sample
                    ? t.results.sampleNote
                    : t.results.note({
                        sort: t.sorts[shown?.preferences.sort ?? "updated"],
                      })}
              </p>
            </div>
            <span className="discovery-count">
              {t.results.count({ count: opportunities.length })}
            </span>
          </div>
          {opportunities.map((item, index) => {
            const candidate = candidates.find(
              (value) => value.fullName === item.repository,
            );
            if (!candidate) return null;
            return (
              <article
                className="discovery-opportunity"
                key={`${previous?.createdAt || shown?.id}:${item.id}`}
              >
                <header>
                  <span className="discovery-rank">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    {candidate.url ? (
                      <a
                        className="discovery-repo-link"
                        href={candidate.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <FolderGit2 size={16} />
                        {candidate.fullName}
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      // Sample repositories are fictional: no link.
                      <span className="discovery-repo-link">
                        <FolderGit2 size={16} />
                        {candidate.fullName}
                      </span>
                    )}
                    <p className="discovery-repo-description">
                      {candidate.description}
                    </p>
                  </div>
                  <span className="discovery-difficulty">
                    {t.difficulties[item.difficulty]}
                  </span>
                </header>
                <div className="discovery-repo-stats">
                  <span>
                    <Star size={14} />
                    {fmt.number(candidate.stars)}
                  </span>
                  <span>
                    <GitFork size={14} />
                    {fmt.number(candidate.forks)}
                  </span>
                  <span>{candidate.language || t.card.languageUnknown}</span>
                  <span>
                    {t.card.lastPush({
                      date: candidate.pushedAt?.slice(0, 10) || undefined,
                    })}
                  </span>
                </div>
                <div className="discovery-opportunity-main">
                  <h3>{item.title}</h3>
                  <MarkdownContent>{item.summary}</MarkdownContent>
                  <div className="discovery-need">
                    <Users size={20} />
                    <div>
                      <h4>{t.card.whoItHelps}</h4>
                      <MarkdownContent>{item.userNeed}</MarkdownContent>
                    </div>
                  </div>
                  <div className="discovery-assessment">
                    <div>
                      <h4>{t.card.whyItFits}</h4>
                      <MarkdownContent>{item.feasibility}</MarkdownContent>
                    </div>
                    <div>
                      <h4>{t.card.effort}</h4>
                      <MarkdownContent>{item.effort}</MarkdownContent>
                      <small>{t.card.effortNote}</small>
                    </div>
                  </div>
                </div>
                <details className="discovery-card-details">
                  <summary>
                    <ShieldCheck size={16} />
                    {t.card.rulesSummary}
                  </summary>
                  <div>
                    <h4>{t.card.rules}</h4>
                    <MarkdownContent>{item.contributionRules}</MarkdownContent>
                    <h4>{t.card.popularity}</h4>
                    <MarkdownContent>{item.popularity}</MarkdownContent>
                    {candidate.warnings.length > 0 && (
                      <ul className="discovery-source-warnings">
                        {candidate.warnings.map((value, i) => (
                          <li key={i}>{value}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
                <details className="discovery-card-details">
                  <summary>
                    <Compass size={16} />
                    {t.card.planSummary}
                  </summary>
                  <div className="discovery-plan">
                    <div>
                      <h4>{t.card.firstSteps}</h4>
                      <ol>
                        {item.firstSteps.map((value, i) => (
                          <li key={i}>
                            <MarkdownContent>{value}</MarkdownContent>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <h4>{t.card.acceptanceChecks}</h4>
                      <ul>
                        {item.acceptanceChecks.map((value, i) => (
                          <li key={i}>
                            <MarkdownContent>{value}</MarkdownContent>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="discovery-plan-risks">
                      <h4>{t.card.risks}</h4>
                      <ul>
                        {item.risks.map((value, i) => (
                          <li key={i}>
                            <MarkdownContent>{value}</MarkdownContent>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>
                <details className="discovery-card-details">
                  <summary>
                    <ExternalLink size={16} />
                    {t.card.evidence({ count: item.evidence.length })}
                  </summary>
                  <div className="discovery-evidence">
                    {item.evidence.map((evidence, i) => {
                      const source = candidate.sources.find(
                        (value) => value.id === evidence.sourceId,
                      );
                      return (
                        source && (
                          <div key={i}>
                            {source.url ? (
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {source.title}
                                <ArrowUpRight size={14} />
                              </a>
                            ) : (
                              <span className="discovery-source-title">
                                {source.title}
                              </span>
                            )}
                            <blockquote>
                              <MarkdownContent>
                                {evidence.quote}
                              </MarkdownContent>
                            </blockquote>
                            <MarkdownContent>{evidence.reason}</MarkdownContent>
                          </div>
                        )
                      );
                    })}
                  </div>
                </details>
                <footer>
                  <p>{sample ? t.card.sampleHint : t.card.chooseHint}</p>
                  <button
                    className="button primary"
                    // A sample repository cannot be imported.
                    disabled={sample || !!choosing || !!running || busy}
                    onClick={() => void choose(item, candidate)}
                  >
                    {choosing === item.id ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}
                    {choosing === item.id ? t.card.importing : t.card.choose}
                  </button>
                </footer>
              </article>
            );
          })}
        </section>
      )}
      {shown?.modelExecution && (
        <details className="discovery-runtime">
          <summary>{t.runtime.summary}</summary>
          <ModelSummary execution={shown.modelExecution} analysis />
          <EfficiencySummary
            metrics={shown.efficiency}
            mode={shown.preferences.ponytailMode}
            title={t.runtime.usageTitle}
          />
        </details>
      )}
    </div>
  );
}
