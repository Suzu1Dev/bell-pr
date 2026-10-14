import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Loader2,
  Play,
  Plus,
  Sparkles,
} from "lucide-react";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import type { Repo } from "../types";
import { DirectionSettings } from "../mission";
import { providerLabels } from "../../shared/models";
import type { ModalName, Page } from "../app/AppShell";
import type { TaskSetup } from "../app/hooks/useTaskSetup";
import { Modal } from "./Modal";

interface NewTaskModalProps {
  setup: Pick<
    TaskSetup,
    | "taskRepoId"
    | "prompt"
    | "setPrompt"
    | "taskTitle"
    | "setTaskTitle"
    | "contributionSettings"
    | "settingsLoading"
    | "settingsReady"
    | "configureTaskRepo"
    | "changeContributionSettings"
    | "saveDirection"
  >;
  repos: Repo[];
  busy: boolean;
  formError: string;
  startTask: (event: FormEvent) => void;
  closeModal: () => void;
  openModal: (value: ModalName) => void;
  navigate: (value: Page) => void;
  setExploreRepoId: Dispatch<SetStateAction<string>>;
}

/** Sets up a contribution task for a repository and starts its agent team. */
export function NewTaskModal({
  setup,
  repos,
  busy,
  formError,
  startTask,
  closeModal,
  openModal,
  navigate,
  setExploreRepoId,
}: NewTaskModalProps) {
  const t = useT("modals").newTask;
  const common = useT("common");
  const [locale] = useLocale();
  const demoRepo = getDemo(locale).repo;
  const {
    taskRepoId,
    prompt,
    setPrompt,
    taskTitle,
    setTaskTitle,
    contributionSettings,
    settingsLoading,
    settingsReady,
    configureTaskRepo,
    changeContributionSettings,
    saveDirection,
  } = setup;
  return (
    <Modal
      wide
      title={t.title}
      subtitle={t.subtitle}
      onClose={closeModal}
    >
      <form onSubmit={startTask}>
        <label className="field-label" htmlFor="task-repo">
          {t.repo}
        </label>
        <select
          id="task-repo"
          className="text-input"
          value={taskRepoId}
          disabled={busy}
          onChange={(e) => configureTaskRepo(e.target.value)}
          required
        >
          <option value="" disabled>
            {t.chooseRepo}
          </option>
          {[...repos, demoRepo].map((repo) => (
            <option value={repo.id} key={repo.id}>
              {repo.id === demoRepo.id
                ? t.demoRepo({ name: repo.fullName })
                : repo.fullName}
            </option>
          ))}
        </select>
        <div className="task-repo-actions">
          <button type="button" onClick={() => openModal("import")}>
            <Plus size={13} />
            {t.importOther}
          </button>
          <button
            type="button"
            onClick={() => {
              closeModal();
              setExploreRepoId(taskRepoId);
              navigate("explore");
            }}
          >
            <Sparkles size={13} />
            {t.recommendations}
          </button>
        </div>
        {taskRepoId === demoRepo.id && (
          <p className="task-demo-note">{t.demoNote}</p>
        )}
        {settingsLoading && (
          <p className="field-help" role="status">
            {t.loadingSettings}
          </p>
        )}
        {!settingsLoading && !settingsReady && (
          <button
            type="button"
            className="save-direction-button"
            onClick={() => configureTaskRepo(taskRepoId)}
          >
            {t.reloadSettings}
          </button>
        )}
        <fieldset
          className="direction-settings-container"
          disabled={busy || settingsLoading || !settingsReady}
        >
          <DirectionSettings
            value={contributionSettings}
            onChange={changeContributionSettings}
            compact
          />
        </fieldset>
        <button
          type="button"
          className="save-direction-button"
          disabled={
            busy || !taskRepoId || settingsLoading || !settingsReady
          }
          onClick={saveDirection}
        >
          <Check size={14} />
          {t.saveDefault}
        </button>
        <label className="field-label" htmlFor="task-title">
          {t.taskName} <span>{common.optional}</span>
        </label>
        <input
          id="task-title"
          className="text-input"
          placeholder={t.taskPlaceholder}
          value={taskTitle}
          onChange={(e) => setTaskTitle(e.target.value)}
        />
        <label className="field-label" htmlFor="task-prompt">
          {t.goal}
        </label>
        <textarea
          id="task-prompt"
          className="text-input task-prompt"
          placeholder={t.goalPlaceholder}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          required
          minLength={10}
        />
        <div className="task-team-preview">
          <Bot size={16} />
          <span>{t.lead}</span>
          <ChevronRight size={12} />
          <span>
            {t.teammates({ count: contributionSettings.maxTeammates })}
          </span>
          <ChevronRight size={12} />
          <span>{t.reviewers}</span>
        </div>
        <p className="field-help">
          {t.usage({
            provider: providerLabels[contributionSettings.provider ?? "codex"],
          })}
        </p>
        {formError && (
          <p role="alert" className="inline-error">
            {formError}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={closeModal}
          >
            {common.actions.cancel}
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={
              busy ||
              settingsLoading ||
              !settingsReady ||
              !taskRepoId ||
              prompt.trim().length < 10
            }
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Play size={16} />
            )}
            {taskRepoId === demoRepo.id
              ? t.saveDemo
              : contributionSettings.requirePlanApproval
                ? t.planFirst
                : t.start}
          </button>
        </div>
      </form>
    </Modal>
  );
}
