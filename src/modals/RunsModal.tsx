import { ChevronRight, GitPullRequest, Plus } from "lucide-react";
import { demoRun } from "../demo";
import type { Repo, RunSummary } from "../types";
import { statusLabels } from "../app/labels";
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
  return (
    <Modal
      wide
      title="每一個想法，都有進度。"
      subtitle="切換任務以查看開發狀態、程式碼變更與 PR 草稿。"
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
                  ? "互動示範"
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
        新增貢獻
      </button>
    </Modal>
  );
}
