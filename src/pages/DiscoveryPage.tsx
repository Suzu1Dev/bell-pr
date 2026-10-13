import { lazy, Suspense } from "react";
import type {
  ContributionOpportunity,
  DiscoveryCandidate,
} from "../../shared/discovery";

const DiscoveryPanel = lazy(() => import("../discovery/DiscoveryPanel"));

interface DiscoveryPageProps {
  chooseOpportunity: (
    idea: ContributionOpportunity,
    candidate: DiscoveryCandidate,
  ) => Promise<void>;
}

/** GitHub-wide discovery of projects and issues to contribute to. */
export function DiscoveryPage({ chooseOpportunity }: DiscoveryPageProps) {
  return (
    <section className="page-content">
      <Suspense
        fallback={<div className="empty-state">正在載入貢獻探索…</div>}
      >
        <DiscoveryPanel onChoose={chooseOpportunity} />
      </Suspense>
    </section>
  );
}
