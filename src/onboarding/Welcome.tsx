import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CirclePlay,
  Compass,
  FolderGit2,
  Languages,
  Stethoscope,
} from "lucide-react";
import type { DoctorReport } from "../../shared/doctor";
import {
  agentProviders,
  providerLabels,
  type AgentProvider,
  type ModelSettings,
} from "../../shared/models";
import { api, send } from "../api";
import { useCheckSettings } from "../app/hooks/useUnderstanding";
import { useLocale, useT } from "../i18n";
import { LanguageSwitcher, saveLocale } from "../i18n/LanguageSwitcher";
import { readinessOf } from "../setup/ReadinessNotice";
import { SetupChecklist } from "../setup/SetupChecklist";
import { useDoctor, type DoctorState } from "../setup/useDoctor";
import "./onboarding.css";

/** Where the person chose to start; the app shell opens it. */
export type WelcomeChoice = "tour" | "import" | "discover";

export const welcomeSteps = [
  "language",
  "environment",
  "provider",
  "start",
] as const;
export type WelcomeStep = (typeof welcomeSteps)[number];

const stepIcons = {
  language: Languages,
  environment: Stethoscope,
  provider: Bot,
  start: CirclePlay,
} satisfies Record<WelcomeStep, unknown>;

/**
 * What to save so the model settings use `provider`, or undefined when
 * they already do with choices of their own (a model, an effort or web
 * access, which only saved settings have). Another provider starts with
 * its own defaults, since models and efforts belong to one provider.
 */
export function providerUpdate(
  settings: ModelSettings,
  provider: AgentProvider,
): ModelSettings | undefined {
  const same = (settings.provider ?? "codex") === provider;
  const chosen =
    !!settings.model ||
    !!settings.reasoningEffort ||
    settings.webAccess !== undefined;
  return same && chosen ? undefined : { provider };
}

/** The providers that are installed and signed in, from the report. */
export function readyProviders(report: DoctorReport | null): AgentProvider[] {
  if (!report) return [];
  const ok = (id: string) =>
    report.checks.find((check) => check.id === id)?.status === "ok";
  return agentProviders.filter((provider) => ok(provider) && ok(`${provider}-auth`));
}

export interface WelcomeProps {
  /** Called once setup is finished (onboardingCompletedAt is saved). */
  onFinish: (choice: WelcomeChoice) => void;
  /** A useDoctor() state to share; Welcome loads its own otherwise. */
  doctor?: DoctorState;
  maskUser?: (value: string) => string;
  maskPath?: (value: string) => string;
  /** The step to open on; the first one by default. */
  initialStep?: WelcomeStep;
}

/**
 * The first-run welcome: the language, the environment checklist, the AI
 * provider (chosen for the person when exactly one is ready) and where to
 * start.
 * Finishing saves `onboardingCompletedAt`.
 */
export function Welcome({
  onFinish,
  doctor,
  maskUser,
  maskPath,
  initialStep = "language",
}: WelcomeProps) {
  const t = useT("onboarding");
  const [locale] = useLocale();
  const own = useDoctor({ enabled: !doctor });
  const environment = doctor ?? own;
  const [step, setStep] = useState<WelcomeStep>(initialStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const index = welcomeSteps.indexOf(step);

  // Each step moves the focus to its heading, so a screen reader starts there.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const go = (next: WelcomeStep) => {
    setError("");
    setStep(next);
  };
  const failure = (cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause);

  const finish = async (choice: WelcomeChoice) => {
    setBusy(true);
    setError("");
    try {
      await api(
        "/app-settings",
        send("PUT", { onboardingCompletedAt: new Date().toISOString() }),
      );
      onFinish(choice);
    } catch (cause) {
      setError(t.start.finishFailed({ message: failure(cause) }));
      setBusy(false);
    }
  };

  const StepIcon = stepIcons[step];
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <header className="welcome-header">
        <h1 id="welcome-title">{t.title}</h1>
        <p>{t.intro}</p>
      </header>
      <ol className="welcome-steps" aria-label={t.progress}>
        {welcomeSteps.map((id, position) => (
          <li
            key={id}
            className={
              position < index ? "done" : position === index ? "current" : undefined
            }
            aria-current={position === index ? "step" : undefined}
          >
            <span className="welcome-step-number" aria-hidden="true">
              {position + 1}
            </span>
            <span>{t.steps[id]}</span>
          </li>
        ))}
      </ol>
      <div className="welcome-card">
        <p className="welcome-step-of">
          {t.stepOf({ step: index + 1, total: welcomeSteps.length })}
        </p>
        <h2 ref={heading} tabIndex={-1}>
          <StepIcon size={22} aria-hidden="true" />
          <span>
            {step === "language"
              ? t.language.title
              : step === "environment"
                ? t.environment.title
                : step === "provider"
                  ? t.provider.title
                  : t.start.title}
          </span>
        </h2>

        {step === "language" && (
          <div className="welcome-body">
            <p>{t.language.text}</p>
            <div className="welcome-field">
              <label htmlFor="welcome-language">{t.language.label}</label>
              <LanguageSwitcher id="welcome-language" className="welcome-select" />
            </div>
          </div>
        )}

        {step === "environment" && (
          <div className="welcome-body">
            <p>{t.environment.text}</p>
            <SetupChecklist
              {...environment}
              maskUser={maskUser}
              maskPath={maskPath}
            />
            <p className="welcome-note">{t.environment.later}</p>
          </div>
        )}

        {step === "provider" && (
          <ProviderStep report={environment.report} refresh={environment.refresh} />
        )}

        {step === "start" && (
          <StartStep
            report={environment.report}
            busy={busy}
            onChoose={(choice) => void finish(choice)}
          />
        )}

        {error && (
          <p className="welcome-error" role="alert">
            {error}
          </p>
        )}

        <div className="welcome-actions">
          {index > 0 && (
            <button
              type="button"
              className="button secondary"
              onClick={() => go(welcomeSteps[index - 1])}
              disabled={busy}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              {t.back}
            </button>
          )}
          {step !== "start" && (
            <button
              type="button"
              className="button primary"
              onClick={() => {
                // The language shown is the one chosen, even when the
                // person kept the one the browser suggested.
                if (step === "language") saveLocale(locale);
                go(welcomeSteps[index + 1]);
              }}
              disabled={busy}
            >
              {t.next}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The AI provider: when exactly one is ready it is saved as the model
 * settings' provider; with both, the person chooses.
 */
function ProviderStep({
  report,
  refresh,
}: {
  report: DoctorReport | null;
  refresh: () => Promise<void>;
}) {
  const t = useT("onboarding").provider;
  const recheck = useT("setup").checklist.recheck;
  const ready = readyProviders(report);
  const [chosen, setChosen] = useState<AgentProvider | undefined>();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const onlyOne = ready.length === 1 ? ready[0] : undefined;

  /** Saves the provider in the model settings (see providerUpdate). */
  const choose = useCallback(
    async (provider: AgentProvider) => {
      setChosen(provider);
      setState("saving");
      setError("");
      try {
        const { settings } = await api<{ settings: ModelSettings }>(
          "/model-settings",
        );
        const update = providerUpdate(settings, provider);
        if (update) await api("/model-settings", send("PUT", update));
        setState("saved");
      } catch (cause) {
        setState("idle");
        setError(
          t.saveFailed({
            message: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    },
    [t],
  );

  // The only provider that is ready is saved once, without a click.
  const autoSaved = useRef<AgentProvider | undefined>(undefined);
  useEffect(() => {
    if (!onlyOne || autoSaved.current === onlyOne) return;
    autoSaved.current = onlyOne;
    void choose(onlyOne);
  }, [onlyOne, choose]);

  const note = (provider: AgentProvider) =>
    provider === "claude" ? t.claudeNote : t.codexNote;

  return (
    <div className="welcome-body">
      <p>{t.text}</p>
      {!report && <p role="status">{t.checking}</p>}
      {report && !ready.length && (
        <div className="welcome-provider-none">
          <p>{t.none}</p>
          <button type="button" className="button secondary" onClick={() => void refresh()}>
            {recheck}
          </button>
        </div>
      )}
      {onlyOne && (
        <div className="welcome-provider-card">
          <strong>{t.auto({ provider: providerLabels[onlyOne] })}</strong>
          <p>{note(onlyOne)}</p>
        </div>
      )}
      {ready.length > 1 && (
        <fieldset className="welcome-providers">
          <legend>{t.choose}</legend>
          {ready.map((provider) => (
            <label key={provider} className="welcome-provider-option">
              <input
                type="radio"
                name="welcome-provider"
                value={provider}
                checked={chosen === provider}
                onChange={() => void choose(provider)}
              />
              <span>
                <strong>{providerLabels[provider]}</strong>
                <span>{note(provider)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="welcome-provider-state" role="status">
        {state === "saving"
          ? t.saving
          : state === "saved" && chosen
            ? t.saved({ provider: providerLabels[chosen] })
            : ""}
      </p>
      {error && (
        <p className="welcome-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Where to start; finding a project needs the GitHub CLI. */
function StartStep({
  report,
  busy,
  onChoose,
}: {
  report: DoctorReport | null;
  busy: boolean;
  onChoose: (choice: WelcomeChoice) => void;
}) {
  const t = useT("onboarding").start;
  const github = readinessOf(report, ["gh"]);
  // The variable that keeps the check on also locks its switch in Settings.
  const checkLocked = !!useCheckSettings().lockedBy;
  const choices = [
    { id: "tour", icon: CirclePlay, title: t.tour, text: t.tourText },
    {
      id: "import",
      icon: FolderGit2,
      title: t.import,
      text: checkLocked ? t.importTextLocked : t.importText,
    },
    {
      id: "discover",
      icon: Compass,
      title: t.discover,
      text: t.discoverText,
    },
  ] as const;
  return (
    <div className="welcome-body welcome-choices">
      {choices.map(({ id, icon: Icon, title, text }) => {
        const blocked = id === "discover" && !github.ready;
        const reason = `welcome-reason-${id}`;
        return (
          <button
            key={id}
            type="button"
            className="welcome-choice"
            disabled={busy || blocked}
            aria-describedby={blocked ? reason : undefined}
            onClick={() => onChoose(id)}
          >
            <Icon size={22} aria-hidden="true" />
            <span className="welcome-choice-text">
              <strong>{title}</strong>
              <span>{text}</span>
              {blocked && (
                <span id={reason} className="welcome-choice-reason">
                  {t.discoverDisabled}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
