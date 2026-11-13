import { lazy, Suspense, type Dispatch, type SetStateAction } from "react";
import { Target } from "lucide-react";
import { useT, withMessages } from "../i18n";
import type { Repo } from "../types";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type { ContributionRecommendation } from "../../shared/insights";
import type { SuiteLinks } from "../../shared/suite";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { SuiteHandoffMenu } from "../suite/SuiteHandoffMenu";

// The overview is the largest view in the app; it loads with its first visit.
const ProjectOverview = lazy(() =>
  withMessages(import("../mission/ProjectOverview")).then((module) => ({
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
  suiteLinks?: SuiteLinks;
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
  suiteLinks,
}: ExplorePageProps) {
  const t = useT("repos").explore;
  return (
    <section className="page-content explore-page">
      <div className="page-title">
        <div>
          <h1 tabIndex={-1}>{exploreRepo.fullName}</h1>
          <p>{t.intro}</p>
        </div>
        <div className="page-title-actions">
          <SuiteHandoffMenu
            links={suiteLinks}
            title={exploreRepo.fullName}
            text={intelligence.insights?.purpose || exploreRepo.fullName}
          />
          <button
            className="button primary"
            onClick={() => beginContribution(exploreRepo.id)}
          >
            <Target size={16} />
            {t.chooseDirection}
          </button>
        </div>
      </div>
      <ErrorBoundary resetKey={exploreRepo.id}>
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
        progress={intelligence.progress}
        onAnalyze={intelligence.analyze}
        onRecommendMore={intelligence.recommendMore}
        onChooseRecommendation={chooseRecommendation}
        onReadCode={() => setTab("changes")}
        onStartContribution={() => beginContribution(exploreRepo.id)}
        onUpdateRepo={onUpdateRepo}
        updatingRepo={updatingRepo}
      />
      </Suspense>
      </ErrorBoundary>
    </section>
  );
}
