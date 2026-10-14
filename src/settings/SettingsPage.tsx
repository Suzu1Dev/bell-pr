import type { Dispatch, SetStateAction } from "react";
import {
  Bot,
  Github,
  Languages,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react";
import { productLink } from "../../shared/product";
import { api } from "../api";
import type { Notify, Page, Tab } from "../app/AppShell";
import type { Status } from "../app/hooks/useAppData";
import { useT } from "../i18n";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher";
import "./settings.css";

interface SettingsPageProps {
  status: Status | null;
  setStatus: Dispatch<SetStateAction<Status | null>>;
  setApiError: Dispatch<SetStateAction<string>>;
  notify: Notify;
  configureContributionModels: () => void;
  setTab: Dispatch<SetStateAction<Tab>>;
  navigate: (value: Page) => void;
}

/** The language, the local CLI connections, model settings and run limits. */
export function SettingsPage({
  status,
  setStatus,
  setApiError,
  notify,
  configureContributionModels,
  setTab,
  navigate,
}: SettingsPageProps) {
  const t = useT("settings");
  const docsUrl = productLink("docsUrl");
  const cliStatus = (installed?: boolean, authenticated?: boolean) =>
    installed && authenticated
      ? t.status.ready
      : installed
        ? t.status.signedOut
        : t.status.missing;
  return (
    <section className="page-content settings-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1 tabIndex={-1}>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            api<Status>("/status")
              .then((s) => {
                setStatus(s);
                setApiError("");
                notify(t.rechecked);
              })
              .catch((e) => notify(e.message, "error"));
          }}
        >
          {t.recheck}
        </button>
      </div>
      <div className="settings-card">
        <div className="settings-service">
          <div className="service-icon">
            <Languages size={24} />
          </div>
          <div>
            <h3>{t.general.title}</h3>
            <p>{t.general.text}</p>
          </div>
        </div>
        <div className="setup-command">
          <label htmlFor="settings-language">{t.general.language}</label>
          <LanguageSwitcher
            id="settings-language"
            className="settings-language-select"
          />
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-service">
          <div className="service-icon">
            <Bot size={24} />
          </div>
          <div>
            <h3>Codex CLI</h3>
            <p>{t.codex.description}</p>
          </div>
          <span
            className={`service-status ${status?.codex && status?.codexAuthenticated ? "connected" : ""}`}
          >
            {cliStatus(status?.codex, status?.codexAuthenticated)}
          </span>
        </div>
        <div className="setup-command">
          <span>{t.signInHint}</span>
          <code>codex login</code>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-service">
          <div className="service-icon">
            <Bot size={24} />
          </div>
          <div>
            <h3>Claude Code CLI</h3>
            <p>{t.claude.description}</p>
          </div>
          <span
            className={`service-status ${status?.claude && status?.claudeAuthenticated ? "connected" : ""}`}
          >
            {cliStatus(status?.claude, status?.claudeAuthenticated)}
          </span>
        </div>
        <div className="setup-command">
          <span>{t.signInHint}</span>
          <code>claude auth login</code>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-service">
          <div className="service-icon">
            <Sparkles size={24} />
          </div>
          <div>
            <h3>{t.models.title}</h3>
            <p>{t.models.text}</p>
          </div>
        </div>
        <div className="setup-command">
          <button
            className="button secondary"
            onClick={configureContributionModels}
          >
            {t.models.configure}
          </button>
          <button
            className="button ghost"
            onClick={() => {
              setTab("activity");
              navigate("workspace");
            }}
          >
            {t.models.current}
          </button>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-service">
          <div className="service-icon">
            <Github size={24} />
          </div>
          <div>
            <h3>GitHub CLI</h3>
            <p>
              {status?.githubUser
                ? t.github.connectedAs({ user: status.githubUser })
                : t.github.description}
            </p>
          </div>
          <span
            className={`service-status ${status?.github ? "connected" : ""}`}
          >
            {status?.github ? t.status.connected : t.status.signedOut}
          </span>
        </div>
        <div className="setup-command">
          <span>{t.authorizeHint}</span>
          <code>gh auth login</code>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-service">
          <div className="service-icon">
            <Terminal size={24} />
          </div>
          <div>
            <h3>{t.local.title}</h3>
            <p>{t.local.text}</p>
          </div>
          <span className="service-status connected">{t.local.badge}</span>
        </div>
      </div>
      <div className="settings-card">
        <div className="settings-service">
          <div className="service-icon">
            <Workflow size={24} />
          </div>
          <div>
            <h3>{t.concurrency.title}</h3>
            <p>{t.concurrency.text}</p>
          </div>
        </div>
        <div className="setup-command">
          <span>{t.concurrency.maxActiveRuns}</span>
          <code>{status?.limits?.maxActiveRuns ?? "—"}</code>
        </div>
        <div className="setup-command">
          <span>{t.concurrency.maxAgentProcesses}</span>
          <code>{status?.limits?.maxAgentProcesses ?? "—"}</code>
        </div>
        <div className="setup-command">
          <span>{t.concurrency.maxQueued}</span>
          <code>{status?.limits?.maxQueued ?? "—"}</code>
        </div>
        <p className="muted">{t.concurrency.explanation}</p>
        <p className="muted">{t.concurrency.usage}</p>
        <details className="settings-advanced">
          <summary>{t.concurrency.advanced}</summary>
          <p>
            {t.concurrency.advancedText}
            {docsUrl && (
              <>
                {" "}
                <a href={docsUrl} target="_blank" rel="noreferrer">
                  {t.concurrency.documentation}
                </a>
              </>
            )}
          </p>
          <dl>
            <div>
              <dt>
                <code>BELLPR_MAX_ACTIVE_RUNS</code>
              </dt>
              <dd>{t.concurrency.maxActiveRuns}</dd>
            </div>
            <div>
              <dt>
                <code>BELLPR_MAX_AGENT_PROCESSES</code>
              </dt>
              <dd>{t.concurrency.maxAgentProcesses}</dd>
            </div>
          </dl>
        </details>
      </div>
    </section>
  );
}
