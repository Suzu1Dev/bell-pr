import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Compass,
  ExternalLink,
  GitFork,
  Github,
  Loader2,
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
import { api, send } from "../api";
import { useFormat, useT } from "../i18n";
import { ModelSummary } from "../models/ModelSummary";
import { EfficiencySummary } from "../efficiency/EfficiencySummary";
import { MarkdownContent } from "../review/MarkdownContent";
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

export default function DiscoveryPanel({
  onChoose,
}: {
  onChoose: (
    opportunity: ContributionOpportunity,
    candidate: DiscoveryCandidate,
  ) => void | Promise<void>;
}) {
  const t = useT("discovery");
  const effortLabels = useT("common").reasoningEffort;
  const fmt = useFormat();
  const date = (value: string) => (value ? fmt.dateTime(value) : undefined);
  const [preferences, setPreferences] = useState<DiscoveryPreferences>({
    ...defaultDiscoveryPreferences,
  });
  const [job, setJob] = useState<DiscoveryJob | null>(null);
  const [loading, setLoading] = useState(true);
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
    void reload(true);
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
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
  const previous = !job?.opportunities.length ? job?.previousResult : undefined;
  const opportunities = previous
    ? previous.opportunities
    : (job?.opportunities ?? []);
  const candidates = previous ? previous.candidates : (job?.candidates ?? []);
  const disabled = loading || busy || running || !!choosing;

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
            <Github size={15} /> {t.heroCaption}
          </span>
          <span className="discovery-hero-dot" />
        </div>
      </header>
      <form
        className="discovery-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void mutate();
        }}
      >
        <div className="discovery-section-label">
          <Search size={17} />
          <h2>{t.form.heading}</h2>
          <span>{t.form.hint}</span>
        </div>
        <fieldset disabled={!!disabled} className="discovery-fields">
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
            disabled={!!disabled}
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
            <label>
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
            disabled={!!disabled}
          >
            {busy || running ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <Sparkles size={17} />
            )}
            {t.form.submit}
          </button>
        </div>
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
      {loading && (
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
      {job && !running && (
        <div
          className={`discovery-status ${job.status === "failed" ? "has-error" : ""}`}
          role="status"
        >
          <span>{job.error || job.message}</span>
          <small>{t.searchedAt({ date: date(job.createdAt) })}</small>
        </div>
      )}
      {!!job?.warnings.length && (
        <details className="discovery-limitations">
          <summary>{t.limitations({ count: job.warnings.length })}</summary>
          <ul>
            {job.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {!loading && !running && !opportunities.length && (
        <section className="discovery-empty">
          <Compass size={34} strokeWidth={1.3} />
          <h2>{job ? t.empty.retryTitle : t.empty.title}</h2>
          <p>{job ? t.empty.retryBody : t.empty.body}</p>
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
        <section className="discovery-results" aria-label={t.results.label}>
          <div className="discovery-results-heading">
            <div>
              <span className="eyebrow">
                {previous ? t.results.previousEyebrow : t.results.eyebrow}
              </span>
              <h2>{previous ? t.results.previousTitle : t.results.title}</h2>
              <p>
                {previous
                  ? t.results.previousNote({ date: date(previous.createdAt) })
                  : t.results.note({
                      sort: t.sorts[job?.preferences.sort ?? "updated"],
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
                key={`${previous?.createdAt || job?.id}:${item.id}`}
              >
                <header>
                  <span className="discovery-rank">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <a
                      className="discovery-repo-link"
                      href={candidate.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Github size={16} />
                      {candidate.fullName}
                      <ExternalLink size={12} />
                    </a>
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
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.title}
                              <ArrowUpRight size={14} />
                            </a>
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
                  <p>{t.card.chooseHint}</p>
                  <button
                    className="button primary"
                    disabled={!!choosing || !!running || busy}
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
      {job?.modelExecution && (
        <details className="discovery-runtime">
          <summary>{t.runtime.summary}</summary>
          <ModelSummary execution={job.modelExecution} analysis />
          <EfficiencySummary
            metrics={job.efficiency}
            mode={job.preferences.ponytailMode}
            title={t.runtime.usageTitle}
          />
        </details>
      )}
    </div>
  );
}
