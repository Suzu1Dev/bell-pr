import { ChevronRight, GitPullRequest, Plus } from "lucide-react";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import type { Repo, RunSummary } from "../types";
import { Modal } from "./Modal";

interface RunsModalProps {
  runs: RunSummary[];
  repos: Repo[];
  chooseRun: (id: string) => Promise<boolean>;
  beginContribution: () => void;
  closeModal: () => void;
}

/** Every contribution run, plus the demo, to switch between. */
export function RunsModal({
  runs,
  repos,
  chooseRun,
  beginContribution,
  closeModal,
}: RunsModalProps) {
  const t = useT("modals").runs;
  const statusLabels = useT("common").runStatus;
  const [locale] = useLocale();
  const demoRun = getDemo(locale).run;
  return (
    <Modal
      wide
      title={t.title}
      subtitle={t.subtitle}
      onClose={closeModal}
    >
      <div className="all-runs">
        {[...runs, demoRun].map((job) => (
          <button
            className="run-list-row"
            key={job.id}
            onClick={() => {
              closeModal();
              void chooseRun(job.id);
            }}
          >
            <GitPullRequest size={20} />
            <span>
              <strong>{job.title}</strong>
              <small>
                {job.id === demoRun.id
                  ? t.demo
                  : repos.find((repo) => repo.id === job.repoId)
                      ?.fullName}{" "}
                · {job.branch}
              </small>
            </span>
            <em>{statusLabels[job.status]}</em>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
      <button
        className="button primary full-width"
        onClick={() => beginContribution()}
      >
        <Plus size={15} />
        {t.newContribution}
      </button>
    </Modal>
  );
}
