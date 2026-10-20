import { useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
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
import { DirectionSettings } from "../mission/DirectionSettings";
import { providerReadiness } from "../mission/readiness";
import { byHandStartReasons, suggestedMode } from "../mission/respect";
import { StartConfirm, startReasonsKey, type StartCheck } from "../mission/StartConfirm";
import { providerLabels } from "../../shared/models";
import type { ModalName, Page } from "../app/AppShell";
import type { TaskSetup } from "../app/hooks/useTaskSetup";
import { ModeChoice, type RunMode } from "../byhand/ModeChoice";
import { readinessOf, ReadinessNotice } from "../setup/ReadinessNotice";
import type { DoctorState } from "../setup/useDoctor";
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
    | "preferredMode"
    | "runRequest"
  >;
  repos: Repo[];
  busy: boolean;
  formError: string;
  startTask: (event: FormEvent) => void;
  closeModal: () => void;
  openModal: (value: ModalName) => void;
  navigate: (value: Page) => void;
  setExploreRepoId: Dispatch<SetStateAction<string>>;
  /** The environment report the shell shares: a run needs a ready provider. */
  doctor: DoctorState;
  /** Masks e-mail addresses in the readiness notice while presenting. */
  maskUser?: (value: string) => string;
}

/** Sets up a contribution task and starts its agent team, or a run the person writes by hand. */
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
  doctor,
  maskUser,
}: NewTaskModalProps) {
  const t = useT("modals").newTask;
  // The mode choice's copy is in a deferred namespace: the dialog waits for it once.
  const modeText = useT("discovery").byHand;
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
    preferredMode,
    runRequest,
  } = setup;
  const demo = taskRepoId === demoRepo.id;
  // When the facts say publishing will wait, Start asks once per set of reasons.
  const form = useRef<HTMLFormElement>(null);
  const [startCheck, setStartCheck] = useState<StartCheck>({ reasons: [] });
  const [asking, setAsking] = useState(false);
  const accepted = useRef("");
  // Who writes it (DESIGN v1.2 F1): the person's choice, else the suggestion; the fitted help set is preselected.
  const [modeChoice, setModeChoice] = useState<RunMode>();
  const [fitChoice, setFitChoice] = useState<boolean>();
  const { rules, rulesCase, learningIssue = false } = startCheck;
  const mode = demo ? "agents" : (modeChoice ?? suggestedMode({ preferred: preferredMode, learningIssue, rules }));
  const fitted = mode === "hand" && rulesCase?.case === "fitted" && (fitChoice ?? true);
  const reasons = mode === "hand" ? byHandStartReasons(startCheck.reasons, rulesCase, fitted) : startCheck.reasons;
  const reasonsKey = startReasonsKey(reasons);
  const submit = (event: FormEvent) => {
    if (reasons.length && accepted.current !== reasonsKey) {
      event.preventDefault();
      setAsking(true);
      return;
    }
    runRequest.current = mode === "hand" ? { learnByHand: true, ...(fitted ? { byHandFit: { learningIssue } } : {}) } : {};
    startTask(event);
  };
  // The sample needs no tools. Otherwise a run waits for a ready provider;
  // when the check itself cannot answer, the server decides on submit.
  const readiness = readinessOf(doctor.report, ["provider"]);
  const unready =
    !demo && !readiness.ready && !(readiness.checking && doctor.error);
  // DirectionSettings names the selected provider's problem next to its
  // picker; the notice by the Start button covers the other cases.
  const providerShown =
    !demo &&
    (providerReadiness(doctor.report, contributionSettings.provider ?? "codex")
      ?.state ?? "ready") !== "ready";
  const startDisabled =
    busy ||
    settingsLoading ||
    !settingsReady ||
    !taskRepoId ||
    prompt.trim().length < 10 ||
    unready;
  return (
    <Modal
      wide
      title={mode === "hand" ? modeText.start : t.title}
      subtitle={t.subtitle}
      onClose={closeModal}
    >
      <form ref={form} onSubmit={submit}>
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
        {demo && <p className="task-demo-note">{t.demoNote}</p>}
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
            demo={demo}
            doctor={doctor}
            repoId={taskRepoId || undefined}
            onStartCheck={setStartCheck}
            byHand={mode === "hand"}
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
        <ModeChoice mode={mode} onModeChange={setModeChoice} rulesCase={rulesCase} fitted={fitted}
          onFittedChange={setFitChoice} sample={demo} disabled={busy} />
        {mode === "agents" && <>
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
        <p className="field-help task-team-limit">{t.teamLimit}</p>
        </>}
        <p className="field-help">
          {t.usage({
            provider: providerLabels[contributionSettings.provider ?? "codex"],
          })}
        </p>
        {!providerShown && (
          <ReadinessNotice
            requires={["provider"]}
            bypass={demo}
            doctor={doctor}
            maskUser={maskUser}
          />
        )}
        {formError && (
          <p role="alert" className="inline-error">
            {formError}
          </p>
        )}
        {asking && reasons.length > 0 && !startDisabled && (
          <StartConfirm
            byHand={mode === "hand"}
            reasons={reasons}
            onCancel={() => setAsking(false)}
            onConfirm={() => {
              accepted.current = reasonsKey;
              setAsking(false);
              form.current?.requestSubmit();
            }}
          />
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
            disabled={startDisabled}
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Play size={16} />
            )}
            {demo
              ? t.saveDemo
              : mode === "hand"
                ? modeText.start
                : contributionSettings.requirePlanApproval
                ? t.planFirst
                : t.start}
          </button>
        </div>
      </form>
    </Modal>
  );
}
