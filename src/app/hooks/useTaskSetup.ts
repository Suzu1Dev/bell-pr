import {
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { api, send } from "../../api";
import { getDemo } from "../../demo";
import { useFormat, useLocale, useT, type Messages } from "../../i18n";
import type { Repo, Run } from "../../types";
import type { RunMode } from "../../byhand/ModeChoice";
import type {
  ContributionOpportunity,
  DiscoveryCandidate,
} from "../../../shared/discovery";
import type { Formatters } from "../../../shared/i18n/locale";
import type { ModelSettings } from "../../../shared/models";
import {
  defaultContributionSettings,
  type ContributionSettings,
  type ContributionRecommendation,
} from "../../../shared/insights";
import type { useProjectInsights } from "../../mission/useProjectInsights";
import type { ModalName, Notify, Page } from "../AppShell";
import { loadDemoSettings, saveDemoSettings } from "./demoStorage";

type Prompts = Messages["workspace"]["prompts"];

/** One "- item" line per entry, the list format of the task prompts. */
const bullets = (items: readonly string[]) =>
  items.map((item) => `- ${item}`).join("\n");

/**
 * The task prompt for a recommended contribution, in the language of
 * `prompts`. Verified quotes travel with the task so the team sees why each
 * file was cited.
 */
export function recommendationPrompt(
  idea: ContributionRecommendation,
  prompts: Prompts,
  fmt: Formatters,
) {
  const evidence = idea.evidenceDetails?.length
    ? prompts.verifiedEvidence({
        items: idea.evidenceDetails
          .map(({ path, quote, reason }) =>
            prompts.evidenceItem({ path, quote, reason }),
          )
          .join("\n"),
      })
    : prompts.referenceFiles({
        files: fmt.list(idea.evidence, { type: "unit" }),
      });
  return prompts
    .recommendation({
      problem: idea.problem,
      userImpact: idea.userImpact,
      approach: idea.approach,
      acceptance: bullets(idea.acceptance),
      evidence,
    })
    .slice(0, 20_000);
}

/**
 * The task prompt for a discovery proposal, in the language of `prompts`,
 * with the quotes from the candidate's sources it cites.
 */
export function opportunityPrompt(
  idea: ContributionOpportunity,
  candidate: DiscoveryCandidate,
  prompts: Prompts,
) {
  const sources = idea.evidence.flatMap((item) => {
    const source = candidate.sources.find(
      (entry) => entry.id === item.sourceId,
    );
    return source
      ? [
          prompts.opportunitySource({
            title: source.title,
            url: source.url,
            quote: item.quote,
            reason: item.reason,
          }),
        ]
      : [];
  });
  return prompts
    .opportunity({
      title: idea.title,
      summary: idea.summary,
      userNeed: idea.userNeed,
      rules: idea.contributionRules,
      steps: bullets(idea.firstSteps),
      checks: bullets(idea.acceptanceChecks),
      risks: bullets(idea.risks),
      sources: sources.join("\n\n"),
    })
    .slice(0, 20_000);
}

interface TaskSetupOptions {
  repos: Repo[];
  setRepos: Dispatch<SetStateAction<Repo[]>>;
  /** The repository the overview or explorer shows. */
  insightRepo: Repo | undefined;
  intelligence: ReturnType<typeof useProjectInsights>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setFormError: Dispatch<SetStateAction<string>>;
  notify: Notify;
  openModal: (value: ModalName) => void;
  navigate: (value: Page) => void;
  setExploreRepoId: Dispatch<SetStateAction<string>>;
  /** Bumped by every navigation; a slow answer for an older one is dropped. */
  navigationIntent: RefObject<number>;
  /** Bumped when a settings dialog closes; drops answers for the old one. */
  settingsRequest: RefObject<number>;
}

/**
 * The new-task, import and model settings dialogs: the task being set up,
 * its contribution settings, the shared model settings, and the handlers
 * that load, fill in and save them.
 */
export function useTaskSetup({
  repos,
  setRepos,
  insightRepo,
  intelligence,
  busy,
  setBusy,
  setFormError,
  notify,
  openModal,
  navigate,
  setExploreRepoId,
  navigationIntent,
  settingsRequest,
}: TaskSetupOptions) {
  const t = useT("workspace");
  const fmt = useFormat();
  const [locale] = useLocale();
  const demoRepoId = getDemo(locale).repo.id;
  const [source, setSource] = useState("");
  const [taskRepoId, setTaskRepoId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [contributionSettings, setContributionSettings] =
    useState<ContributionSettings>({ ...defaultContributionSettings });
  const [modelSettings, setModelSettings] = useState<ModelSettings>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const settingsSaveButton = useRef<HTMLButtonElement>(null);
  // Who writes the next run (DESIGN v1.2 F1), never saved with the direction: discovery
  // can prefer Learn by hand, leaving one prefers the agent team; the dialog decides.
  const [preferredMode, setPreferredMode] = useState<RunMode>();
  /** The mode fields of POST /api/runs, set by the task dialog as it submits. */
  const runRequest = useRef<{ learnByHand?: true; byHandFit?: { learningIssue: boolean } }>({});
  async function configureTaskRepo(
    id: string,
    overrides: Partial<ContributionSettings> = {},
  ) {
    setTaskRepoId(id);
    setPreferredMode(undefined);
    const request = ++settingsRequest.current;
    setFormError("");
    setSettingsNotice("");
    setSettingsReady(false);
    setSettingsLoading(true);
    setContributionSettings({ ...defaultContributionSettings, ...overrides });
    try {
      let saved: ContributionSettings;
      if (id === demoRepoId) {
        saved = loadDemoSettings(locale);
      } else {
        saved = (
          await api<{ settings: ContributionSettings }>(`/repos/${id}/settings`)
        ).settings;
      }
      if (request === settingsRequest.current) {
        setContributionSettings({ ...saved, ...overrides });
        setSettingsReady(true);
      }
    } catch (error) {
      if (request === settingsRequest.current)
        setFormError((error as Error).message);
    } finally {
      if (request === settingsRequest.current) setSettingsLoading(false);
    }
  }
  /** Opens the task dialog; `from` prefills it with a run's task for the agent team. */
  function beginContribution(
    id = insightRepo?.id || repos[0]?.id || demoRepoId,
    from?: Pick<Run, "title" | "prompt" | "contributionSettings">,
  ) {
    void configureTaskRepo(id, from?.contributionSettings);
    if (from) {
      setTaskTitle(from.title);
      setPrompt(from.prompt);
      setPreferredMode("agents");
    }
    openModal("task");
  }
  async function configureContributionModels() {
    openModal("models");
    const request = ++settingsRequest.current;
    setSettingsNotice("");
    setSettingsReady(false);
    setSettingsLoading(true);
    try {
      const { settings } = await api<{ settings: ModelSettings }>(
        "/model-settings",
      );
      if (request === settingsRequest.current) {
        setModelSettings(settings);
        setSettingsReady(true);
      }
    } catch (error) {
      if (request === settingsRequest.current)
        setFormError((error as Error).message);
    } finally {
      if (request === settingsRequest.current) setSettingsLoading(false);
    }
  }
  async function saveModelSettings() {
    if (busy || !settingsReady || settingsLoading) return;
    const request = settingsRequest.current;
    setBusy(true);
    setFormError("");
    setSettingsNotice("");
    try {
      const { settings } = await api<{ settings: ModelSettings }>(
        "/model-settings",
        send("PUT", modelSettings),
      );
      if (request === settingsRequest.current) {
        setModelSettings(settings);
        setSettingsNotice(t.notices.modelSettingsSaved);
      }
    } catch (error) {
      if (request === settingsRequest.current)
        setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeContributionSettings(settings: ContributionSettings) {
    setContributionSettings(settings);
    setSettingsNotice("");
    setFormError("");
  }
  function chooseRecommendation(idea: ContributionRecommendation) {
    setTaskTitle(idea.title);
    // Written in the UI language, like the rest the person types for the task.
    setPrompt(recommendationPrompt(idea, t.prompts, fmt));
    void configureTaskRepo(insightRepo?.id || demoRepoId, {
      direction: idea.direction,
      targetUser: fmt.list(intelligence.insights?.audience ?? [], {
        type: "unit",
      }),
      outcome: idea.userImpact,
      acceptance: idea.acceptance.join("\n"),
    });
    openModal("task");
  }
  async function chooseOpportunity(
    idea: ContributionOpportunity,
    candidate: DiscoveryCandidate,
    mode?: RunMode,
  ) {
    const intent = navigationIntent.current;
    const { repo } = await api<{ repo: Repo }>(
      "/repos",
      send("POST", { source: candidate.url }),
    );
    setRepos((previous) => [
      ...previous.filter((entry) => entry.id !== repo.id),
      repo,
    ]);
    if (intent !== navigationIntent.current) return;
    // Prefer the issue the proposal cites; otherwise the first open issue found.
    const issueSources = candidate.sources.filter(
      (source) => source.kind === "issue",
    );
    const issueUrl = (
      issueSources.find((source) =>
        idea.evidence.some((item) => item.sourceId === source.id),
      ) ?? issueSources[0]
    )?.url;
    setTaskTitle(idea.title);
    setPrompt(opportunityPrompt(idea, candidate, t.prompts));
    void configureTaskRepo(repo.id, {
      direction: "maintenance",
      outcome: idea.userNeed.slice(0, 4000),
      constraints: [idea.contributionRules, ...idea.risks]
        .join("\n")
        .slice(0, 4000),
      acceptance: idea.acceptanceChecks.join("\n").slice(0, 4000),
      requirePlanApproval: true,
      ...(issueUrl ? { issueUrl } : {}),
    });
    setPreferredMode(mode);
    setExploreRepoId(repo.id);
    navigate("explore");
    openModal("task");
    notify(t.notices.proposalLoaded({ name: repo.fullName }));
  }
  async function saveDirection() {
    if (busy || !taskRepoId || !settingsReady || settingsLoading) return;
    const request = settingsRequest.current;
    setBusy(true);
    setFormError("");
    setSettingsNotice("");
    try {
      if (taskRepoId === demoRepoId)
        saveDemoSettings(locale, contributionSettings);
      else
        await api(
          `/repos/${taskRepoId}/settings`,
          send("PUT", contributionSettings),
        );
      if (request === settingsRequest.current) {
        const message = taskRepoId === demoRepoId
          ? t.notices.demoSettingsSaved
          : t.notices.directionSaved;
        setSettingsNotice(message);
        notify(message);
      }
    } catch (error) {
      if (request === settingsRequest.current)
        setFormError((error as Error).message);
    } finally {
      setBusy(false);
      if (request === settingsRequest.current) {
        window.requestAnimationFrame(() => {
          if (document.activeElement === document.body)
            settingsSaveButton.current?.focus();
        });
      }
    }
  }
  return {
    source,
    setSource,
    taskRepoId,
    setTaskRepoId,
    prompt,
    setPrompt,
    taskTitle,
    setTaskTitle,
    contributionSettings,
    modelSettings,
    setModelSettings,
    settingsLoading,
    settingsReady,
    settingsNotice,
    setSettingsNotice,
    settingsSaveButton,
    configureTaskRepo,
    beginContribution,
    configureContributionModels,
    saveModelSettings,
    changeContributionSettings,
    chooseRecommendation,
    chooseOpportunity,
    saveDirection,
    preferredMode,
    runRequest,
  };
}

export type TaskSetup = ReturnType<typeof useTaskSetup>;
