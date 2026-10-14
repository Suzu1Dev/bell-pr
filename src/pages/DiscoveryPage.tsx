import { lazy, Suspense } from "react";
import type {
  ContributionOpportunity,
  DiscoveryCandidate,
} from "../../shared/discovery";
import { ErrorBoundary } from "../app/ErrorBoundary";
import { useT } from "../i18n";

const DiscoveryPanel = lazy(() => import("../discovery/DiscoveryPanel"));

interface DiscoveryPageProps {
  chooseOpportunity: (
    idea: ContributionOpportunity,
    candidate: DiscoveryCandidate,
  ) => Promise<void>;
}

/** GitHub-wide discovery of projects and issues to contribute to. */
export function DiscoveryPage({ chooseOpportunity }: DiscoveryPageProps) {
  const t = useT("pages").discovery;
  return (
    <section className="page-content">
      <ErrorBoundary>
        <Suspense
          fallback={<div className="empty-state">{t.loading}</div>}
        >
          <DiscoveryPanel onChoose={chooseOpportunity} />
        </Suspense>
      </ErrorBoundary>
    </section>
  );
}
