import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  Eye,
  EyeOff,
  FileSearch,
  FolderTree,
  GitBranch,
  GripVertical,
  Lightbulb,
  Loader2,
  RefreshCw,
  Route,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import {
  maxProjectRecommendations,
  projectRecommendationBatchSize,
  type ContributionBrief,
  type ContributionRecommendation,
  type InsightsStaleDetail,
  type ProjectInsights,
  type RecommendationPreferences,
} from "../../shared/insights";
import type { Repo, Run } from "../types";
import { EfficiencySummary } from "../efficiency/EfficiencySummary";
import { ModelSummary } from "../models/ModelSummary";
import { directionOptions } from "./DirectionSettings";
import {
  moveRecommendation,
  orderedRecommendations,
} from "./recommendation-preferences";
import { PremiseNotice } from "../team/PremiseNotice";
import "./mission.css";

export interface ProjectOverviewProps {
  repo: Repo;
  run?: Run;
  insights: ProjectInsights | null;
  brief?: ContributionBrief;
  loading: boolean;
  error: string;
  recommending: boolean;
  recommendationError: string;
  recommendationPreferences: RecommendationPreferences;
  savingPreferences: boolean;
  preferenceError: string;
  stale: boolean;
  /** Absent when the server could not list changes; the notice then says so. */
  staleDetail?: InsightsStaleDetail;
  onAnalyze: () => void;
  onRecommendMore: () => void;
  onSavePreferences: (preferences: RecommendationPreferences) => void;
  onChooseRecommendation: (idea: ContributionRecommendation) => void;
  onReadCode: () => void;
  onStartContribution?: () => void;
  /** Updates BELL's clone to the latest default branch; absent for local imports and the demo. */
  onUpdateRepo?: () => void;
  updatingRepo?: boolean;
  /** Checks the request's assumption for a finished run made before premise checks existed. */
  onCheckPremise?: () => void;
  checkingPremise?: boolean;
}

const effortLabels = { small: "小型", medium: "中型", large: "大型" };
const confidenceLabels = {
  high: "依據較充分",
  medium: "需進一步確認",
  low: "初步構想",
};

function analysisDate(value?: string) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf())
    ? date.toLocaleString("zh-TW", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}

/** Caches written before coverage was recorded say so instead of showing zeros. */
function sampleCoverage(sample: ProjectInsights["sample"]) {
  if (!sample) return "抽樣範圍未記錄，重新分析後顯示";
  const count = (value: number) => value.toLocaleString("zh-TW");
  const truncated =
    sample.truncatedFiles > 0 ? `，${count(sample.truncatedFiles)} 檔節錄` : "";
  return `讀取 ${count(sample.sampledFiles)} / ${count(sample.trackedFiles)} 個追蹤檔（約 ${count(Math.max(1, Math.round(sample.bytes / 1024)))} KB${truncated}）`;
}

/**
 * Explains how far the repository has moved from the analyzed version. Every
 * variant still asks for a re-analysis: an unchanged cited file does not make
 * the rest of the overview current.
 */
function staleNotice(baseSha: string, detail?: InsightsStaleDetail) {
  const version = baseSha ? `分析版本 ${baseSha.slice(0, 7)}` : "分析版本";
  if (!detail)
    return `專案內容已更新。這份分析來自先前版本，無法列出變更明細；重新分析後再確認貢獻方向。`;
  if (detail.changedFiles === 0)
    return `版本已變更，但分析引用的檔案內容相同；全貌仍可能受其他變更影響，重新分析後再確認貢獻方向。`;
  const changed = `自${version}後有至少 ${detail.changedFiles.toLocaleString("zh-TW")} 個檔案變動`;
  if (!detail.citedChanged.length)
    return `${changed}。分析引用的檔案未變動，但全貌仍可能受其他變更影響，重新分析後再確認貢獻方向。`;
  // The server lists at most 12 cited files.
  const cited = `${detail.citedChanged.length}${detail.citedChanged.length >= 12 ? " 個以上" : " 個"}`;
  return `${changed}，其中 ${cited}是本份分析引用的檔案：${detail.citedChanged.join("、")}。重新分析後再確認貢獻方向。`;
}

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

function Brief({
  run,
  brief,
  onCheckPremise,
  checkingPremise = false,
}: {
  run: Run;
  brief?: ContributionBrief;
  onCheckPremise?: () => void;
  checkingPremise?: boolean;
}) {
  const premise = run.team?.premise;
  // Text copied from the request still states the assumption; it is labelled, never rewritten.
  const tag =
    premise?.verdict === "refuted"
      ? "依你的假設，查證後不成立"
      : premise?.verdict === "unclear"
        ? "依你的假設，尚未能確認"
        : undefined;
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
      <PremiseNotice premise={premise} />
      {!premise && onCheckPremise && (
        <div className="mission-premise-missing">
          <p>
            這個貢獻建立時還沒有前提查核，需求裡的假設是否成立沒有記錄下來。可以請 Lead
            依目前的程式碼與審查報告補做一次；完成後，變更解說與程式碼解說會依結論重新產生。
          </p>
          <button
            type="button"
            className="mission-button mission-button-secondary"
            onClick={onCheckPremise}
            disabled={checkingPremise}
          >
            {checkingPremise ? (
              <Loader2 className="mission-spin" size={15} />
            ) : (
              <Check size={15} />
            )}
            {checkingPremise ? "正在查核前提…" : "依審查結果查核前提"}
          </button>
        </div>
      )}
      {brief ? (
        <>
          <div className="mission-contribution-reason">
            <div>
              <span>這次想解決的問題</span>
              <p>{brief.problem}</p>
            </div>
            <div>
              <span>
                為什麼值得現在改善
                {tag && <em className="mission-premise-tag">{tag}</em>}
              </span>
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
                {tag && <em className="mission-premise-tag">{tag}</em>}
              </span>
              <p>{brief.after}</p>
            </article>
          </div>
          <p className="mission-impact-note">
            {premise?.verdict === "refuted"
              ? "前提查核顯示這個假設不成立：上面依假設描述的問題與影響實際上不會發生，請以查核結果與 Lead 的整合摘要為準。"
              : "以上是這次貢獻的目標；是否達成，仍需根據實作與驗證結果確認。"}
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
  recommending,
  recommendationError,
  recommendationPreferences,
  savingPreferences,
  preferenceError,
  stale,
  staleDetail,
  onAnalyze,
  onRecommendMore,
  onSavePreferences,
  onChooseRecommendation,
  onReadCode,
  onStartContribution,
  onUpdateRepo,
  updatingRepo = false,
  onCheckPremise,
  checkingPremise = false,
}: ProjectOverviewProps) {
  const ideaRail = useRef<HTMLDivElement>(null);
  const hiddenSummary = useRef<HTMLElement>(null);
  const pointerDrag = useRef<{
    pointerId: number;
    id: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const [drag, setDrag] = useState<{ repoId: string; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    side: "before" | "after";
  } | null>(null);
  const [visibleIdeas, setVisibleIdeas] = useState({
    first: 1,
    last: 1,
    previous: false,
    next: false,
  });
  const recommendationCount = insights?.recommendations.length ?? 0;
  const orderedIdeas = orderedRecommendations(
    insights?.recommendations ?? [],
    recommendationPreferences,
  );
  const hiddenIds = new Set(recommendationPreferences.hidden);
  const shownIdeas = orderedIdeas.filter((idea) => !hiddenIds.has(idea.id));
  const hiddenIdeas = orderedIdeas.filter((idea) => hiddenIds.has(idea.id));
  const shownIds = shownIdeas.map((idea) => idea.id).join("\n");
  const preferencesDisabled = loading || recommending || savingPreferences;
  const draggedId = drag?.repoId === repo.id ? drag.id : null;
  useEffect(() => {
    pointerDrag.current = null;
    setDrag(null);
    setDropTarget(null);
  }, [repo.id, insights?.generatedAt, preferencesDisabled]);
  const dropAtPoint = (x: number, y: number) => {
    const card = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-recommendation-id]");
    if (!card || !ideaRail.current?.contains(card)) return null;
    const id = card.dataset.recommendationId;
    if (!id || id === pointerDrag.current?.id) return null;
    const bounds = card.getBoundingClientRect();
    return { id, side: x < bounds.left + bounds.width / 2 ? "before" as const : "after" as const };
  };
  useEffect(() => {
    if (!draggedId) return;
    let frame = 0;
    const updateDrag = () => {
      const pointer = pointerDrag.current;
      const rail = ideaRail.current;
      if (!pointer?.active || !rail) return;
      const bounds = rail.getBoundingClientRect();
      if (pointer.y >= bounds.top && pointer.y <= bounds.bottom) {
        if (pointer.x >= bounds.left && pointer.x < bounds.left + 60) {
          rail.scrollBy({ left: -8, behavior: "auto" });
        } else if (pointer.x <= bounds.right && pointer.x > bounds.right - 60) {
          rail.scrollBy({ left: 8, behavior: "auto" });
        }
      }
      const target = dropAtPoint(pointer.x, pointer.y);
      setDropTarget((current) => current?.id === target?.id && current?.side === target?.side ? current : target);
      frame = window.requestAnimationFrame(updateDrag);
    };
    frame = window.requestAnimationFrame(updateDrag);
    return () => window.cancelAnimationFrame(frame);
  }, [draggedId, repo.id]);
  useEffect(() => {
    const rail = ideaRail.current;
    if (!rail) return;
    const updateVisibleIdeas = () => {
      const bounds = rail.getBoundingClientRect();
      const visible = Array.from(rail.children).flatMap((card, index) => {
        const rect = card.getBoundingClientRect();
        return rect.right > bounds.left + 5 && rect.left < bounds.right - 5
          ? [index + 1]
          : [];
      });
      const position = {
        first: visible[0] ?? 1,
        last: visible.at(-1) ?? 1,
        previous: rail.scrollLeft > 1,
        next: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1,
      };
      setVisibleIdeas((current) =>
        current.first === position.first &&
        current.last === position.last &&
        current.previous === position.previous &&
        current.next === position.next
          ? current
          : position,
      );
    };
    updateVisibleIdeas();
    rail.addEventListener("scroll", updateVisibleIdeas, { passive: true });
    const observer = new ResizeObserver(updateVisibleIdeas);
    observer.observe(rail);
    return () => {
      rail.removeEventListener("scroll", updateVisibleIdeas);
      observer.disconnect();
    };
  }, [repo.id, insights?.generatedAt, shownIds]);
  const scrollIdeas = (direction: -1 | 1) => {
    const rail = ideaRail.current;
    const card = rail?.firstElementChild as HTMLElement | null;
    if (!rail || !card) return;
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    rail.scrollBy({
      left: direction * (card.offsetWidth + gap),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };
  const dateLabel = analysisDate(insights?.generatedAt);
  const expansion = insights?.recommendationExpansion;
  // Proposals whose quotes failed the server check: only their title and reason are known.
  const droppedIdeas = [
    ...(insights?.verification?.droppedRecommendations ?? []).map((entry) => ({
      ...entry,
      round: "專案分析",
    })),
    ...(expansion?.verification?.droppedRecommendations ?? []).map((entry) => ({
      ...entry,
      round: "最近一次追加",
    })),
  ];
  // Modules, reading steps and evidence notes the server removed for citing files outside the sample.
  const droppedPaths = insights?.verification?.droppedPaths ?? [];
  const droppedPathField = {
    modules: "模組分工",
    readingPath: "閱讀順序",
    evidence: "分析依據",
  } as const;
  const addedIds = new Set(
    recommending || recommendationError ? [] : (expansion?.addedIds ?? []),
  );
  const firstAddedIdea = shownIdeas.find((idea) => addedIds.has(idea.id));
  const ideaAnchor = (id: string) => `mission-idea-${repo.id}-${id}`;
  const focusIdea = (id?: string) => {
    window.requestAnimationFrame(() => {
      const target = id
        ? document.getElementById(ideaAnchor(id))
        : hiddenSummary.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  const saveOrder = (
    sourceId: string,
    targetId: string,
    side: "before" | "after",
  ) => {
    if (preferencesDisabled) return;
    const currentOrder = orderedIdeas.map((idea) => idea.id);
    const order = moveRecommendation(
      currentOrder,
      recommendationPreferences.hidden,
      sourceId,
      targetId,
      side,
    );
    if (order.some((id, index) => id !== currentOrder[index])) {
      onSavePreferences({ order, hidden: recommendationPreferences.hidden });
      focusIdea(sourceId);
    }
  };
  const resetDrag = () => {
    pointerDrag.current = null;
    setDrag(null);
    setDropTarget(null);
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointer = pointerDrag.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const target = pointer.active ? dropAtPoint(event.clientX, event.clientY) : null;
    resetDrag();
    if (target) saveOrder(pointer.id, target.id, target.side);
  };
  const setHidden = (id: string, hide: boolean) => {
    if (preferencesDisabled) return;
    onSavePreferences({
      order: orderedIdeas.map((idea) => idea.id),
      hidden: hide
        ? [...new Set([...recommendationPreferences.hidden, id])]
        : recommendationPreferences.hidden.filter((hiddenId) => hiddenId !== id),
    });
    if (hide) {
      const index = shownIdeas.findIndex((idea) => idea.id === id);
      focusIdea(shownIdeas[index + 1]?.id ?? shownIdeas[index - 1]?.id);
    } else {
      focusIdea(id);
    }
  };
  const requestedCount = Math.min(
    projectRecommendationBatchSize,
    Math.max(0, maxProjectRecommendations - recommendationCount),
  );
  const shortfall =
    expansion?.requestedCount !== undefined &&
    addedIds.size < expansion.requestedCount;
  const moreDisabled =
    updatingRepo ||
    loading ||
    recommending ||
    savingPreferences ||
    !insights ||
    stale ||
    insights.source === "demo" ||
    insights.recommendations.length >= maxProjectRecommendations;
  const moreDescription = insights?.source === "demo"
    ? "示範內容使用預寫建議。匯入真實專案後，即可請 Agent 產出更多貢獻方向。"
    : stale
      ? "專案版本已更新，請先重新分析專案，再產出更多建議。"
      : (insights?.recommendations.length ?? 0) >= maxProjectRecommendations
        ? `已累積 ${maxProjectRecommendations} 個建議，達到這份分析的上限。可先挑選方向，或重新分析專案。`
        : "Agent 會沿用這個專案已儲存的模型設定，尋找不同的改善問題與使用者價值。既有建議會保留，由你決定何時開始開發。";
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
        <div className="mission-overview-actions">
          {onUpdateRepo && (
            <button
              type="button"
              className="mission-button mission-button-secondary"
              onClick={onUpdateRepo}
              disabled={updatingRepo || loading || recommending || savingPreferences}
              aria-describedby="mission-update-help"
            >
              {updatingRepo ? (
                <Loader2 className="mission-spin" size={15} />
              ) : (
                <Download size={15} />
              )}
              {updatingRepo ? "正在更新…" : "更新到最新版本"}
            </button>
          )}
          <button
            type="button"
            className="mission-button mission-button-secondary"
            onClick={onAnalyze}
            disabled={loading || recommending || savingPreferences || updatingRepo}
          >
            {loading ? (
              <Loader2 className="mission-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            {loading ? "正在分析專案…" : insights ? "重新分析" : "分析專案全貌"}
          </button>
          {onUpdateRepo && (
            <p id="mission-update-help" className="mission-update-help">
              從 GitHub 取得 {repo.defaultBranch} 的最新版本，專案全貌與分析會以它為準；新的貢獻本來就從最新版本開始。
              {repo.updatedAt &&
                ` 上次更新：${new Date(repo.updatedAt).toLocaleString("zh-TW")}`}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="mission-alert mission-alert-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={loading || recommending || savingPreferences || updatingRepo}
          >
            重試
            <RefreshCw size={13} />
          </button>
        </div>
      )}
      {stale && insights && (
        <div className="mission-alert" role="status">
          <RefreshCw size={15} />
          <span>{staleNotice(insights.baseSha, staleDetail)}</span>
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
              disabled={updatingRepo}
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
                  : `${sampleCoverage(insights.sample)}，推論仍需確認`}
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

          {!!insights.readingPath?.length && (
            <section
              className="mission-reading-path"
              aria-labelledby="mission-reading-title"
            >
              <div className="mission-section-heading">
                <div>
                  <span className="mission-kicker">WHERE TO START READING</span>
                  <h2 id="mission-reading-title">
                    <BookOpen size={18} />
                    第一次讀這個專案，建議這樣讀
                  </h2>
                  <p>
                    依 Agent 讀過的抽樣檔案排出順序；每一步說明為什麼先看它、看什麼。
                  </p>
                </div>
              </div>
              {insights.howItFitsTogether && (
                <div className="mission-reading-flow">
                  <span>模組怎麼串起來</span>
                  <p>{insights.howItFitsTogether}</p>
                </div>
              )}
              <ol className="mission-reading-steps">
                {insights.readingPath.map((step, index) => {
                  const module = insights.modules.find(
                    (entry) => entry.path === step.path,
                  );
                  const evidence = insights.evidence.find(
                    (entry) => entry.path === step.path,
                  );
                  return (
                    <li key={`${step.path}-${index}`}>
                      <span className="mission-journey-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <code>{step.path}</code>
                      {step.sampled === false && (
                        <span className="mission-reading-unsampled">
                          未抽樣，內容未讀
                        </span>
                      )}
                      <p>{step.why}</p>
                      <p>
                        <strong>看什麼</strong>
                        {step.lookFor}
                      </p>
                      {(module || evidence) && (
                        <details className="mission-reading-context">
                          <summary>
                            這個檔案在分析中的其他說明
                            <ChevronRight size={14} aria-hidden="true" />
                          </summary>
                          {module && (
                            <p>
                              <strong>模組分工</strong>
                              {module.purpose}
                            </p>
                          )}
                          {evidence && (
                            <p>
                              <strong>分析依據</strong>
                              {evidence.note}
                            </p>
                          )}
                        </details>
                      )}
                    </li>
                  );
                })}
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

      {run && (
        <Brief
          run={run}
          brief={brief}
          onCheckPremise={onCheckPremise}
          checkingPremise={checkingPremise}
        />
      )}

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
            <div className="mission-ideas-actions">
              <span className="mission-ideas-count">
                {insights.recommendations.length} 個
                {insights.source === "demo" ? "示範" : "建議"}
              </span>
              <button
                type="button"
                className="mission-button mission-button-secondary"
                onClick={onRecommendMore}
                disabled={moreDisabled}
                aria-describedby="mission-more-description"
              >
                {recommending ? (
                  <Loader2 className="mission-spin" size={15} />
                ) : (
                  <Sparkles size={15} />
                )}
                {recommending
                  ? `正在產出 ${requestedCount} 個新建議…`
                  : requestedCount
                    ? `產出 ${requestedCount} 個新建議`
                    : "建議數量已達上限"}
              </button>
            </div>
          </div>
          <div className="mission-more-context">
            <p id="mission-more-description">{moreDescription}</p>
            <div className="mission-more-status" role="status" aria-live="polite">
              {recommending ? (
                <span>正在閱讀專案、避開既有方向，你可以繼續閱讀下方建議。</span>
              ) : expansion && !recommendationError ? (
                <>
                  {firstAddedIdea ? (
                    <a
                      href={`#${encodeURIComponent(ideaAnchor(firstAddedIdea.id))}`}
                    >
                      查看本輪新增 {addedIds.size}
                      {expansion.requestedCount !== undefined &&
                        ` / ${expansion.requestedCount}`} 個建議
                      <ArrowRight size={14} aria-hidden="true" />
                    </a>
                  ) : (
                    <span>
                      {addedIds.size
                        ? `本輪新增 ${addedIds.size}${expansion.requestedCount !== undefined ? ` / ${expansion.requestedCount}` : ""} 個建議，目前皆已隱藏。`
                        : expansion.requestedCount !== undefined
                        ? `本輪新增 0 / ${expansion.requestedCount} 個建議。`
                        : "本輪沒有新增不同且有足夠依據的建議，既有清單保持不變。"}
                    </span>
                  )}
                  {shortfall && (
                    <p>未補足本輪目標數量；既有清單保留。</p>
                  )}
                </>
              ) : null}
            </div>
            {expansion && (
              <details className="mission-more-provenance">
                <summary>
                  最近一次追加分析的模型與用量
                  <ChevronRight size={14} aria-hidden="true" />
                </summary>
                <p>產生於 {analysisDate(expansion.generatedAt)}</p>
                <ModelSummary execution={expansion.modelExecution} analysis />
                <EfficiencySummary
                  title="這次追加建議用量"
                  metrics={expansion.efficiency}
                />
              </details>
            )}
          </div>
          {recommendationError && (
            <div
              className="mission-alert mission-alert-error mission-more-error"
              role="alert"
            >
              <span>{recommendationError}</span>
              <button
                type="button"
                onClick={onRecommendMore}
                disabled={moreDisabled}
              >
                重試產出
                <RefreshCw size={13} />
              </button>
            </div>
          )}
          <div
            className="mission-idea-organization"
            hidden={!savingPreferences && hiddenIdeas.length === 0}
          >
            <p role="status" aria-live="polite" hidden={!savingPreferences}>
              {savingPreferences ? "正在儲存排列與顯示設定…" : ""}
            </p>
            {hiddenIdeas.length > 0 && (
              <details key={repo.id} className="mission-hidden-ideas">
                <summary ref={hiddenSummary}>
                  <EyeOff size={14} aria-hidden="true" />
                  已隱藏 {hiddenIdeas.length} 個建議
                  <ChevronRight size={14} aria-hidden="true" />
                </summary>
                <ul>
                  {hiddenIdeas.map((idea) => (
                    <li key={idea.id}>
                      <span>{idea.title}</span>
                      <button
                        type="button"
                        disabled={preferencesDisabled}
                        onClick={() => setHidden(idea.id, false)}
                        aria-label={`恢復顯示：${idea.title}`}
                      >
                        <Eye size={14} aria-hidden="true" />恢復顯示
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          {preferenceError && (
            <div className="mission-alert mission-alert-error mission-more-error" role="alert">
              <span>{preferenceError}</span>
            </div>
          )}
          {droppedIdeas.length > 0 && (
            <details className="mission-dropped-ideas">
              <summary>
                引文核對未通過，已略過 {droppedIdeas.length} 個建議
                <ChevronRight size={14} aria-hidden="true" />
              </summary>
              <p>
                這些建議引用的原文不在送進模型的節錄中，因此只保留標題與原因；其餘分析結果照常儲存，可再「產出新建議」補足。
              </p>
              <ul>
                {droppedIdeas.map((entry) => (
                  <li key={`${entry.round}-${entry.id}`}>
                    <strong>{entry.title}</strong>
                    <span>{entry.round}</span>
                    <p>{entry.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {droppedPaths.length > 0 && (
            <details className="mission-dropped-ideas">
              <summary>
                因引用未抽樣／不存在的檔案而略過 {droppedPaths.length} 項說明
                <ChevronRight size={14} aria-hidden="true" />
              </summary>
              <p>
                模型只讀過抽樣檔案的內容，其餘路徑只知道存在；依據必須來自讀過的檔案，不在清單中的路徑則無法核對。其餘分析結果照常儲存。
              </p>
              <ul>
                {droppedPaths.map((entry, index) => (
                  <li key={`${entry.field}-${entry.path}-${index}`}>
                    <strong>{droppedPathField[entry.field]}</strong>
                    <span>{entry.path}</span>
                    <p>{entry.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {shownIdeas.length ? (
            <>
              <div className="mission-idea-navigation">
                <p id="mission-ideas-navigation">
                  左右滑動，或聚焦清單後按方向鍵
                  <span>
                    顯示 {visibleIdeas.first}
                    {visibleIdeas.last > visibleIdeas.first &&
                      `–${visibleIdeas.last}`}
                    {` / ${shownIdeas.length} 個顯示中的建議`}
                  </span>
                </p>
                <div>
                  <button
                    type="button"
                    aria-label="上一個建議"
                    aria-controls={`mission-idea-rail-${repo.id}`}
                    disabled={!visibleIdeas.previous}
                    onClick={() => scrollIdeas(-1)}
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="下一個建議"
                    aria-controls={`mission-idea-rail-${repo.id}`}
                    disabled={!visibleIdeas.next}
                    onClick={() => scrollIdeas(1)}
                  >
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div
                key={`${repo.id}-${insights.generatedAt}`}
                className={`mission-idea-list${draggedId ? " mission-idea-list-dragging" : ""}`}
                id={`mission-idea-rail-${repo.id}`}
                ref={ideaRail}
                role="region"
                aria-label="貢獻建議橫向清單"
                aria-describedby="mission-ideas-navigation"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    scrollIdeas(event.key === "ArrowLeft" ? -1 : 1);
                  }
                }}
              >
                {shownIdeas.map((idea, index) => {
                  const direction = directionOptions.find(
                    (option) => option.value === idea.direction,
                  );
                  const Icon = direction?.icon ?? Lightbulb;
                  return (
                    <article
                      className={`mission-idea${addedIds.has(idea.id) ? " mission-idea-new" : ""}${draggedId === idea.id ? " mission-idea-dragging" : ""}${draggedId && dropTarget?.id === idea.id ? ` mission-idea-drop-${dropTarget.side}` : ""}`}
                      key={idea.id}
                      id={ideaAnchor(idea.id)}
                      data-recommendation-id={idea.id}
                      tabIndex={-1}
                      aria-labelledby={`${ideaAnchor(idea.id)}-title`}
                    >
                      <div className="mission-idea-utilities" aria-label={`管理建議：${idea.title}`}>
                        <button
                          type="button"
                          className="mission-idea-drag-handle"
                          disabled={preferencesDisabled}
                          aria-label={`拖曳排序：${idea.title}；也可使用向左或向右移動按鈕`}
                          title="拖曳排序，或使用旁邊的左右按鈕"
                          onPointerDown={(event) => {
                            if (preferencesDisabled || event.button !== 0 || !event.isPrimary) return;
                            event.currentTarget.setPointerCapture(event.pointerId);
                            pointerDrag.current = {
                              pointerId: event.pointerId,
                              id: idea.id,
                              startX: event.clientX,
                              startY: event.clientY,
                              x: event.clientX,
                              y: event.clientY,
                              active: false,
                            };
                          }}
                          onPointerMove={(event) => {
                            const pointer = pointerDrag.current;
                            if (!pointer || pointer.pointerId !== event.pointerId || preferencesDisabled) return;
                            pointer.x = event.clientX;
                            pointer.y = event.clientY;
                            if (!pointer.active && Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) >= 6) {
                              pointer.active = true;
                              setDrag({ repoId: repo.id, id: idea.id });
                            }
                          }}
                          onPointerUp={finishDrag}
                          onPointerCancel={resetDrag}
                          onLostPointerCapture={resetDrag}
                        >
                          <GripVertical size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={preferencesDisabled || index === 0}
                          title="向左移動"
                          aria-label={`向左移動：${idea.title}`}
                          onClick={() => saveOrder(idea.id, shownIdeas[index - 1].id, "before")}
                        >
                          <ChevronLeft size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={preferencesDisabled || index === shownIdeas.length - 1}
                          title="向右移動"
                          aria-label={`向右移動：${idea.title}`}
                          onClick={() => saveOrder(idea.id, shownIdeas[index + 1].id, "after")}
                        >
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="mission-idea-hide"
                          disabled={preferencesDisabled}
                          aria-label={`隱藏：${idea.title}`}
                          title="隱藏此建議，可稍後恢復"
                          onClick={() => setHidden(idea.id, true)}
                        >
                          <EyeOff size={14} aria-hidden="true" />隱藏
                        </button>
                      </div>
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
                        {addedIds.has(idea.id) && (
                          <span className="mission-idea-new-badge">本輪新增</span>
                        )}
                      </div>
                      <h3 id={`${ideaAnchor(idea.id)}-title`}>{idea.title}</h3>
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
            </>
          ) : (
            <div className="mission-no-ideas">
              <p>
                {hiddenIdeas.length
                  ? `你已隱藏全部 ${hiddenIdeas.length} 個建議。展開上方「已隱藏」清單，就能選擇恢復顯示。`
                  : "這次分析尚未提出有足夠依據的建議。你可以指定想改善的方向，再讓團隊確認範圍。"}
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
