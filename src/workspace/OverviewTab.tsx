import { lazy, Suspense, type Dispatch, type SetStateAction } from "react";
import { getDemo } from "../demo";
import { useLocale, useT, withMessages, type Messages } from "../i18n";
import type { Repo, Run } from "../types";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type {
  ContributionBrief,
  ContributionRecommendation,
} from "../../shared/insights";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { runSetupNeeds, SetupNeeds } from "../team/SetupNeeds";

// The overview is the largest view in the app; it loads with its first visit.
const ProjectOverview = lazy(() =>
  withMessages(import("../mission/ProjectOverview")).then((module) => ({
    default: module.ProjectOverview,
  })),
);

/**
 * The run's contribution brief, built from the settings it started with;
 * `defaults` fills what the settings leave open.
 */
function contributionBrief(
  value: Run,
  defaults: Messages["workspace"]["brief"],
): ContributionBrief | undefined {
  const settings = value.contributionSettings;
  if (!settings) return;
  return {
    problem: value.prompt,
    motivation: settings.outcome || defaults.motivation,
    beneficiaries: settings.targetUser ? [settings.targetUser] : [],
    before: defaults.before,
    after: settings.outcome || defaults.after,
    validation: settings.acceptance.split("\n").filter(Boolean),
    risks: settings.constraints ? [settings.constraints] : [defaults.risk],
  };
}

interface OverviewTabProps {
  currentRepo: Repo;
  run: Run;
  demo: boolean;
  intelligence: ReturnType<typeof useProjectInsights>;
  chooseRecommendation: (idea: ContributionRecommendation) => void;
  setTab: Dispatch<SetStateAction<Tab>>;
  /** Updates BELL's clone to the latest default branch; absent for local imports and the demo. */
  onUpdateRepo?: () => void;
  updatingRepo: boolean;
  /** Checks the run's premise against its code; absent while it cannot run. */
  onCheckPremise?: () => void;
  checkingPremise?: boolean;
}

/** The workspace's first tab: the project overview and why this change. */
export function OverviewTab({
  currentRepo,
  run,
  demo,
  intelligence,
  chooseRecommendation,
  setTab,
  onUpdateRepo,
  updatingRepo,
  onCheckPremise,
  checkingPremise,
}: OverviewTabProps) {
  const t = useT("workspace");
  const setupMessages = useT("team").setupNeeds;
  const [locale] = useLocale();
  return (
    <>
    {/* What the agents could not run here: the person installs it. */}
    <SetupNeeds
      needs={runSetupNeeds(
        run,
        (number) => setupMessages.round({ number }),
        (name, id) => setupMessages.agent({ name, id }),
      )}
    />
    {/* A chunk that fails to load stops at this tab; the draft and the
        review keep what the person typed. */}
    <ErrorBoundary resetKey={run.id}>
    <Suspense fallback={null}>
    <ProjectOverview
      repo={currentRepo}
      run={run}
      insights={intelligence.insights}
      brief={
        demo
          ? getDemo(locale).contributionBrief
          : contributionBrief(run, t.brief)
      }
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
      onUpdateRepo={onUpdateRepo}
      updatingRepo={updatingRepo}
      onCheckPremise={onCheckPremise}
      checkingPremise={checkingPremise}
    />
    </Suspense>
    </ErrorBoundary>
    </>
  );
}
