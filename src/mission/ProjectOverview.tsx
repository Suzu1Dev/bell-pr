import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  Languages,
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
import type { Formatters } from "../../shared/i18n/locale";
import type { Entitlements } from "../../shared/plans";
import { getDemo } from "../demo";
import { useFormat, useLocale, useT, type Messages } from "../i18n";
import type { Repo, Run } from "../types";
import { EfficiencySummary } from "../efficiency/EfficiencySummary";
import { ProBadge } from "../license/ProBadge";
import { requestUpgrade } from "../license/useEntitlements";
import { ModelSummary } from "../models/ModelSummary";
import { directionOptions } from "./DirectionSettings";
import { usePlan } from "./plan";
import { useSampleAnalysis } from "./sample-analysis";
import { FailureText } from "../FailureText";
import { knownVerdict, PremiseNotice } from "../team/PremiseNotice";
import {
  moveRecommendation,
  orderedRecommendations,
} from "./recommendation-preferences";
import "./mission.css";

// "Before you contribute": its own chunk, with the rule classifier.
const ContributionRulesCard = lazy(() => import("./ContributionRulesCard"));

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
  /**
   * Whether "Generate 5 more" may run (Pro and the trial). When absent it
   * follows `entitlements`, or the plan read from the server. The sample
   * project is never locked.
   */
  canRecommendMore?: boolean;
  /**
   * Checks the request's assumption of a finished run against its code and
   * reports: again, or for the first time on a run made before premise
   * checks. Absent while the check cannot run (the sample, an active run).
   */
  onCheckPremise?: () => void;
  checkingPremise?: boolean;
  /** What the plan unlocks, when the parent knows it. */
  entitlements?: Entitlements;
}

type MissionMessages = Messages["mission"];

function analysisDate(fmt: Formatters, value?: string) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf())
    ? fmt.dateTime(date, {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
}

/** Caches written before coverage was recorded say so instead of showing zeros. */
function sampleCoverage(
  t: MissionMessages,
  sample: ProjectInsights["sample"],
) {
  if (!sample) return t.project.coverageUnknown;
  return t.project.coverage({
    sampled: sample.sampledFiles,
    tracked: sample.trackedFiles,
    kilobytes: Math.max(1, Math.round(sample.bytes / 1024)),
    truncated: sample.truncatedFiles,
  });
}

/**
 * Explains how far the repository has moved from the analyzed version. Every
 * variant still asks for a re-analysis: an unchanged cited file does not make
 * the rest of the overview current.
 */
function staleNotice(
  t: MissionMessages,
  fmt: Formatters,
  baseSha: string,
  detail?: InsightsStaleDetail,
) {
  const sha = baseSha ? baseSha.slice(0, 7) : undefined;
  if (!detail) return t.stale.unknown;
  if (detail.changedFiles === 0) return t.stale.sameContent;
  if (!detail.citedChanged.length)
    return t.stale.uncited({ changed: detail.changedFiles, sha });
  return t.stale.cited({
    changed: detail.changedFiles,
    sha,
    cited: detail.citedChanged.length,
    // The server lists at most 12 cited files.
    capped: detail.citedChanged.length >= 12,
    files: fmt.list(detail.citedChanged, { type: "unit" }),
  });
}

function EvidencePaths({
  paths,
  details,
}: {
  paths: string[];
  details?: ContributionRecommendation["evidenceDetails"];
}) {
  const t = useT("mission").evidence;
  if (!paths.length)
    return <span className="mission-no-evidence">{t.none}</span>;
  return (
    <div className="mission-source-evidence">
      <div className="mission-evidence-paths" aria-label={t.filesLabel}>
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
            {t.quotes} <span>{details.length}</span>
            <ChevronRight size={14} />
          </summary>
          <p className="mission-quote-note">{t.quotesNote}</p>
          {details.map((item, index) => (
            <figure key={`${item.path}-${index}`}>
              <figcaption>
                <code>{item.path}</code>
              </figcaption>
              <blockquote>{item.quote}</blockquote>
              <p>
                <strong>{t.why}</strong>
                {item.reason}
              </p>
            </figure>
          ))}
        </details>
      )}
    </div>
  );
}

/** The reading steps shown before "Show all". */
const firstReadingSteps = 2;

/** The overview's sections that the section nav links to. */
type OverviewSection =
  | "purpose"
  | "journey"
  | "reading"
  | "contribution"
  | "directions";

/** The element id of a section, such as `overview-directions`. */
const sectionAnchor = (section: OverviewSection) => `overview-${section}`;

/** Scrolls `target` to the top, below the sticky section nav, and focuses it. */
function showSection(target: HTMLElement) {
  target.scrollIntoView({
    block: "start",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  target.focus({ preventScroll: true });
}

/**
 * The sticky in-page nav. A link scrolls to its section and keeps the
 * route in the address; the section in view is marked as the current one.
 */
function SectionNav({ sections }: { sections: OverviewSection[] }) {
  const t = useT("mission").sections;
  const [current, setCurrent] = useState<OverviewSection>();
  const list = useRef<HTMLUListElement>(null);
  const sectionKey = sections.join(" ");
  // On a narrow screen the links scroll sideways; keep the current one shown.
  useEffect(() => {
    const links = list.current;
    const link = links?.querySelector("[aria-current]");
    if (!links || !link) return;
    const box = links.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    if (item.left < box.left) links.scrollLeft -= box.left - item.left;
    else if (item.right > box.right) links.scrollLeft += item.right - box.right;
  }, [current]);
  // A link to a section, such as #overview-directions, scrolls to it; the
  // nav mounts with the sections, so a link followed while the analysis
  // loaded works too. The router keeps the route for such an anchor.
  useEffect(() => {
    const follow = () => {
      const anchor = window.location.hash.slice(1);
      const target = anchor.startsWith("overview-")
        ? document.getElementById(anchor)
        : null;
      if (target) showSection(target);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const shown = sectionKey.split(" ") as OverviewSection[];
    const inView = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) inView.add(entry.target.id);
          else inView.delete(entry.target.id);
        const first = shown.find((section) => inView.has(sectionAnchor(section)));
        if (first) setCurrent(first);
      },
      // The band below the nav where a section counts as the one being read.
      { rootMargin: "-72px 0px -50% 0px" },
    );
    for (const section of shown) {
      const element = document.getElementById(sectionAnchor(section));
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sectionKey]);
  return (
    <nav className="mission-section-nav" aria-label={t.label}>
      <ul ref={list}>
        {sections.map((section) => (
          <li key={section}>
            <a
              href={`#${sectionAnchor(section)}`}
              aria-current={current === section ? "location" : undefined}
              onClick={(event) => {
                const target = document.getElementById(sectionAnchor(section));
                if (!target) return;
                event.preventDefault();
                setCurrent(section);
                showSection(target);
              }}
            >
              {t[section]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const MarkdownContent = lazy(() =>
  import("../review/MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

/**
 * A short label opening a line, with an optional full-width parenthetical,
 * before a full-width colon, as zh-TW requests label their sections.
 */
const sectionLabel =
  // i18n-allow: parser
  /^([^\s\d：:（(，。、,.*+#>`|-][^\n：:（(，。、,.]{0,11})((?:（[^）\n]*）)?)：/;
/** The same in English: "User impact:", "Source evidence (…):". */
const englishSectionLabel = /^([A-Z][A-Za-z ]{0,23}?)((?: \([^)\n]*\))?):(?= |$)/;

/**
 * Bolds the label of each section in a request written as labelled lines
 * ("Problem:", "Acceptance:"), and starts each section as its own paragraph
 * so it never reads as the continuation of a list item above it. List
 * items, sentences and long phrases are left alone.
 */
export function briefMarkdown(text: string) {
  return text
    .split("\n")
    .map((line, index) => {
      const match = sectionLabel.exec(line);
      const english = match ? null : englishSectionLabel.exec(line);
      const found = match ?? english;
      if (!found) return line;
      // i18n-allow: parser
      const colon = match ? "：" : ":";
      const section = `**${found[1]}**${found[2]}${colon}${line.slice(found[0].length)}`;
      return index > 0 ? `\n${section}` : section;
    })
    .join("\n");
}

/** Request and direction text as Markdown, its line breaks kept as written. */
function BriefText({ text }: { text: string }) {
  return (
    <Suspense fallback={<p>{text}</p>}>
      <div className="mission-brief-text">
        <MarkdownContent>{briefMarkdown(text)}</MarkdownContent>
      </div>
    </Suspense>
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
  const t = useT("mission").brief;
  const premise = run.team?.premise;
  const verdict = premise ? knownVerdict(premise.verdict) : undefined;
  // Text copied from the request still states the assumption; it is labelled, never rewritten.
  const tag =
    verdict === "refuted"
      ? t.premiseRefuted
      : verdict === "unclear"
        ? t.premiseUnclear
        : undefined;
  const checkButton = onCheckPremise && (
    <button
      type="button"
      className="mission-button mission-button-secondary"
      onClick={onCheckPremise}
      disabled={checkingPremise}
    >
      {checkingPremise ? (
        <Loader2 className="mission-spin" size={15} />
      ) : premise ? (
        <RefreshCw size={15} />
      ) : (
        <Check size={15} />
      )}
      {checkingPremise
        ? t.premiseChecking
        : premise
          ? t.premiseRecheck
          : t.premiseCheck}
    </button>
  );
  return (
    <section
      id={sectionAnchor("contribution")}
      tabIndex={-1}
      className="mission-contribution"
      aria-labelledby="mission-contribution-title"
    >
      <div className="mission-section-heading">
        <div>
          <span className="mission-kicker">{t.kicker}</span>
          <h2 id="mission-contribution-title">{t.title}</h2>
        </div>
        <span className="mission-section-icon">
          <Target size={20} />
        </span>
      </div>
      <PremiseNotice premise={premise} />
      {premise && checkButton && (
        <div className="mission-premise-recheck">
          {checkButton}
          <small>{t.premiseRecheckNote}</small>
        </div>
      )}
      {!premise && checkButton && (
        <div className="mission-premise-missing">
          <p>{t.premiseMissing}</p>
          {checkButton}
        </div>
      )}
      {brief ? (
        <>
          <div
            className={`mission-contribution-reason${
              // A request written in sections reads better across the full width.
              brief.problem.length > 280 ? " is-stacked" : ""
            }`}
          >
            <div>
              <span>{t.problem}</span>
              <BriefText text={brief.problem} />
            </div>
            <div>
              <span>
                {t.motivation}
                {tag && <em className="mission-premise-tag">{tag}</em>}
              </span>
              <BriefText text={brief.motivation} />
            </div>
          </div>
          {brief.beneficiaries.length > 0 && (
            <div className="mission-beneficiaries">
              <Users size={15} />
              <span>{t.beneficiaries}</span>
              {brief.beneficiaries.map((person, index) => (
                <strong key={`${person}-${index}`}>{person}</strong>
              ))}
            </div>
          )}
          <div className="mission-before-after">
            <article className="mission-before">
              <span className="mission-change-label">
                {t.before} <span>{t.beforeCaption}</span>
              </span>
              <BriefText text={brief.before} />
            </article>
            <div className="mission-change-arrow" aria-hidden="true">
              <ArrowRight size={20} />
            </div>
            <article className="mission-after">
              <span className="mission-change-label">
                {t.after} <span>{t.afterCaption}</span>
                {tag && <em className="mission-premise-tag">{tag}</em>}
              </span>
              <BriefText text={brief.after} />
            </article>
          </div>
          <p className="mission-impact-note">
            {verdict === "refuted" ? t.impactRefuted : t.impactNote}
          </p>
          <div className="mission-validation-grid">
            {brief.validation.length > 0 && (
              <div>
                <h4>
                  <Check size={15} />
                  {t.validation}
                </h4>
                <ul>
                  {brief.validation.map((item, index) => (
                    <li key={index}>
                      <BriefText text={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brief.risks.length > 0 && (
              <div>
                <h4>
                  <Lightbulb size={15} />
                  {t.risks}
                </h4>
                <ul>
                  {brief.risks.map((item, index) => (
                    <li key={index}>
                      <BriefText text={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mission-brief-pending">
          <span className="mission-field-caption">{t.request}</span>
          <BriefText text={run.prompt} />
          <small>{t.pending}</small>
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
  canRecommendMore,
  entitlements,
  onCheckPremise,
  checkingPremise = false,
}: ProjectOverviewProps) {
  const t = useT("mission");
  const common = useT("common");
  const fmt = useFormat();
  const [locale] = useLocale();
  const demo = insights?.source === "demo";
  // An analysis written in another language than the UI's offers to be
  // written again in the UI's; the sample follows the UI by itself.
  const analysisLocale =
    insights?.locale && insights.locale !== locale && !demo
      ? insights.locale
      : undefined;
  const sampleRepo = repo.id === getDemo(locale).repo.id;
  // The sample's analysis in playback mode: its loading lines so far.
  const sampleAnalysis = useSampleAnalysis();
  const analysisSteps =
    !insights && loading && sampleRepo ? sampleAnalysis.steps : [];
  // The sample reads no plan, also while its analysis plays.
  const plan = usePlan({
    entitlements,
    demo,
    read: canRecommendMore === undefined && !sampleRepo,
  });
  // On Free, "Generate 5 more" is Pro; the sample shows it unlocked.
  const moreLocked =
    !demo &&
    (canRecommendMore === undefined
      ? plan.locked("moreRecommendations")
      : !canRecommendMore);
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
  const dateLabel = analysisDate(fmt, insights?.generatedAt);
  const expansion = insights?.recommendationExpansion;
  // Proposals whose quotes failed the server check: only their title and reason are known.
  const droppedIdeas = [
    ...(insights?.verification?.droppedRecommendations ?? []).map((entry) => ({
      ...entry,
      round: "analysis" as const,
    })),
    ...(expansion?.verification?.droppedRecommendations ?? []).map((entry) => ({
      ...entry,
      round: "expansion" as const,
    })),
  ];
  // Modules, reading steps and evidence notes the server removed for citing files outside the sample.
  const droppedPaths = insights?.verification?.droppedPaths ?? [];
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
  // The sample has one prewritten batch to add.
  const demoMoreShown = demo && !!expansion;
  const moreDisabled =
    updatingRepo ||
    loading ||
    recommending ||
    savingPreferences ||
    !insights ||
    stale ||
    moreLocked ||
    demoMoreShown ||
    insights.recommendations.length >= maxProjectRecommendations;
  const moreDescription = demo
    ? demoMoreShown
      ? t.ideas.moreDemoShown
      : t.ideas.moreDemo
    : moreLocked
      ? t.ideas.moreLocked
      : stale
        ? t.ideas.moreStale
        : (insights?.recommendations.length ?? 0) >= maxProjectRecommendations
          ? t.ideas.moreLimit({ max: maxProjectRecommendations })
          : t.ideas.moreHint;
  // A run's overview leads with its brief, the project as its background,
  // and keeps where else to help last. Without a run (a project just
  // imported), where to help comes right after the project card.
  const sections: OverviewSection[] = insights
    ? [
        ...(run ? (["contribution"] as const) : []),
        "purpose",
        ...(run ? [] : (["directions"] as const)),
        ...(insights.userJourney.length ? (["journey"] as const) : []),
        ...(insights.readingPath?.length ? (["reading"] as const) : []),
        ...(run ? (["directions"] as const) : []),
      ]
    : [];
  // The reading path opens on its first steps; "Show all" lists the rest
  // until another analysis or repository shows.
  const [expandedReading, setExpandedReading] = useState<string>();
  const readingKey = `${repo.id}:${insights?.generatedAt ?? ""}`;
  const allReadingSteps = expandedReading === readingKey;
  // How people use the project, where to start reading and its parts.
  const projectContext = insights && (
    <>
      {insights.userJourney.length > 0 && (
        <section
          id={sectionAnchor("journey")}
          tabIndex={-1}
          className="mission-journey"
          aria-labelledby="mission-journey-title"
        >
          <div className="mission-section-heading">
            <div>
              <span className="mission-kicker">{t.journey.kicker}</span>
              <h2 id="mission-journey-title">
                <Route size={18} />
                {t.journey.title}
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
          id={sectionAnchor("reading")}
          tabIndex={-1}
          className="mission-reading-path"
          aria-labelledby="mission-reading-title"
        >
          <div className="mission-section-heading">
            <div>
              <span className="mission-kicker">{t.reading.kicker}</span>
              <h2 id="mission-reading-title">
                <BookOpen size={18} />
                {t.reading.title}
              </h2>
              <p>{t.reading.lead}</p>
            </div>
          </div>
          {insights.howItFitsTogether && (
            <div className="mission-reading-flow">
              <span>{t.reading.flow}</span>
              <p>{insights.howItFitsTogether}</p>
            </div>
          )}
          <ol className="mission-reading-steps" id="mission-reading-steps">
            {insights.readingPath.map((step, index) => {
              const module = insights.modules.find(
                (entry) => entry.path === step.path,
              );
              const evidence = insights.evidence.find(
                (entry) => entry.path === step.path,
              );
              return (
                <li
                  key={`${step.path}-${index}`}
                  hidden={!allReadingSteps && index >= firstReadingSteps}
                >
                  <span className="mission-journey-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <code>{step.path}</code>
                  {step.sampled === false && (
                    <span className="mission-reading-unsampled">
                      {t.reading.unsampled}
                    </span>
                  )}
                  <p>{step.why}</p>
                  <p>
                    <strong>{t.reading.lookFor}</strong>
                    {step.lookFor}
                  </p>
                  {(module || evidence) && (
                    <details className="mission-reading-context">
                      <summary>
                        {t.reading.context}
                        <ChevronRight size={14} aria-hidden="true" />
                      </summary>
                      {module && (
                        <p>
                          <strong>{t.fields.modules}</strong>
                          {module.purpose}
                        </p>
                      )}
                      {evidence && (
                        <p>
                          <strong>{t.fields.evidence}</strong>
                          {evidence.note}
                        </p>
                      )}
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
          {insights.readingPath.length > firstReadingSteps && (
            <button
              type="button"
              className="mission-text-button mission-reading-toggle"
              aria-expanded={allReadingSteps}
              aria-controls="mission-reading-steps"
              onClick={() =>
                setExpandedReading(allReadingSteps ? undefined : readingKey)
              }
            >
              {allReadingSteps
                ? t.reading.showFirst({ count: firstReadingSteps })
                : t.reading.showAll({ count: insights.readingPath.length })}
              <ChevronRight
                size={14}
                aria-hidden="true"
                className={allReadingSteps ? "mission-chevron-up" : "mission-chevron-down"}
              />
            </button>
          )}
        </section>
      )}

      {(insights.modules.length > 0 || insights.evidence.length > 0) && (
        <div className="mission-project-details">
          {insights.modules.length > 0 && (
            <details className="mission-detail-block">
              <summary>
                <FolderTree size={16} />
                <span>{t.details.modules}</span>
                <span className="mission-detail-count">
                  {t.details.moduleCount({
                    count: insights.modules.length,
                  })}
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
                <span>{t.details.sources}</span>
                <span className="mission-detail-count">
                  {t.details.sourceCount({
                    count: insights.evidence.length,
                  })}
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
  );
  return (
    <div className="mission-overview">
      {/* This contribution first; the project's analysis is its background. */}
      {run && (
        <Brief
          run={run}
          brief={brief}
          onCheckPremise={onCheckPremise}
          checkingPremise={checkingPremise}
        />
      )}
      <div className="mission-overview-heading">
        <div>
          <span className="mission-kicker">
            <BookOpen size={14} />
            {t.overview.kicker}
          </span>
          <h2>{t.overview.title}</h2>
          <p>{t.overview.lead}</p>
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
              {updatingRepo ? t.overview.updating : t.overview.update}
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
            {loading
              ? t.overview.analyzing
              : insights
                ? t.overview.reanalyze
                : t.overview.analyze}
          </button>
          {onUpdateRepo && (
            <p id="mission-update-help" className="mission-update-help">
              {t.overview.updateHelp({
                branch: repo.defaultBranch,
                updatedAt: repo.updatedAt
                  ? fmt.dateTime(repo.updatedAt)
                  : undefined,
              })}
            </p>
          )}
        </div>
      </div>

      {sections.length > 0 && <SectionNav sections={sections} />}

      {error && (
        <div className="mission-alert mission-alert-error" role="alert">
          <span>
            <FailureText text={error} />
          </span>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={loading || recommending || savingPreferences || updatingRepo}
          >
            {common.actions.retry}
            <RefreshCw size={13} />
          </button>
        </div>
      )}
      {stale && insights && (
        <div className="mission-alert" role="status">
          <RefreshCw size={15} />
          <span>{staleNotice(t, fmt, insights.baseSha, staleDetail)}</span>
        </div>
      )}
      {analysisLocale && (
        <div className="mission-alert mission-alert-info" role="status">
          <Languages size={15} aria-hidden="true" />
          <span>
            {t.localeNotice.analyzedIn({
              language: t.languages[analysisLocale],
            })}
          </span>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={loading || recommending || savingPreferences || updatingRepo}
          >
            {t.localeNotice.reanalyze({ language: t.languages[locale] })}
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      <Suspense fallback={null}>
        <ContributionRulesCard repoId={repo.id} rules={repo.contributionRules} demo={sampleRepo} />
      </Suspense>

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
          <h3>{loading ? t.empty.loadingTitle : t.empty.title}</h3>
          <p>{loading ? t.empty.loadingLead : t.empty.lead}</p>
          {analysisSteps.length > 0 && (
            <div className="mission-analysis-steps">
              <div
                className="mission-analysis-progress"
                role="progressbar"
                aria-label={t.empty.progressLabel}
                aria-valuemin={0}
                aria-valuemax={sampleAnalysis.total}
                aria-valuenow={analysisSteps.length}
              >
                <span
                  style={{
                    width: `${Math.round((100 * analysisSteps.length) / Math.max(1, sampleAnalysis.total + 1))}%`,
                  }}
                />
              </div>
              <ol>
                {analysisSteps.map((step, index) => {
                  const done =
                    index < analysisSteps.length - 1 || !sampleAnalysis.playing;
                  return (
                    <li key={index} className={done ? "done" : "current"}>
                      {done ? (
                        <Check size={14} aria-hidden="true" />
                      ) : (
                        <Loader2
                          className="mission-spin"
                          size={14}
                          aria-hidden="true"
                        />
                      )}
                      <span>{step}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
          <div className="mission-discovery-points">
            <span>
              <Target size={18} />
              <strong>{t.empty.questions.problem}</strong>
            </span>
            <span>
              <Users size={18} />
              <strong>{t.empty.questions.users}</strong>
            </span>
            <span>
              <Lightbulb size={18} />
              <strong>{t.empty.questions.improve}</strong>
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
              {t.empty.start}
              <ArrowRight size={15} />
            </button>
          )}
          <small>{t.empty.note}</small>
        </section>
      ) : (
        <>
          <section
            id={sectionAnchor("purpose")}
            tabIndex={-1}
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
                {insights.source === "demo"
                  ? t.project.sourceDemo
                  : t.project.sourceAi}
              </span>
            </div>
            <h3 id="mission-purpose-title">{insights.summary}</h3>
            <p className="mission-project-purpose">{insights.purpose}</p>
            {insights.audience.length > 0 && (
              <div className="mission-audience">
                <span>
                  <Users size={14} />
                  {t.project.audience}
                </span>
                {insights.audience.map((person, index) => (
                  <strong key={`${person}-${index}`}>{person}</strong>
                ))}
              </div>
            )}
            <div className="mission-analysis-footer">
              <span>
                {dateLabel && t.project.updatedAt({ date: dateLabel })}
                {insights.baseSha && (
                  <>
                    {" "}
                    · {t.project.version}{" "}
                    <code>{insights.baseSha.slice(0, 7)}</code>
                  </>
                )}
              </span>
              <span>
                {insights.source === "demo"
                  ? t.project.demoNote
                  : sampleCoverage(t, insights.sample)}
              </span>
            </div>
            <ModelSummary
              execution={insights.modelExecution}
              demo={insights.source === "demo"}
              analysis
            />
            <EfficiencySummary
              title={t.project.usageTitle}
              metrics={insights.efficiency}
              demo={insights.source === "demo"}
            />
          </section>

          {run && projectContext}
        </>
      )}

      {insights && (
        <section
          id={sectionAnchor("directions")}
          tabIndex={-1}
          className="mission-recommendations"
          aria-labelledby="mission-ideas-title"
        >
          <div className="mission-section-heading">
            <div>
              <span className="mission-kicker">{t.ideas.kicker}</span>
              <h2 id="mission-ideas-title">
                <Lightbulb size={18} />
                {t.ideas.title}
              </h2>
              <p>{t.ideas.lead}</p>
            </div>
            <div className="mission-ideas-actions">
              {insights.source === "ai" && (
                <span className="mission-source">
                  <Sparkles size={12} aria-hidden="true" />
                  {t.ideas.aiGenerated}
                </span>
              )}
              <span className="mission-ideas-count">
                {insights.source === "demo"
                  ? t.ideas.sampleCount({
                      count: insights.recommendations.length,
                    })
                  : t.ideas.recommendationCount({
                      count: insights.recommendations.length,
                    })}
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
                  ? t.ideas.generating({ count: requestedCount })
                  : requestedCount
                    ? t.ideas.more({ count: requestedCount })
                    : t.ideas.limitReached}
                {(demo || moreLocked) && <ProBadge />}
              </button>
            </div>
          </div>
          <div className="mission-more-context">
            <p id="mission-more-description">{moreDescription}</p>
            {moreLocked && (
              <button
                type="button"
                className="mission-text-button mission-upgrade-button"
                onClick={() => requestUpgrade("moreRecommendations")}
              >
                {t.ideas.seePro}
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
            <div className="mission-more-status" role="status" aria-live="polite">
              {recommending ? (
                <span>{t.ideas.generatingStatus}</span>
              ) : expansion && !recommendationError ? (
                <>
                  {firstAddedIdea ? (
                    <a
                      href={`#${encodeURIComponent(ideaAnchor(firstAddedIdea.id))}`}
                    >
                      {t.ideas.viewAdded({
                        added: addedIds.size,
                        requested: expansion.requestedCount,
                      })}
                      <ArrowRight size={14} aria-hidden="true" />
                    </a>
                  ) : (
                    <span>
                      {addedIds.size
                        ? t.ideas.addedHidden({
                            added: addedIds.size,
                            requested: expansion.requestedCount,
                          })
                        : expansion.requestedCount !== undefined
                        ? t.ideas.addedNone({
                            requested: expansion.requestedCount,
                          })
                        : t.ideas.noneAdded}
                    </span>
                  )}
                  {shortfall && (
                    <p>{t.ideas.shortfall}</p>
                  )}
                </>
              ) : null}
            </div>
            {expansion && (
              <details className="mission-more-provenance">
                <summary>
                  {t.ideas.provenance}
                  <ChevronRight size={14} aria-hidden="true" />
                </summary>
                <p>
                  {t.ideas.generatedAt({
                    date: analysisDate(fmt, expansion.generatedAt),
                  })}
                </p>
                <ModelSummary
                  execution={expansion.modelExecution}
                  demo={demo}
                  analysis
                />
                <EfficiencySummary
                  title={t.ideas.usageTitle}
                  metrics={expansion.efficiency}
                  demo={demo}
                />
              </details>
            )}
          </div>
          {recommendationError && (
            <div
              className="mission-alert mission-alert-error mission-more-error"
              role="alert"
            >
              <span>
                <FailureText text={recommendationError} />
              </span>
              <button
                type="button"
                onClick={onRecommendMore}
                disabled={moreDisabled}
              >
                {t.ideas.retry}
                <RefreshCw size={13} />
              </button>
            </div>
          )}
          <div
            className="mission-idea-organization"
            hidden={!savingPreferences && hiddenIdeas.length === 0}
          >
            <p role="status" aria-live="polite" hidden={!savingPreferences}>
              {savingPreferences ? t.ideas.savingPreferences : ""}
            </p>
            {hiddenIdeas.length > 0 && (
              <details key={repo.id} className="mission-hidden-ideas">
                <summary ref={hiddenSummary}>
                  <EyeOff size={14} aria-hidden="true" />
                  {t.ideas.hiddenCount({ count: hiddenIdeas.length })}
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
                        aria-label={t.ideas.restoreLabel({ title: idea.title })}
                      >
                        <Eye size={14} aria-hidden="true" />
                        {t.ideas.restore}
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
                {t.ideas.droppedIdeas({ count: droppedIdeas.length })}
                <ChevronRight size={14} aria-hidden="true" />
              </summary>
              <p>{t.ideas.droppedIdeasNote}</p>
              <ul>
                {droppedIdeas.map((entry) => (
                  <li key={`${entry.round}-${entry.id}`}>
                    <strong>{entry.title}</strong>
                    <span>{t.ideas.rounds[entry.round]}</span>
                    <p>{entry.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {droppedPaths.length > 0 && (
            <details className="mission-dropped-ideas">
              <summary>
                {t.ideas.droppedPaths({ count: droppedPaths.length })}
                <ChevronRight size={14} aria-hidden="true" />
              </summary>
              <p>{t.ideas.droppedPathsNote}</p>
              <ul>
                {droppedPaths.map((entry, index) => (
                  <li key={`${entry.field}-${entry.path}-${index}`}>
                    <strong>{t.fields[entry.field]}</strong>
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
                  {t.ideas.navigationHint}
                  <span>
                    {t.ideas.showing({
                      first: visibleIdeas.first,
                      last: visibleIdeas.last,
                      total: shownIdeas.length,
                    })}
                  </span>
                </p>
                <div>
                  <button
                    type="button"
                    aria-label={t.ideas.previous}
                    aria-controls={`mission-idea-rail-${repo.id}`}
                    disabled={!visibleIdeas.previous}
                    onClick={() => scrollIdeas(-1)}
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t.ideas.next}
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
                aria-label={t.ideas.railLabel}
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
                      <div className="mission-idea-utilities" aria-label={t.ideas.manageLabel({ title: idea.title })}>
                        <button
                          type="button"
                          className="mission-idea-drag-handle"
                          disabled={preferencesDisabled}
                          aria-label={t.ideas.dragLabel({ title: idea.title })}
                          title={t.ideas.dragTitle}
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
                          title={t.ideas.moveLeft}
                          aria-label={t.ideas.moveLeftLabel({ title: idea.title })}
                          onClick={() => saveOrder(idea.id, shownIdeas[index - 1].id, "before")}
                        >
                          <ChevronLeft size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={preferencesDisabled || index === shownIdeas.length - 1}
                          title={t.ideas.moveRight}
                          aria-label={t.ideas.moveRightLabel({ title: idea.title })}
                          onClick={() => saveOrder(idea.id, shownIdeas[index + 1].id, "after")}
                        >
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="mission-idea-hide"
                          disabled={preferencesDisabled}
                          aria-label={t.ideas.hideLabel({ title: idea.title })}
                          title={t.ideas.hideTitle}
                          onClick={() => setHidden(idea.id, true)}
                        >
                          <EyeOff size={14} aria-hidden="true" />
                          {t.ideas.hide}
                        </button>
                      </div>
                      <div className="mission-idea-top">
                        <span className="mission-idea-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="mission-idea-direction">
                          <Icon size={13} />
                          {t.directions[idea.direction]?.label ?? idea.direction}
                        </span>
                        <span className="mission-idea-effort">
                          {t.effort[idea.effort]}
                        </span>
                        {addedIds.has(idea.id) && (
                          <span className="mission-idea-new-badge">
                            {t.ideas.newBadge}
                          </span>
                        )}
                      </div>
                      <h3 id={`${ideaAnchor(idea.id)}-title`}>{idea.title}</h3>
                      <p className="mission-idea-problem">{idea.problem}</p>
                      <div className="mission-idea-impact">
                        <Users size={15} />
                        <p>
                          <strong>{t.ideas.userImpact}</strong>
                          {idea.userImpact}
                        </p>
                      </div>
                      <details className="mission-idea-approach">
                        <summary>
                          {t.ideas.approach}
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
                          {t.confidence[idea.confidence]}
                        </span>
                        <button
                          type="button"
                          className="mission-text-button"
                          onClick={() => onChooseRecommendation(idea)}
                        >
                          {t.ideas.choose}
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
                  ? t.ideas.allHidden({ count: hiddenIdeas.length })
                  : t.ideas.none}
              </p>
            </div>
          )}
        </section>
      )}

      {!run && projectContext}

      {(run || onStartContribution) && (
        <div className="mission-next-step">
          <div>
            <span className="mission-next-icon">
              {run ? <Code2 size={20} /> : <Target size={20} />}
            </span>
            <div>
              <strong>
                {run ? t.nextStep.codeTitle : t.nextStep.ideaTitle}
              </strong>
              <p>{run ? t.nextStep.codeLead : t.nextStep.ideaLead}</p>
            </div>
          </div>
          <button
            type="button"
            className="mission-button mission-button-primary"
            onClick={run ? onReadCode : onStartContribution}
          >
            {run ? t.nextStep.codeAction : t.nextStep.ideaAction}
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
