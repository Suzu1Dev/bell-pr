import type { Dispatch, SetStateAction } from "react";
import type { Repo, Run } from "../types";
import { ProjectOverview, demoContributionBrief } from "../mission";
import type { useProjectInsights } from "../mission/useProjectInsights";
import type {
  ContributionBrief,
  ContributionRecommendation,
} from "../../shared/insights";
import type { Tab } from "../app/AppShell";

/** The run's contribution brief, built from the settings it started with. */
function contributionBrief(value: Run): ContributionBrief | undefined {
  const settings = value.contributionSettings;
  if (!settings) return;
  return {
    problem: value.prompt,
    motivation:
      settings.outcome || "這次貢獻的價值仍需由任務需求與驗收結果確認。",
    beneficiaries: settings.targetUser ? [settings.targetUser] : [],
    before: "目前存在任務描述中的問題，實際影響範圍由團隊在規劃時確認。",
    after: settings.outcome || "依任務需求改善現有行為，尚未驗證是否達成。",
    validation: settings.acceptance.split("\n").filter(Boolean),
    risks: settings.constraints
      ? [settings.constraints]
      : ["在送出前確認相容性、回歸測試與使用者行為。"],
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
}: OverviewTabProps) {
  return (
    <ProjectOverview
      repo={currentRepo}
      run={run}
      insights={intelligence.insights}
      brief={demo ? demoContributionBrief : contributionBrief(run)}
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
    />
  );
}
