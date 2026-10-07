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
import { ModelSummary, reasoningLabels } from "../models/ModelSummary";
import { EfficiencySummary } from "../efficiency/EfficiencySummary";
import { MarkdownContent } from "../review/MarkdownContent";
import "../review/review.css";
import "./discovery.css";

const difficultyLabels = {
  beginner: "初學者",
  intermediate: "中等",
  advanced: "進階",
};
const phaseSteps = ["searching", "screening", "analyzing"] as const;
const date = (value: string) =>
  value
    ? new Date(value).toLocaleString("zh-TW", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "未提供";

export default function DiscoveryPanel({
  onChoose,
}: {
  onChoose: (
    opportunity: ContributionOpportunity,
    candidate: DiscoveryCandidate,
  ) => void | Promise<void>;
}) {
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
          <span className="eyebrow">FIND YOUR NEXT CONTRIBUTION</span>
          <h1>
            找到值得投入的
            <br />
            <em>下一個貢獻。</em>
          </h1>
          <p>
            從真實的使用者需求出發，讓 AI 幫你讀懂規範、評估門檻，
            <br className="discovery-desktop-break" />
            找到適合學習，也能帶來改變的開發機會。
          </p>
        </div>
        <div className="discovery-hero-art" aria-hidden="true">
          <span className="discovery-orbit">
            <Compass size={58} strokeWidth={1.2} />
          </span>
          <span className="discovery-orbit-label">
            <Github size={15} /> GitHub → 你的下一步
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
          <h2>你想從哪裡開始？</h2>
          <span>留白也可以，我們先幫你找方向</span>
        </div>
        <fieldset disabled={!!disabled} className="discovery-fields">
          <label className="discovery-interest">
            感興趣的領域
            <input
              value={preferences.interests}
              maxLength={300}
              onChange={(event) => update({ interests: event.target.value })}
              placeholder="例如：accessibility、developer tools"
            />
            <small>以 GitHub 關鍵字搜尋；多個詞會一起篩選。</small>
          </label>
          <label>
            程式語言
            <input
              value={preferences.language}
              maxLength={40}
              onChange={(event) => update({ language: event.target.value })}
              placeholder="不限，例如 TypeScript"
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
            可接受的難度
            <select
              value={preferences.difficulty}
              onChange={(event) =>
                update({
                  difficulty: event.target
                    .value as DiscoveryPreferences["difficulty"],
                })
              }
            >
              <option value="beginner">適合初學者</option>
              <option value="intermediate">中等以下</option>
              <option value="any">不限難度</option>
            </select>
          </label>
          <label>
            最低星數
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
          <summary>模型與效率設定</summary>
          <fieldset
            disabled={!!disabled}
            className="discovery-fields discovery-model-fields"
          >
            <label>
              Agent
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
              分析模型
              <select
                value={preferences.model || ""}
                onChange={(event) =>
                  update({ model: event.target.value, reasoningEffort: "" })
                }
              >
                <option value="">使用 {providerLabel} 預設模型</option>
                {preferences.model &&
                  !catalog.models.some(
                    (item) => item.id === preferences.model,
                  ) && (
                    <option value={preferences.model}>
                      {preferences.model}（目錄未提供）
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
              思考強度
              <select
                value={preferences.reasoningEffort || ""}
                onChange={(event) =>
                  update({
                    reasoningEffort: event.target.value as ReasoningEffort | "",
                  })
                }
              >
                <option value="">模型預設</option>
                {preferences.reasoningEffort &&
                  !selectedModel?.reasoningEfforts.includes(
                    preferences.reasoningEffort,
                  ) && (
                    <option value={preferences.reasoningEffort}>
                      {reasoningLabels[preferences.reasoningEffort]}
                      （已儲存，目錄未提供）
                    </option>
                  )}
                {selectedModel?.reasoningEfforts.map((value) => (
                  <option key={value} value={value}>
                    {reasoningLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ponytail 模式
              <select
                value={preferences.ponytailMode}
                onChange={(event) =>
                  update({
                    ponytailMode: event.target
                      .value as DiscoveryPreferences["ponytailMode"],
                  })
                }
              >
                <option value="lite">輕量 · 預設</option>
                <option value="full">完整</option>
                <option value="off">關閉</option>
              </select>
            </label>
          </fieldset>
          <p className="discovery-hint">
            {catalog.error ||
              `分析會沿用你的 ${providerLabel} 登入，使用模型用量。模型目錄不代表帳號具有所有模型的使用權限。`}
          </p>
        </details>
        <div className="discovery-form-footer">
          <p>
            <ShieldCheck size={15} /> 查閱公開資料，選定項目後再開始規劃。
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
            推薦貢獻項目
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
            重新讀取狀態
          </button>
        </div>
      )}
      {loading && (
        <p className="discovery-status" role="status">
          <Loader2 size={18} className="spin" />
          正在讀取探索紀錄…
        </p>
      )}
      {running && (
        <section className="discovery-progress" aria-label="探索進度">
          <div className="discovery-progress-top">
            <div>
              <span className="eyebrow">RESEARCH IN PROGRESS</span>
              <h2 role="status">{job.message}</h2>
            </div>
            <button
              className="button secondary"
              onClick={() => void mutate(true)}
              disabled={busy}
            >
              <X size={15} />
              停止探索
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
                    <strong>
                      {["搜尋專案", "核對規範與需求", "AI 整理推薦"][index]}
                    </strong>
                    <small>
                      {
                        [
                          "公開專案與活躍 issues",
                          "貢獻文件、認領與維護者回應",
                          "可行性、使用者價值與第一步",
                        ][index]
                      }
                    </small>
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
          <small>查詢時間 {date(job.createdAt)}</small>
        </div>
      )}
      {!!job?.warnings.length && (
        <details className="discovery-limitations">
          <summary>這次搜尋的範圍與限制 · {job.warnings.length}</summary>
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
          <h2>
            {job ? "換個條件，找找下一個機會。" : "好的貢獻，從理解需求開始。"}
          </h2>
          <p>
            {job
              ? "目前沒有足夠證據支持適合的項目。試著減少關鍵字、放寬難度，或降低最低星數。"
              : "按下推薦後，我們會查閱 GitHub 公開專案與 issues，再從這四個角度整理機會。"}
          </p>
          <div>
            {[
              ["01", "專案規範", "先理解怎麼參與"],
              ["02", "熱度與活動", "看見持續維護的訊號"],
              ["03", "使用者需求", "確認改動能幫助誰"],
              ["04", "投入門檻", "找到做得到的第一步"],
            ].map(([number, title, description]) => (
              <div key={number}>
                <span>{number}</span>
                <strong>{title}</strong>
                <small>{description}</small>
              </div>
            ))}
          </div>
        </section>
      )}
      {!!opportunities.length && (
        <section className="discovery-results" aria-label="推薦貢獻清單">
          <div className="discovery-results-heading">
            <div>
              <span className="eyebrow">
                {previous ? "PREVIOUS RESULTS" : "YOUR CONTRIBUTION SHORTLIST"}
              </span>
              <h2>
                {previous
                  ? "上一份推薦，仍在這裡。"
                  : "從這些機會，邁出第一步。"}
              </h2>
              <p>
                {previous
                  ? `這是 ${date(previous.createdAt)} 的結果，未反映本次搜尋。`
                  : "依來源與適合程度整理的提案；實作前仍需確認 issue 最新狀態與維護者意願。"}
              </p>
            </div>
            <span className="discovery-count">
              {opportunities.length} 個項目
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
                    {difficultyLabels[item.difficulty]}
                  </span>
                </header>
                <div className="discovery-repo-stats">
                  <span>
                    <Star size={14} />
                    {candidate.stars.toLocaleString("zh-TW")}
                  </span>
                  <span>
                    <GitFork size={14} />
                    {candidate.forks.toLocaleString("zh-TW")}
                  </span>
                  <span>{candidate.language || "未標示語言"}</span>
                  <span>
                    最近推送 {candidate.pushedAt?.slice(0, 10) || "未提供"}
                  </span>
                </div>
                <div className="discovery-opportunity-main">
                  <h3>{item.title}</h3>
                  <MarkdownContent>{item.summary}</MarkdownContent>
                  <div className="discovery-need">
                    <Users size={20} />
                    <div>
                      <h4>這次貢獻，可以幫助誰？</h4>
                      <MarkdownContent>{item.userNeed}</MarkdownContent>
                    </div>
                  </div>
                  <div className="discovery-assessment">
                    <div>
                      <h4>為什麼適合投入</h4>
                      <MarkdownContent>{item.feasibility}</MarkdownContent>
                    </div>
                    <div>
                      <h4>預估投入</h4>
                      <MarkdownContent>{item.effort}</MarkdownContent>
                      <small>AI 估計，尚未檢視完整程式碼。</small>
                    </div>
                  </div>
                </div>
                <details className="discovery-card-details">
                  <summary>
                    <ShieldCheck size={16} />
                    貢獻規範與熱度判讀
                  </summary>
                  <div>
                    <h4>參與前，先讀這些規定</h4>
                    <MarkdownContent>{item.contributionRules}</MarkdownContent>
                    <h4>熱度快照</h4>
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
                    第一步、驗收方式與待確認事項
                  </summary>
                  <div className="discovery-plan">
                    <div>
                      <h4>建議從這裡開始</h4>
                      <ol>
                        {item.firstSteps.map((value, i) => (
                          <li key={i}>
                            <MarkdownContent>{value}</MarkdownContent>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <h4>如何確認完成（尚未執行）</h4>
                      <ul>
                        {item.acceptanceChecks.map((value, i) => (
                          <li key={i}>
                            <MarkdownContent>{value}</MarkdownContent>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="discovery-plan-risks">
                      <h4>投入之前，再確認</h4>
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
                    推薦依據與原文 · {item.evidence.length} 則
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
                  <p>選擇後匯入專案，帶入可編輯的任務設定。</p>
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
                    {choosing === item.id ? "正在匯入專案…" : "選擇此項目"}
                  </button>
                </footer>
              </article>
            );
          })}
        </section>
      )}
      {job?.modelExecution && (
        <details className="discovery-runtime">
          <summary>這次探索使用的模型與用量</summary>
          <ModelSummary execution={job.modelExecution} analysis />
          <EfficiencySummary
            metrics={job.efficiency}
            mode={job.preferences.ponytailMode}
            title="探索 AI 用量"
          />
        </details>
      )}
    </div>
  );
}
