import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  FileSearch,
  FolderTree,
  GitBranch,
  Lightbulb,
  Loader2,
  RefreshCw,
  Route,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import type {
  ContributionBrief,
  ContributionRecommendation,
  ProjectInsights,
} from "../../shared/insights";
import type { Repo, Run } from "../types";
import { EfficiencySummary } from "../efficiency/EfficiencySummary";
import { ModelSummary } from "../models/ModelSummary";
import { directionOptions } from "./DirectionSettings";
import "./mission.css";

export interface ProjectOverviewProps {
  repo: Repo;
  run?: Run;
  insights: ProjectInsights | null;
  brief?: ContributionBrief;
  loading: boolean;
  error: string;
  stale: boolean;
  onAnalyze: () => void;
  onChooseRecommendation: (idea: ContributionRecommendation) => void;
  onReadCode: () => void;
  onStartContribution?: () => void;
}

const effortLabels = { small: "小型", medium: "中型", large: "大型" };
const confidenceLabels = {
  high: "依據較充分",
  medium: "需進一步確認",
  low: "初步構想",
};

function EvidencePaths({
  paths,
  details,
}: {
  paths: string[];
  details?: ContributionRecommendation["evidenceDetails"];
}) {
  if (!paths.length)
    return (
      <span className="mission-no-evidence">尚無檔案依據，開始前需確認。</span>
    );
  return (
    <div className="mission-source-evidence">
      <div className="mission-evidence-paths" aria-label="參考檔案">
        {paths.map((file, index) => (
          <code key={`${file}-${index}`} title={file}>
            <FileSearch size={12} aria-hidden="true" />
            {file}
          </code>
        ))}
      </div>
      {!!details?.length && (
        <details className="mission-source-quotes">
          <summary>
            <FileSearch size={13} />
            查看原文依據 <span>{details.length}</span>
            <ChevronRight size={14} />
          </summary>
          <p className="mission-quote-note">
            原文支持觀察；建議做法與使用者影響仍需確認。
          </p>
          {details.map((item, index) => (
            <figure key={`${item.path}-${index}`}>
              <figcaption>
                <code>{item.path}</code>
              </figcaption>
              <blockquote>{item.quote}</blockquote>
              <p>
                <strong>為什麼引用這段</strong>
                {item.reason}
              </p>
            </figure>
          ))}
        </details>
      )}
    </div>
  );
}

function Brief({ run, brief }: { run: Run; brief?: ContributionBrief }) {
  return (
    <section
      className="mission-contribution"
      aria-labelledby="mission-contribution-title"
    >
      <div className="mission-section-heading">
        <div>
          <span className="mission-kicker">THIS CONTRIBUTION</span>
          <h2 id="mission-contribution-title">這次改動，會帶來什麼不同？</h2>
        </div>
        <span className="mission-section-icon">
          <Target size={20} />
        </span>
      </div>
      <h3 className="mission-contribution-name">{run.title}</h3>
      {brief ? (
        <>
          <div className="mission-contribution-reason">
            <div>
              <span>這次想解決的問題</span>
              <p>{brief.problem}</p>
            </div>
            <div>
              <span>為什麼值得現在改善</span>
              <p>{brief.motivation}</p>
            </div>
          </div>
          {brief.beneficiaries.length > 0 && (
            <div className="mission-beneficiaries">
              <Users size={15} />
              <span>受益對象</span>
              {brief.beneficiaries.map((person, index) => (
                <strong key={`${person}-${index}`}>{person}</strong>
              ))}
            </div>
          )}
          <div className="mission-before-after">
            <article className="mission-before">
              <span className="mission-change-label">
                BEFORE <span>目前的體驗</span>
              </span>
              <p>{brief.before}</p>
            </article>
            <div className="mission-change-arrow" aria-hidden="true">
              <ArrowRight size={20} />
            </div>
            <article className="mission-after">
              <span className="mission-change-label">
                AFTER <span>希望帶來的改善</span>
              </span>
              <p>{brief.after}</p>
            </article>
          </div>
          <p className="mission-impact-note">
            以上是這次貢獻的目標；是否達成，仍需根據實作與驗證結果確認。
          </p>
          <div className="mission-validation-grid">
            {brief.validation.length > 0 && (
              <div>
                <h4>
                  <Check size={15} />
                  如何知道改動有用？
                </h4>
                <ul>
                  {brief.validation.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {brief.risks.length > 0 && (
              <div>
                <h4>
                  <Lightbulb size={15} />
                  一起留意的取捨
                </h4>
                <ul>
                  {brief.risks.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mission-brief-pending">
          <span className="mission-field-caption">你提出的需求</span>
          <p>{run.prompt}</p>
          <small>
            尚未產生這次貢獻的使用者影響分析。先保留原始需求，完成分析後再連結到具體動機與驗收方式。
          </small>
        </div>
      )}
    </section>
  );
}

export function ProjectOverview({
  repo,
  run,
  insights,
  brief,
  loading,
  error,
  stale,
  onAnalyze,
  onChooseRecommendation,
  onReadCode,
  onStartContribution,
}: ProjectOverviewProps) {
  const generatedAt = insights?.generatedAt
    ? new Date(insights.generatedAt)
    : null;
  const dateLabel =
    generatedAt && !Number.isNaN(generatedAt.valueOf())
      ? generatedAt.toLocaleString("zh-TW", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  return (
    <div className="mission-overview">
      <div className="mission-overview-heading">
        <div>
          <span className="mission-kicker">
            <BookOpen size={14} />
            PROJECT CONTEXT
          </span>
          <h2>先看懂專案，再決定怎麼改。</h2>
          <p>從使用者的角度，理解每一次貢獻的理由。</p>
        </div>
        <button
          type="button"
          className="mission-button mission-button-secondary"
          onClick={onAnalyze}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mission-spin" size={15} />
          ) : (
            <RefreshCw size={15} />
          )}
          {loading ? "正在分析專案…" : insights ? "重新分析" : "分析專案全貌"}
        </button>
      </div>

      {error && (
        <div className="mission-alert mission-alert-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onAnalyze} disabled={loading}>
            重試
            <RefreshCw size={13} />
          </button>
        </div>
      )}
      {stale && insights && (
        <div className="mission-alert" role="status">
          <RefreshCw size={15} />
          <span>
            專案內容已更新。這份分析來自先前版本，重新分析後再確認貢獻方向。
          </span>
        </div>
      )}

      {!insights ? (
        <section className="mission-overview-empty" aria-busy={loading}>
          <span className="mission-empty-icon">
            {loading ? (
              <Loader2 className="mission-spin" size={27} />
            ) : (
              <FolderTree size={27} />
            )}
          </span>
          <span className="mission-repository-label">{repo.fullName}</span>
          <h3>
            {loading
              ? "正在把程式碼，整理成專案全貌。"
              : "你的下一個貢獻，從理解開始。"}
          </h3>
          <p>
            {loading
              ? "Agent 會閱讀專案文件與主要模組，整理用途、使用流程，以及有依據的改善建議。"
              : "讓 Agent 閱讀這個 repository，先回答三個問題，再決定值得投入的方向。"}
          </p>
          <div className="mission-discovery-points">
            <span>
              <Target size={18} />
              <strong>它解決什麼問題？</strong>
            </span>
            <span>
              <Users size={18} />
              <strong>誰會使用它？</strong>
            </span>
            <span>
              <Lightbulb size={18} />
              <strong>哪裡值得改善？</strong>
            </span>
          </div>
          {!loading && (
            <button
              type="button"
              className="mission-button mission-button-primary"
              onClick={onAnalyze}
            >
              <Sparkles size={16} />
              開始專案分析
              <ArrowRight size={15} />
            </button>
          )}
          <small>分析完成前，不會推測這個專案的用途或推薦改動。</small>
        </section>
      ) : (
        <>
          <section
            className="mission-project-card"
            aria-labelledby="mission-purpose-title"
          >
            <div className="mission-project-meta">
              <span className="mission-repository-label">
                <GitBranch size={14} />
                {repo.fullName}
              </span>
              <span
                className={
                  insights.source === "demo"
                    ? "mission-source mission-source-demo"
                    : "mission-source"
                }
              >
                <Sparkles size={12} />
                {insights.source === "demo" ? "示範分析" : "AI 專案分析"}
              </span>
            </div>
            <h3 id="mission-purpose-title">{insights.summary}</h3>
            <p className="mission-project-purpose">{insights.purpose}</p>
            {insights.audience.length > 0 && (
              <div className="mission-audience">
                <span>
                  <Users size={14} />
                  主要使用者
                </span>
                {insights.audience.map((person, index) => (
                  <strong key={`${person}-${index}`}>{person}</strong>
                ))}
              </div>
            )}
            <div className="mission-analysis-footer">
              <span>
                {dateLabel && <>更新於 {dateLabel}</>}
                {insights.baseSha && (
                  <>
                    {" "}
                    · 版本 <code>{insights.baseSha.slice(0, 7)}</code>
                  </>
                )}
              </span>
              <span>
                {insights.source === "demo"
                  ? "預寫範例，未呼叫 AI"
                  : "由來源檔案整理，推論仍需確認"}
              </span>
            </div>
            <ModelSummary
              execution={insights.modelExecution}
              demo={insights.source === "demo"}
              analysis
            />
            <EfficiencySummary
              title="這次專案分析用量"
              metrics={insights.efficiency}
              demo={insights.source === "demo"}
            />
          </section>

          {insights.userJourney.length > 0 && (
            <section
              className="mission-journey"
              aria-labelledby="mission-journey-title"
            >
              <div className="mission-section-heading">
                <div>
                  <span className="mission-kicker">THE USER JOURNEY</span>
                  <h2 id="mission-journey-title">
                    <Route size={18} />
                    使用者如何用到這個專案？
                  </h2>
                </div>
              </div>
              <ol>
                {insights.userJourney.map((step, index) => (
                  <li key={index}>
                    <span className="mission-journey-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p>{step}</p>
                    {index < insights.userJourney.length - 1 && (
                      <ChevronRight size={16} aria-hidden="true" />
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {(insights.modules.length > 0 || insights.evidence.length > 0) && (
            <div className="mission-project-details">
              {insights.modules.length > 0 && (
                <details className="mission-detail-block">
                  <summary>
                    <FolderTree size={16} />
                    <span>主要模組怎麼分工？</span>
                    <span className="mission-detail-count">
                      {insights.modules.length} 個模組
                    </span>
                    <ChevronRight size={15} />
                  </summary>
                  <div className="mission-module-list">
                    {insights.modules.map((module, index) => (
                      <div key={`${module.path}-${index}`}>
                        <code>{module.path}</code>
                        <p>{module.purpose}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {insights.evidence.length > 0 && (
                <details className="mission-detail-block">
                  <summary>
                    <FileSearch size={16} />
                    <span>分析的來源與依據</span>
                    <span className="mission-detail-count">
                      {insights.evidence.length} 份來源
                    </span>
                    <ChevronRight size={15} />
                  </summary>
                  <div className="mission-module-list">
                    {insights.evidence.map((evidence, index) => (
                      <div key={`${evidence.path}-${index}`}>
                        <code>{evidence.path}</code>
                        <p>{evidence.note}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </>
      )}

      {run && <Brief run={run} brief={brief} />}

      {insights && (
        <section
          className="mission-recommendations"
          aria-labelledby="mission-ideas-title"
        >
          <div className="mission-section-heading">
            <div>
              <span className="mission-kicker">WHERE YOU CAN HELP</span>
              <h2 id="mission-ideas-title">
                <Lightbulb size={18} />
                值得探索的貢獻方向
              </h2>
              <p>先看問題與使用者價值，再決定要不要交給團隊。</p>
            </div>
            <span className="mission-ideas-count">
              {insights.recommendations.length} 個
              {insights.source === "demo" ? "示範" : "建議"}
            </span>
          </div>
          {insights.recommendations.length ? (
            <div className="mission-idea-list">
              {insights.recommendations.map((idea, index) => {
                const direction = directionOptions.find(
                  (option) => option.value === idea.direction,
                );
                const Icon = direction?.icon ?? Lightbulb;
                return (
                  <article className="mission-idea" key={idea.id}>
                    <div className="mission-idea-top">
                      <span className="mission-idea-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="mission-idea-direction">
                        <Icon size={13} />
                        {direction?.label ?? idea.direction}
                      </span>
                      <span className="mission-idea-effort">
                        {effortLabels[idea.effort]}範圍
                      </span>
                    </div>
                    <h3>{idea.title}</h3>
                    <p className="mission-idea-problem">{idea.problem}</p>
                    <div className="mission-idea-impact">
                      <Users size={15} />
                      <p>
                        <strong>對使用者的幫助</strong>
                        {idea.userImpact}
                      </p>
                    </div>
                    <details className="mission-idea-approach">
                      <summary>
                        看建議做法與驗收方式
                        <ChevronRight size={14} />
                      </summary>
                      <p>{idea.approach}</p>
                      {idea.acceptance.length > 0 && (
                        <ul>
                          {idea.acceptance.map((item, itemIndex) => (
                            <li key={itemIndex}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </details>
                    <EvidencePaths
                      paths={idea.evidence}
                      details={idea.evidenceDetails}
                    />
                    <div className="mission-idea-bottom">
                      <span
                        className={`mission-confidence mission-confidence-${idea.confidence}`}
                      >
                        <span />
                        {confidenceLabels[idea.confidence]}
                      </span>
                      <button
                        type="button"
                        className="mission-text-button"
                        onClick={() => onChooseRecommendation(idea)}
                      >
                        以此方向開始
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mission-no-ideas">
              <p>
                這次分析尚未提出有足夠依據的建議。你可以指定想改善的方向，再讓團隊確認範圍。
              </p>
            </div>
          )}
        </section>
      )}

      {(run || onStartContribution) && (
        <div className="mission-next-step">
          <div>
            <span className="mission-next-icon">
              {run ? <Code2 size={20} /> : <Target size={20} />}
            </span>
            <div>
              <strong>
                {run
                  ? "帶著理解，回到程式碼。"
                  : "有自己的想法，也可以從這裡開始。"}
              </strong>
              <p>
                {run
                  ? "把預期的使用者改善，和每一段實際變更對照。"
                  : "指定受益對象、期待的結果與開發界線。"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mission-button mission-button-primary"
            onClick={run ? onReadCode : onStartContribution}
          >
            {run ? "檢閱程式碼變更" : "指定貢獻方向"}
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
