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
import { demoRepo } from "../demo";
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
      title="把想法交給你的 Agent team。"
      subtitle="描述你想改善什麼，以及完成後應該有的行為。"
      onClose={closeModal}
    >
      <form onSubmit={startTask}>
        <label className="field-label" htmlFor="task-repo">
          目標 Repository
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
            選擇 Repository
          </option>
          {[...repos, demoRepo].map((repo) => (
            <option value={repo.id} key={repo.id}>
              {repo.fullName}
              {repo.id === "demo-repo" ? "（示範）" : ""}
            </option>
          ))}
        </select>
        <div className="task-repo-actions">
          <button type="button" onClick={() => openModal("import")}>
            <Plus size={13} />
            匯入其他專案
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
            先看 AI 推薦方向
          </button>
        </div>
        {taskRepoId === "demo-repo" && (
          <p className="task-demo-note">
            示範設定可以自由調整；不會啟動真實 agent。請匯入你的 repository
            開始開發。
          </p>
        )}
        {settingsLoading && (
          <p className="field-help" role="status">
            正在載入這個專案的貢獻設定…
          </p>
        )}
        {!settingsLoading && !settingsReady && (
          <button
            type="button"
            className="save-direction-button"
            onClick={() => configureTaskRepo(taskRepoId)}
          >
            重新載入專案設定
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
          儲存為預設設定
        </button>
        <label className="field-label" htmlFor="task-title">
          任務名稱 <span>選填</span>
        </label>
        <input
          id="task-title"
          className="text-input"
          placeholder="例如：為 API client 加入智慧重試"
          value={taskTitle}
          onChange={(e) => setTaskTitle(e.target.value)}
        />
        <label className="field-label" htmlFor="task-prompt">
          這次想完成什麼？
        </label>
        <textarea
          id="task-prompt"
          className="text-input task-prompt"
          placeholder="描述需求、相關檔案、預期行為與驗收方式…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          required
          minLength={10}
        />
        <div className="task-team-preview">
          <Bot size={16} />
          <span>Team lead</span>
          <ChevronRight size={12} />
          <span>{contributionSettings.maxTeammates} 位 Teammates</span>
          <ChevronRight size={12} />
          <span>Reviewer + Test analyst</span>
        </div>
        <p className="field-help">
          會使用本機{" "}
          {providerLabels[contributionSettings.provider ?? "codex"]}{" "}
          帳號執行任務，消耗對應用量。完成後等待你審查。
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
            取消
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
            {taskRepoId === "demo-repo"
              ? "儲存示範方向"
              : contributionSettings.requirePlanApproval
                ? "產生團隊計畫"
                : "啟動 Agent team"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
