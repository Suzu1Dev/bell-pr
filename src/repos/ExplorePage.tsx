import { lazy, Suspense, type Dispatch, type SetStateAction } from "react";
import { Target } from "lucide-react";
import { useT } from "../i18n";
import type { Repo } from "../types";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type { ContributionRecommendation } from "../../shared/insights";
import type { Tab } from "../app/AppShell";

// The overview is the largest view in the app; it loads with its first visit.
const ProjectOverview = lazy(() =>
  import("../mission/ProjectOverview").then((module) => ({
    default: module.ProjectOverview,
  })),
);

interface ExplorePageProps {
  exploreRepo: Repo;
  intelligence: ReturnType<typeof useProjectInsights>;
  beginContribution: (id?: string) => void;
  chooseRecommendation: (idea: ContributionRecommendation) => void;
  setTab: Dispatch<SetStateAction<Tab>>;
  /** Updates BELL's clone to the latest default branch; absent for local imports and the demo. */
  onUpdateRepo?: () => void;
  updatingRepo: boolean;
}

/** One repository's users, problems and recommended contribution directions. */
export function ExplorePage({
  exploreRepo,
  intelligence,
  beginContribution,
  chooseRecommendation,
  setTab,
  onUpdateRepo,
  updatingRepo,
}: ExplorePageProps) {
  const t = useT("repos").explore;
  return (
    <section className="page-content explore-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1 tabIndex={-1}>{exploreRepo.fullName}</h1>
          <p>{t.intro}</p>
        </div>
        <button
          className="button primary"
          onClick={() => beginContribution(exploreRepo.id)}
        >
          <Target size={16} />
          {t.chooseDirection}
        </button>
      </div>
      <Suspense fallback={null}>
      <ProjectOverview
        repo={exploreRepo}
        insights={intelligence.insights}
        loading={intelligence.loading}
        error={intelligence.error}
        recommending={intelligence.recommending}
        recommendationError={intelligence.recommendationError}
        recommendationPreferences={intelligence.recommendationPreferences}
        savingPreferences={intelligence.savingPreferences}
        preferenceError={intelligence.preferenceError}
        onSavePreferences={intelligence.savePreferences}
        stale={intelligence.stale}
        staleDetail={intelligence.staleDetail}
        onAnalyze={intelligence.analyze}
        onRecommendMore={intelligence.recommendMore}
        onChooseRecommendation={chooseRecommendation}
        onReadCode={() => setTab("changes")}
        onStartContribution={() => beginContribution(exploreRepo.id)}
        onUpdateRepo={onUpdateRepo}
        updatingRepo={updatingRepo}
      />
      </Suspense>
    </section>
  );
}
