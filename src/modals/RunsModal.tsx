import { useState } from "react";
import { ChevronRight, GitPullRequest, HardDrive, Plus, Trash2 } from "lucide-react";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import type { Repo, RunSummary } from "../types";
import { Modal } from "./Modal";

/** A run that still works; it must stop before its files or record go. */
export function runIsActive(run: Pick<RunSummary, "status">) {
  return ["running", "queued", "awaiting_plan"].includes(run.status);
}

interface RunsModalProps {
  runs: RunSummary[];
  repos: Repo[];
  chooseRun: (id: string) => Promise<boolean>;
  beginContribution: () => void;
  closeModal: () => void;
  /** DELETE /api/runs/:id/workspace; rejects with the server's reason. */
  freeRunSpace?: (id: string) => Promise<void>;
  /** DELETE /api/runs/:id; rejects with the server's reason. */
  deleteRun?: (id: string) => Promise<void>;
}

type Pending = { id: string; action: "free" | "delete" };

/** Moves the focus once the next render is on screen. */
function focusSoon(selector: string) {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(selector)?.focus(),
  );
}

/** The selector of a run's action button. */
const actionButton = (id: string, action: Pending["action"]) =>
  `[data-run-action="${CSS.escape(`${id}:${action}`)}"]`;

/**
 * Every contribution run, plus the demo, to switch between. A run of the
 * person's own can free its disk space or be deleted, each after a
 * confirmation in its row.
 */
export function RunsModal({
  runs,
  repos,
  chooseRun,
  beginContribution,
  closeModal,
  freeRunSpace,
  deleteRun,
}: RunsModalProps) {
  const t = useT("modals").runs;
  const common = useT("common");
  const statusLabels = common.runStatus;
  const [locale] = useLocale();
  const demoRun = getDemo(locale).run;
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const confirm = async ({ id, action }: Pending) => {
    const act = action === "free" ? freeRunSpace : deleteRun;
    if (!act) return;
    setWorking(true);
    setError(null);
    try {
      await act(id);
      setPending(null);
      // A freed run keeps its row and its Delete button; a deleted one is gone.
      focusSoon(action === "free" ? actionButton(id, "delete") : ".all-runs .run-list-row");
    } catch (cause) {
      setError({
        id,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      wide
      title={t.title}
      subtitle={t.subtitle}
      onClose={closeModal}
    >
      <div className="all-runs">
        {[...runs, demoRun].map((job) => {
          const own = job.id !== demoRun.id;
          const active = runIsActive(job);
          const asked = pending?.id === job.id ? pending : null;
          return (
            <div className="run-list-entry" key={job.id}>
              <button
                className="run-list-row"
                onClick={() => {
                  closeModal();
                  void chooseRun(job.id);
                }}
              >
                <GitPullRequest size={20} />
                <span>
                  <strong>{job.title}</strong>
                  <small>
                    {own
                      ? repos.find((repo) => repo.id === job.repoId)?.fullName
                      : t.demo}{" "}
                    · {job.branch}
                  </small>
                </span>
                {job.workspaceRemovedAt && (
                  <span className="run-files-removed">{t.filesRemoved}</span>
                )}
                <em>{statusLabels[job.status]}</em>
                <ChevronRight size={15} />
              </button>
              {own && (freeRunSpace || deleteRun) && (
                <div className="run-list-actions">
                  {asked ? (
                    <div
                      className="run-list-confirm"
                      role="group"
                      aria-label={
                        asked.action === "free"
                          ? t.freeSpaceLabel({ title: job.title })
                          : t.deleteRunLabel({ title: job.title })
                      }
                    >
                      <p>
                        {asked.action === "delete"
                          ? t.deleteConfirm
                          : job.status === "published"
                            ? t.freeConfirmPublished
                            : t.freeConfirm}
                      </p>
                      <div>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={working}
                          autoFocus
                          onClick={() => {
                            setPending(null);
                            setError(null);
                            focusSoon(actionButton(asked.id, asked.action));
                          }}
                        >
                          {common.actions.cancel}
                        </button>
                        <button
                          type="button"
                          className={`button ${asked.action === "delete" ? "danger" : "primary"}`}
                          disabled={working}
                          onClick={() => void confirm(asked)}
                        >
                          {working
                            ? t.working
                            : asked.action === "free"
                              ? t.freeYes
                              : t.deleteYes}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {active && <span className="run-list-hint">{t.activeHint}</span>}
                      {freeRunSpace && !job.workspaceRemovedAt && (
                        <button
                          type="button"
                          className="run-list-action"
                          data-run-action={`${job.id}:free`}
                          disabled={active || working}
                          aria-label={t.freeSpaceLabel({ title: job.title })}
                          onClick={() => {
                            setError(null);
                            setPending({ id: job.id, action: "free" });
                          }}
                        >
                          <HardDrive size={14} aria-hidden="true" />
                          {t.freeSpace}
                        </button>
                      )}
                      {deleteRun && (
                        <button
                          type="button"
                          className="run-list-action run-list-action-danger"
                          data-run-action={`${job.id}:delete`}
                          disabled={active || working}
                          aria-label={t.deleteRunLabel({ title: job.title })}
                          onClick={() => {
                            setError(null);
                            setPending({ id: job.id, action: "delete" });
                          }}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          {t.deleteRun}
                        </button>
                      )}
                    </>
                  )}
                  {error?.id === job.id && (
                    <p role="alert" className="inline-error">
                      {error.message}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
