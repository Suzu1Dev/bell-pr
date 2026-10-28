import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Loader2, Square, Terminal } from "lucide-react";
import { useLocale, useT } from "../i18n";
import "./session.css";
import { api, send } from "../api";
import { SetupNeeds } from "../team/SetupNeeds";
import type { Run } from "../types";
import type { SessionMessage } from "../../shared/session";
import { sessionInputLimit } from "../../shared/session";
import { mergeSetupNeeds } from "../../shared/setup-needs";
import { sessionActivity, sessionTurnBlock } from "./state";

const MarkdownContent = lazy(() =>
  import("../review/MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

export interface SessionPanelProps {
  run: Run;
  /** Composer text; App keeps it per run so it survives tab changes and can be prefilled. */
  draft: string;
  onDraftChange: (text: string) => void;
  /** Adopts the run a session request returned. */
  onRun: (run: Run) => void;
  /** Switches to the changes tab and selects this file. */
  onOpenFile: (path: string) => void;
}

export function SessionPanel({
  run,
  draft,
  onDraftChange,
  onRun,
  onOpenFile,
}: SessionPanelProps) {
  const t = useT("session");
  const [locale] = useLocale();
  const session = run.session;
  const messages = session?.messages ?? [];
  const running = Boolean(session?.running);
  const block = sessionTurnBlock(run, t.blocks);
  const agent = run.agents.find((item) => item.id === "session");
  const activity = running ? sessionActivity(run) : [];
  const startedAt = session?.startedAt
    ? Date.parse(session.startedAt)
    : Number.NaN;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const blockId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, running]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const elapsed =
    running && !Number.isNaN(startedAt)
      ? Math.max(0, Math.floor((now - startedAt) / 1000))
      : undefined;

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || block || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/session/messages`,
        send("POST", { content }),
      );
      onDraftChange("");
      onRun(updated);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stopTurn() {
    setBusy(true);
    setError(undefined);
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${run.id}/session/cancel`,
        send("POST"),
      );
      onRun(updated);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submitMessage();
    }
  }

  return (
    <section className="session-panel" aria-label={t.label}>
      <div className="session-messages" ref={listRef} aria-live="polite">
        {messages.length ? (
          messages.map((message) => (
            <SessionMessageView
              key={message.id}
              message={message}
              onOpenFile={onOpenFile}
            />
          ))
        ) : (
          <p className="session-empty">
            {t.empty}
          </p>
        )}
      </div>

      {running && (
        <section className="session-live" aria-label={t.progress}>
          <div className="session-live-head">
            <span className="session-live-status">
              <Loader2 size={13} className="spin" aria-hidden="true" />
              {agent?.detail ?? t.working}
              {elapsed !== undefined && <span>· {t.elapsed({ seconds: elapsed })}</span>}
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void stopTurn()}
            >
              <Square size={12} aria-hidden="true" />
              {t.stop}
            </button>
          </div>
          {activity.length > 0 && (
            <div className="activity-log session-live-log">
              {activity.map((log, index) => (
                <div
                  className={`log-line ${log.kind ? `log-${log.kind}` : ""}`}
                  key={index}
                >
                  <span className="log-time">
                    {new Date(log.time).toLocaleTimeString(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="log-agent">{t.authors.agent}</span>
                  {log.kind === "command" ? (
                    <p>
                      <code className="log-command">{log.message}</code>
                      {log.detail && (
                        <span className="log-detail">{log.detail}</span>
                      )}
                    </p>
                  ) : (
                    <p>{log.message}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="session-composer">
        {block && (
          <p id={blockId} className="session-blocked">
            {block}
          </p>
        )}
        <form className="session-input-box" onSubmit={submitMessage}>
          <textarea
            ref={inputRef}
            aria-label={t.messageLabel}
            aria-describedby={block ? blockId : undefined}
            placeholder={
              block ? t.blockedPlaceholder : t.placeholder
            }
            value={draft}
            disabled={Boolean(block)}
            readOnly={busy}
            rows={3}
            maxLength={sessionInputLimit}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="session-input-bottom">
            <span className="session-counter">
              {draft.length} / {sessionInputLimit}
            </span>
            <button
              type="submit"
              aria-label={t.send}
              disabled={Boolean(block) || busy || !draft.trim()}
            >
              <ArrowUp size={16} aria-hidden="true" />
            </button>
          </div>
        </form>
        {error && (
          <p className="session-error" role="alert">
            {error}
          </p>
        )}
        <p className="session-hint">{t.hint}</p>
      </div>
    </section>
  );
}

function SessionMessageView({
  message,
  onOpenFile,
}: {
  message: SessionMessage;
  onOpenFile: (path: string) => void;
}) {
  const t = useT("session");
  const [locale] = useLocale();
  return (
    <article
      className={`session-message session-message-${message.role}${message.failed ? " session-message-failed" : ""}`}
    >
      <header className="session-message-head">
        <span className="session-author">{t.authors[message.role]}</span>
        {message.failed && (
          <span className="session-failed-tag">{t.failed}</span>
        )}
        <time dateTime={message.at}>
          {new Date(message.at).toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </header>
      {message.role === "agent" ? (
        message.content && (
          <Suspense fallback={<p className="session-text">{t.loading}</p>}>
            <MarkdownContent>{message.content}</MarkdownContent>
          </Suspense>
        )
      ) : (
        <p className="session-text">{message.content}</p>
      )}
      {!!message.questions?.length && (
        <section className="session-questions" aria-label={t.questions}>
          <h4>{t.questions}</h4>
          <ol>
            {message.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ol>
        </section>
      )}
      {!!message.changedFiles?.length && (
        <section className="session-files" aria-label={t.changedFiles}>
          <h4>{t.changedFiles}</h4>
          <ul>
            {message.changedFiles.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  className="session-file-link"
                  onClick={() => onOpenFile(path)}
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!message.checks?.length && (
        <section className="session-checks">
          <h4>
            <Terminal size={12} aria-hidden="true" />
            {t.checks}
          </h4>
          <ul>
            {message.checks.map((check, index) => (
              <li key={index}>
                <code className="log-command">{check.command}</code>
                <span className="log-detail">{check.outcome}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!message.notRun?.length && (
        <section className="session-not-run">
          <h4>{t.notRun}</h4>
          <ul>
            {message.notRun.map((item, index) => (
              <li key={index}>
                <strong>{item.check}</strong>{": "}{item.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
      {message.draftUpdate && (
        <section className="session-draft-update">
          <h4>{t.draftUpdated}</h4>
          <p>
            {t.draftUpdatedNote}
          </p>
          <details>
            <summary>{t.compare}</summary>
            <h5>{t.before}</h5>
            <pre>{message.draftUpdate.before}</pre>
            <h5>{t.after}</h5>
            <pre>{message.draftUpdate.after}</pre>
          </details>
        </section>
      )}
      {!!message.setup?.length && (
        <SetupNeeds
          needs={mergeSetupNeeds([{ from: t.setupAgent, needs: message.setup }])}
        />
      )}
    </article>
  );
}
