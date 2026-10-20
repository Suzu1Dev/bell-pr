import { CirclePlay, Compass, FolderGit2, GitPullRequest } from "lucide-react";
import { ByHandChip, byHandTurn } from "../app/byHandStatus";
import { Logo } from "../brand/Logo";
import { useT } from "../i18n";
import { SetupChecklist } from "../setup/SetupChecklist";
import type { DoctorState } from "../setup/useDoctor";
import type { Repo, RunSummary } from "../types";
import "./home.css";

/** How many of the person's runs "Continue where you left off" lists. */
export const recentRunLimit = 4;

/**
 * The runs to continue: the one opened last first, then the newest. The
 * sample run is not one of them.
 */
export function recentRuns(
  runs: readonly RunSummary[],
  lastRunId?: string,
  limit = recentRunLimit,
): RunSummary[] {
  const newest = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const last = newest.find((run) => run.id === lastRunId);
  return (last ? [last, ...newest.filter((run) => run !== last)] : newest).slice(
    0,
    limit,
  );
}

export interface HomePageProps {
  runs: RunSummary[];
  repos: Repo[];
  /** The environment report the shell shares. */
  doctor: DoctorState;
  /** present=1: the environment summary stays off screen. */
  presenting: boolean;
  maskUser: (value: string) => string;
  maskPath: (value: string) => string;
  /** The run opened last (localStorage `bellpr-last-run`). */
  lastRunId?: string;
  openSample: () => void;
  openImport: () => void;
  openDiscovery: () => void;
  chooseRun: (id: string) => Promise<boolean>;
}

/**
 * Where the app opens: the logo and what BELL PR is for, the three ways to
 * start, a short environment summary and the runs to come back to.
 */
export function HomePage({
  runs,
  repos,
  doctor,
  presenting,
  maskUser,
  maskPath,
  lastRunId,
  openSample,
  openImport,
  openDiscovery,
  chooseRun,
}: HomePageProps) {
  const t = useT("home");
  const statusLabels = useT("common").runStatus;
  const { turn: yourTurn, badge: byHandBadge } = useT("workspace").byHand;
  const recent = recentRuns(runs, lastRunId);
  const choices = [
    {
      id: "sample",
      icon: CirclePlay,
      title: t.start.sample.title,
      text: t.start.sample.text,
      onClick: openSample,
    },
    {
      id: "import",
      icon: FolderGit2,
      title: t.start.import.title,
      text: t.start.import.text,
      onClick: openImport,
    },
    {
      id: "discover",
      icon: Compass,
      title: t.start.discover.title,
      text: t.start.discover.text,
      onClick: openDiscovery,
    },
  ] as const;
  return (
    <section className="page-content home-page">
      <header className="home-hero">
        <Logo variant="wordmark" size={44} className="home-logo" />
        <h1 tabIndex={-1}>{t.tagline}</h1>
      </header>
      <section className="home-section" aria-labelledby="home-start-heading">
        <h2 id="home-start-heading">{t.start.heading}</h2>
        <div className="home-choices">
          {choices.map(({ id, icon: Icon, title, text, onClick }) => (
            <button
              key={id}
              type="button"
              className={`home-choice home-choice-${id}`}
              onClick={onClick}
            >
              <Icon size={22} aria-hidden="true" />
              <span className="home-choice-text">
                <strong className="home-choice-title">{title}</strong>
                <span>{text}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      {!presenting && (
        <section className="home-section" aria-labelledby="home-setup-heading">
          <h2 id="home-setup-heading">{t.setup.heading}</h2>
          <SetupChecklist
            {...doctor}
            variant="summary"
            detailsHref="#/settings/environment"
            maskUser={maskUser}
            maskPath={maskPath}
          />
        </section>
      )}
      {recent.length > 0 && (
        <section className="home-section" aria-labelledby="home-continue-heading">
          <h2 id="home-continue-heading">{t.continue.heading}</h2>
          <ul className="home-runs">
            {recent.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className="home-run"
                  onClick={() => void chooseRun(run.id)}
                >
                  <GitPullRequest size={18} aria-hidden="true" />
                  <span className="home-run-text">
                    <strong>{run.title}</strong>
                    <small>
                      {t.continue.detail({
                        repo:
                          repos.find((repo) => repo.id === run.repoId)?.fullName ?? "",
                        status: byHandTurn(run) ? yourTurn : statusLabels[run.status],
                      })}
                    </small>
                  </span>
                  {run.learnByHand && <ByHandChip label={byHandBadge} />}
                  {run.id === lastRunId && (
                    <span className="home-run-last">{t.continue.lastOpened}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
