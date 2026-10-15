import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Eye,
  FileCode2,
  FlaskConical,
  FolderTree,
  HelpCircle,
  Languages,
  Lightbulb,
  ListOrdered,
  LoaderCircle,
  MessageCircle,
  PenLine,
  RotateCcw,
  Shuffle,
  Sparkles,
} from "lucide-react";
import type { LearnerNote } from "../../shared/explanations";
import { parseLocale, type Locale } from "../../shared/i18n/locale";
import type { PrFeedbackItem } from "../../shared/pr-feedback";
import { parseReviewOrder } from "../../shared/review-order";
import {
  reportMentionCount,
  type FileAttempt,
  type FileAttemptInput,
} from "../../shared/understanding";
import { useTablistKeys } from "../a11y/useTablistKeys";
import { useFormat, useLocale, useT } from "../i18n";
import type { ChatMessage, DiffFile, Run } from "../types";
import { MarkdownContent } from "./MarkdownContent";
import { withNodes } from "./withNodes";
import "./review.css";

export interface ExplanationPanelProps {
  file: DiffFile;
  messages: ChatMessage[];
  loading: boolean;
  onAsk: (question: string) => void;
  demo: boolean;
  /** Final role reports; only named keys are shown (see reportSections). */
  reports?: Run["reports"];
  onRetryExplanation?: () => void;
  chatRequestId?: number;
  onChatRequestHandled?: () => void;
  explanationBusy?: boolean;
  /** Current (not stale) project modules; used only to label where the file lives. */
  modules?: { path: string; purpose: string }[];
  /** The learner's saved note for this file; the editor renders when onSaveNote is given. */
  note?: LearnerNote;
  onSaveNote?: (text: string) => Promise<void> | void;
  /** Maintainer thread comments on this file from the published PR; unlocks the response preset. */
  feedback?: PrFeedbackItem[];
  /** Re-runs the reviewer and test analyst on the current diff; the button renders when given. */
  onRerunReview?: () => void;
  reviewBusy?: boolean;
  /**
   * The language the run's agents wrote in (`run.locale`). When it is not
   * the UI language, the explanation tab says which language it is in.
   */
  runLocale?: Locale;
  /** The person's try-first attempt on this file (`run.attempts[path]`). */
  attempt?: FileAttempt;
  /** Saves the quiz answer before the reveal, its grade, or the road choice (PATCH /api/runs/:id/attempts). */
  onAttempt?(input: {
    quiz?: FileAttemptInput["quiz"];
    road?: FileAttemptInput["road"];
  }): Promise<void>;
  /** Shows the try-first prompts; false brings back the plain reveal (Settings → Learning). */
  tryFirst?: boolean;
}

/**
 * Says where agent-written text comes from: AI output that may be wrong, or
 * the sample project's prewritten text.
 */
export function ProvenanceLabel({ demo }: { demo: boolean }) {
  const t = useT("review");
  return (
    <p className={`explain-provenance${demo ? " explain-provenance-sample" : ""}`}>
      {demo ? <BookOpen size={13} /> : <Sparkles size={13} />}
      {demo ? t.provenance.sample : t.provenance.ai}
    </p>
  );
}

/** Longest module path that is the file itself or one of its parent directories. */
export function moduleFor(
  filePath: string,
  modules: { path: string; purpose: string }[] = [],
) {
  let best: { path: string; purpose: string } | undefined;
  for (const module of modules) {
    const prefix = module.path.replace(/\/+$/, "");
    if (!prefix) continue;
    const matches = filePath === prefix || filePath.startsWith(`${prefix}/`);
    if (matches && (!best || prefix.length > best.path.length))
      best = { path: prefix, purpose: module.purpose };
  }
  return best;
}

/** Test directories or `.test.` / `.spec.` file names. */
const testFilePattern =
  /(^|\/)(test|tests|__tests__|spec)(\/|\.)|\.(test|spec)\./;

// Explicit keys only: run.reports also stores teammate JSON, task ids and the
// mentor's own answers, which are not review reports.
const reportKeys = ["implementer", "reviewer", "tester"] as const;

/** Paragraphs (split on blank lines) that mention the path or its basename. */
export { reportMentionCount };

/** Thread comments on the current file, shown as plain text: other people's words, not Markdown to trust. */
export function MaintainerFeedback({ items }: { items: PrFeedbackItem[] }) {
  const t = useT("review");
  if (!items.length) return null;
  return (
    <section className="explain-card explain-card-report">
      <h3>
        <MessageCircle size={15} />
        {t.feedback.title}
        <span className="explain-report-author">
          {t.feedback.count({ count: items.length })}
        </span>
      </h3>
      <p className="explain-report-meta">
        <span className="explain-report-badge">{t.feedback.badge}</span>
        <span>{t.feedback.replyNote}</span>
      </p>
      <ul className="explain-feedback-list">
        {items.map((item) => (
          <li key={item.url}>
            <div className="explain-feedback-head">
              <strong>{item.author}</strong>
              <span>{item.authorAssociation}</span>
              {typeof item.line === "number" && (
                <span>{t.feedback.line({ line: item.line })}</span>
              )}
              {item.isResolved && <span>{t.feedback.resolved}</span>}
              <a href={item.url} target="_blank" rel="noopener noreferrer">
                {t.feedback.open}
                <ArrowUpRight size={12} />
              </a>
            </div>
            <p>{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReviewReports({
  file,
  reports,
  demo,
  feedback = [],
  onRerunReview,
  reviewBusy = false,
}: {
  file: DiffFile;
  reports?: Run["reports"];
  demo: boolean;
  feedback?: PrFeedbackItem[];
  onRerunReview?: () => void;
  reviewBusy?: boolean;
}) {
  const t = useT("review");
  const available = reportKeys.filter((key) => reports?.[key]?.trim());
  // Demo reports are fixed text, so there is nothing to re-run there.
  const rerun = onRerunReview && !demo && (
    <div className="explain-rerun">
      <button
        type="button"
        className="explain-retry"
        onClick={onRerunReview}
        disabled={reviewBusy}
        aria-busy={reviewBusy}
      >
        {reviewBusy ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <RotateCcw size={14} />
        )}
        {reviewBusy ? t.reports.rerunBusy : t.reports.rerun}
      </button>
      <small className="explain-empty-note">{t.reports.rerunNote}</small>
    </div>
  );
  const reviewOrder = parseReviewOrder(reports?.implementer ?? "");
  if (!available.length)
    return (
      <>
        <MaintainerFeedback items={feedback} />
        <div className="explain-empty">
          <Eye size={28} />
          <h3>{t.reports.emptyTitle}</h3>
          <p>{t.reports.emptyBody}</p>
          {rerun}
        </div>
      </>
    );
  return (
    <>
      <MaintainerFeedback items={feedback} />
      <ProvenanceLabel demo={demo} />
      <p className="explain-reports-intro">{t.reports.intro}</p>
      {reviewOrder.length > 0 && (
        <section className="explain-card explain-card-order">
          <h3>
            <ListOrdered size={15} />
            {t.reports.orderTitle}
          </h3>
          <p className="explain-order-intro">{t.reports.orderIntro}</p>
          <ol className="explain-order-list">
            {reviewOrder.map((entry) => (
              <li
                key={entry.path}
                aria-current={entry.path === file.path ? "true" : undefined}
              >
                <code>{entry.path}</code>
                {entry.reason && <span>{entry.reason}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
      {rerun}
      {available.map((key) => {
        const report = reports![key]!;
        const section = t.reports.sections[key];
        const mentions = reportMentionCount(report, file.path);
        return (
          <section className="explain-card explain-card-report" key={key}>
            <h3>
              <Eye size={15} />
              {section.title}
              <span className="explain-report-author">{section.author}</span>
            </h3>
            <p className="explain-report-meta">
              <span className="explain-report-badge">
                {t.reports.staticBadge}
              </span>
              <span>
                {mentions
                  ? t.reports.mentions({ count: mentions })
                  : t.reports.noMentions}
              </span>
            </p>
            <MarkdownContent>{report}</MarkdownContent>
          </section>
        );
      })}
      <p className="explain-evidence-note">
        {demo ? t.reports.evidenceDemo : t.reports.evidenceLive}
      </p>
    </>
  );
}

export function ExplanationPanel({
  file,
  messages,
  loading,
  onAsk,
  demo,
  reports,
  onRetryExplanation,
  chatRequestId = 0,
  onChatRequestHandled,
  explanationBusy = false,
  modules,
  note,
  onSaveNote,
  feedback = [],
  onRerunReview,
  reviewBusy,
  runLocale,
}: ExplanationPanelProps) {
  const t = useT("review");
  const fmt = useFormat();
  const [locale] = useLocale();
  const [tab, setTab] = useState<"explain" | "reports" | "chat">(
    chatRequestId ? "chat" : "explain",
  );
  const [question, setQuestion] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [noteDraft, setNoteDraft] = useState(note?.text ?? "");
  const [noteSaving, setNoteSaving] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const lastMessageCount = useRef(messages.length);
  const panelId = useId();
  const tablistKeys = useTablistKeys();

  useEffect(() => {
    setQuestion("");
    setShowAnswer(false);
    // Reports are run-level, so stay on that tab when the reader clicks through files.
    setTab((current) =>
      chatRequestId ? "chat" : current === "reports" ? "reports" : "explain",
    );
    lastMessageCount.current = messages.length;
  }, [file.path]);

  useEffect(() => {
    if (chatRequestId) {
      setTab("chat");
      onChatRequestHandled?.();
    }
  }, [chatRequestId]);

  useEffect(() => {
    // Only a new question requests the conversation view. Background answers
    // and automatic explanations must not interrupt someone reading a card.
    if (
      messages
        .slice(lastMessageCount.current)
        .some((message) => message.role === "user")
    ) {
      setTab("chat");
    }
    lastMessageCount.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (tab === "chat")
      chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, loading, tab]);

  useEffect(() => {
    setNoteDraft(note?.text ?? "");
  }, [file.path, note?.text]);

  function ask(value: string) {
    if (!value.trim() || loading || file.blocked) return;
    onAsk(value.trim());
    setQuestion("");
    setTab("chat");
  }

  async function saveNote() {
    if (!onSaveNote || noteSaving) return;
    setNoteSaving(true);
    try {
      await onSaveNote(noteDraft);
    } finally {
      setNoteSaving(false);
    }
  }

  const explanation = file.explanation;
  const [conceptHeading, ...conceptParagraphs] = (
    explanation?.concept || ""
  ).split("\n");
  const conceptBody = conceptParagraphs.join("\n").trim();
  const hasConceptHeading =
    conceptHeading.trim().length > 0 &&
    conceptHeading.trim().length <= 100 &&
    conceptBody.length > 0;
  const status = file.explanationStatus || (explanation ? "ready" : "pending");
  const questionCount = messages.filter(
    (message) => message.role === "user",
  ).length;
  const isTestFile = testFilePattern.test(file.path);
  const fileModule = moduleFor(file.path, modules);
  // A saved note keeps its text when the diff moves on; the badge says so.
  const noteStale = Boolean(
    note && file.fingerprint && note.fingerprint !== file.fingerprint,
  );
  const noteDirty = noteDraft !== (note?.text ?? "");
  // Saved explanations keep the language they were written in; regenerating
  // them in the UI language is not offered yet.
  const otherLanguage = parseLocale(runLocale);
  const languageNote =
    !demo && otherLanguage && otherLanguage !== locale
      ? t.provenance.otherLanguage({
          language: t.provenance.languages[otherLanguage],
        })
      : undefined;
  const presets = [
    t.presets.why,
    t.presets.risks,
    t.presets.test,
    ...(explanation ? [t.presets.elsewhere, t.presets.alternatives] : []),
    ...(isTestFile ? [t.presets.testFile] : []),
    ...(feedback.length ? [t.presets.feedback] : []),
  ];

  return (
    <aside className="explain-panel" aria-label={t.panel.label}>
      <div className="explain-header">
        <span className="explain-avatar">
          <Sparkles size={17} />
        </span>
        <div>
          <h2>{t.panel.title}</h2>
          <p>{t.panel.subtitle}</p>
        </div>
        <span className={`explain-mode ${demo ? "explain-mode-demo" : ""}`}>
          {demo ? t.panel.demoBadge : t.panel.liveBadge}
        </span>
      </div>
      <div
        className="explain-tabs"
        role="tablist"
        aria-label={t.panel.tabsLabel}
        onKeyDown={tablistKeys}
      >
        <button
          type="button"
          role="tab"
          id={`${panelId}-explain`}
          tabIndex={tab === "explain" ? 0 : -1}
          aria-selected={tab === "explain"}
          aria-controls={`${panelId}-content`}
          className={tab === "explain" ? "explain-tab-active" : ""}
          onClick={() => setTab("explain")}
        >
          <BookOpen size={14} />
          {t.panel.tabs.explain}
        </button>
        <button
          type="button"
          role="tab"
          id={`${panelId}-reports`}
          tabIndex={tab === "reports" ? 0 : -1}
          aria-selected={tab === "reports"}
          aria-controls={`${panelId}-content`}
          className={tab === "reports" ? "explain-tab-active" : ""}
          onClick={() => setTab("reports")}
        >
          <Eye size={14} />
          {t.panel.tabs.reports}
        </button>
        <button
          type="button"
          role="tab"
          id={`${panelId}-chat`}
          tabIndex={tab === "chat" ? 0 : -1}
          aria-selected={tab === "chat"}
          aria-controls={`${panelId}-content`}
          className={tab === "chat" ? "explain-tab-active" : ""}
          onClick={() => setTab("chat")}
        >
          <MessageCircle size={14} />
          {t.panel.tabs.chat}
          {questionCount > 0 && (
            <span className="explain-message-count">{questionCount}</span>
          )}
        </button>
      </div>
      <div className="explain-context">
        <FileCode2 size={13} />
        <span title={file.path}>{file.path}</span>
      </div>
      {fileModule && (
        <p
          className="explain-module"
          title={`${fileModule.path} · ${fileModule.purpose}`}
        >
          <FolderTree size={12} />
          <span>
            {withNodes(t.panel.module, {
              path: <code>{fileModule.path}</code>,
              purpose: fileModule.purpose,
            })}
          </span>
        </p>
      )}
      <div
        className="explain-content"
        id={`${panelId}-content`}
        role="tabpanel"
        aria-labelledby={`${panelId}-${tab}`}
        // Its text starts before anything focusable, so the panel itself is
        // a stop: keyboard users can scroll a long explanation.
        tabIndex={0}
      >
        {tab === "explain" ? (
          <>
            {file.blocked || status === "unavailable" ? (
              <div className="explain-empty">
                <AlertCircle size={28} />
                <h3>{t.explain.unavailableTitle}</h3>
                <p>
                  {file.blocked ||
                    file.explanationError ||
                    t.explain.unavailableBody}
                </p>
              </div>
            ) : explanation ? (
              <>
                <ProvenanceLabel demo={demo} />
                {languageNote && (
                  <p className="explain-language-note" role="note">
                    <Languages size={13} />
                    {languageNote}
                  </p>
                )}
                {isTestFile && (
                  <p className="explain-test-hint">
                    <FlaskConical size={13} />
                    {t.explain.testFileHint}
                  </p>
                )}
                <section className="explain-card explain-card-example">
                  <h3>
                    <MessageCircle size={15} />
                    {t.explain.cards.example}
                  </h3>
                  {explanation.example ? (
                    <>
                      <p className="explain-example-intro">
                        {t.explain.exampleIntro}
                      </p>
                      <div className="explain-example-scenario">
                        <span className="explain-example-label">
                          {t.explain.exampleScenario}
                        </span>
                        <MarkdownContent>
                          {explanation.example.scenario}
                        </MarkdownContent>
                      </div>
                      <div className="explain-example-comparison">
                        <div className="explain-example-before">
                          <h4>{t.explain.exampleBefore}</h4>
                          <MarkdownContent>
                            {explanation.example.before}
                          </MarkdownContent>
                        </div>
                        <div className="explain-example-after">
                          <h4>
                            <ArrowRight size={13} />
                            {t.explain.exampleAfter}
                          </h4>
                          <MarkdownContent>
                            {explanation.example.after}
                          </MarkdownContent>
                        </div>
                      </div>
                    </>
                  ) : status === "failed" ? (
                    <div className="explain-example-status" role="alert">
                      <p>{t.explain.exampleFailed}</p>
                      {file.explanationError && <p>{file.explanationError}</p>}
                      {onRetryExplanation && (
                        <button
                          className="explain-retry"
                          type="button"
                          disabled={explanationBusy}
                          onClick={onRetryExplanation}
                        >
                          <RotateCcw size={14} />
                          {explanationBusy
                            ? t.explain.retryBusy
                            : t.explain.retryExample}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div
                      className="explain-example-status"
                      role="status"
                      aria-live="polite"
                    >
                      <p className="explain-example-progress">
                        <LoaderCircle className="explain-spin" size={15} />
                        {t.explain.examplePending}
                      </p>
                      <p>{t.explain.examplePendingBody}</p>
                    </div>
                  )}
                </section>
                <section className="explain-card explain-card-summary">
                  <h3>
                    <span className="explain-card-number">01</span>
                    {t.explain.cards.summary}
                  </h3>
                  <MarkdownContent>{explanation.summary}</MarkdownContent>
                </section>
                <section className="explain-card">
                  <h3>
                    <span className="explain-card-number">02</span>
                    {t.explain.cards.reason}
                  </h3>
                  <MarkdownContent>{explanation.reason}</MarkdownContent>
                </section>
                <section className="explain-card explain-card-concept">
                  <h3>
                    <Lightbulb size={15} />
                    {t.explain.cards.concept}
                  </h3>
                  {hasConceptHeading ? (
                    <>
                      <div className="explain-concept-heading">
                        <MarkdownContent>{conceptHeading}</MarkdownContent>
                      </div>
                      <MarkdownContent>{conceptBody}</MarkdownContent>
                    </>
                  ) : (
                    <MarkdownContent>{explanation.concept}</MarkdownContent>
                  )}
                </section>
                <section className="explain-card explain-card-tip">
                  <h3>
                    <BookOpen size={15} />
                    {t.explain.cards.tip}
                  </h3>
                  <MarkdownContent>{explanation.tip}</MarkdownContent>
                </section>
                {explanation.alternatives && (
                  <section className="explain-card explain-card-alternatives">
                    <h3>
                      <Shuffle size={15} />
                      {t.explain.cards.alternatives}
                    </h3>
                    <MarkdownContent>{explanation.alternatives}</MarkdownContent>
                    {explanation.lookup && explanation.lookup.length > 0 && (
                      <p className="explain-lookup">
                        <span>{t.explain.lookup}</span>
                        {explanation.lookup.map((keyword) => (
                          <code key={keyword}>{keyword}</code>
                        ))}
                      </p>
                    )}
                  </section>
                )}
                {explanation.selfCheck && (
                  <section className="explain-card explain-card-selfcheck">
                    <h3>
                      <HelpCircle size={15} />
                      {t.explain.cards.selfCheck}
                    </h3>
                    <MarkdownContent>
                      {explanation.selfCheck.question}
                    </MarkdownContent>
                    <button
                      type="button"
                      className="explain-answer-toggle"
                      aria-expanded={showAnswer}
                      aria-controls={showAnswer ? `${panelId}-answer` : undefined}
                      onClick={() => setShowAnswer((current) => !current)}
                    >
                      {showAnswer ? t.explain.hideAnswer : t.explain.showAnswer}
                    </button>
                    {showAnswer && (
                      <div className="explain-answer" id={`${panelId}-answer`}>
                        <MarkdownContent>
                          {explanation.selfCheck.answer}
                        </MarkdownContent>
                      </div>
                    )}
                  </section>
                )}
                <p className="explain-evidence-note">
                  {demo ? t.explain.evidenceDemo : t.explain.evidenceLive}
                </p>
              </>
            ) : status === "failed" ? (
              <div
                className="explain-empty explain-generation-error"
                role="alert"
              >
                <AlertCircle size={28} />
                <h3>{t.explain.failedTitle}</h3>
                <p>{file.explanationError || t.explain.failedBody}</p>
                {onRetryExplanation && (
                  <button
                    className="explain-retry"
                    type="button"
                    disabled={explanationBusy}
                    onClick={onRetryExplanation}
                  >
                    <RotateCcw size={14} />
                    {explanationBusy ? t.explain.retryBusy : t.explain.retry}
                  </button>
                )}
                <span className="explain-empty-note">
                  {t.explain.failedNote}
                </span>
              </div>
            ) : (
              <div
                className="explain-generating"
                role="status"
                aria-live="polite"
              >
                <div className="explain-progress-heading">
                  {status === "generating" ? (
                    <LoaderCircle className="explain-spin" size={18} />
                  ) : (
                    <BookOpen size={18} />
                  )}
                  <div>
                    <h3>
                      {status === "generating"
                        ? t.explain.generatingTitle
                        : t.explain.pendingTitle}
                    </h3>
                    <p>
                      {status === "generating"
                        ? t.explain.generatingBody
                        : t.explain.pendingBody}
                    </p>
                  </div>
                </div>
                <div className="explain-skeletons" aria-hidden="true">
                  {[
                    t.explain.cards.example,
                    t.explain.cards.summary,
                    t.explain.cards.reason,
                    t.explain.cards.concept,
                    t.explain.cards.alternatives,
                    t.explain.cards.selfCheck,
                  ].map((title) => (
                    <div className="explain-skeleton" key={title}>
                      <span>{title}</span>
                      <i />
                      <i />
                      <i />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {onSaveNote && !file.blocked && (
              <section className="explain-card explain-card-note">
                <h3>
                  <PenLine size={15} />
                  <label htmlFor={`${panelId}-note`}>{t.note.label}</label>
                  {noteStale && (
                    <span className="explain-note-badge">
                      {t.note.staleBadge}
                    </span>
                  )}
                </h3>
                <p className="explain-note-intro">{t.note.intro}</p>
                <textarea
                  id={`${panelId}-note`}
                  className="explain-note-input"
                  rows={3}
                  maxLength={2000}
                  placeholder={t.note.placeholder}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                />
                <div className="explain-note-actions">
                  <span>
                    {noteStale
                      ? t.note.stale
                      : demo
                        ? t.note.demo
                        : note?.updatedAt
                          ? t.note.saved({ time: fmt.dateTime(note.updatedAt) })
                          : t.note.unsaved}
                  </span>
                  <button
                    type="button"
                    className="explain-note-save"
                    disabled={!(noteDirty || noteStale) || noteSaving}
                    onClick={() => void saveNote()}
                  >
                    {noteSaving ? t.note.saving : t.note.save}
                  </button>
                </div>
              </section>
            )}
          </>
        ) : tab === "reports" ? (
          <ReviewReports
            file={file}
            reports={reports}
            demo={demo}
            feedback={feedback}
            onRerunReview={onRerunReview}
            reviewBusy={reviewBusy}
          />
        ) : (
          <div
            className="explain-chat"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.length === 0 && (
              <div className="explain-chat-welcome">
                <span className="explain-chat-welcome-icon">
                  <MessageCircle size={22} />
                </span>
                <h3>{t.chat.welcomeTitle}</h3>
                <p>{t.chat.welcomeBody}</p>
                <div className="explain-presets">
                  {presets.map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      disabled={loading || Boolean(file.blocked)}
                      onClick={() => ask(preset)}
                    >
                      {preset}
                      <ArrowUpRight size={13} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => {
              // The failure text follows the UI language; only the flag marks it.
              const failed =
                message.role === "assistant" && message.failed === true;
              // Saved turns about an earlier diff stay readable but are marked.
              const stale =
                message.fingerprint !== undefined &&
                file.fingerprint !== undefined &&
                message.fingerprint !== file.fingerprint;
              return (
                <div
                  className={`explain-message explain-message-${message.role}${failed ? " explain-message-error" : ""}`}
                  key={`${index}-${message.role}`}
                  role={failed ? "alert" : undefined}
                >
                  <div className="explain-message-author">
                    {message.role === "assistant" ? (
                      <>
                        <span className="explain-mini-avatar">
                          {failed ? (
                            <AlertCircle size={12} />
                          ) : (
                            <Sparkles size={12} />
                          )}
                        </span>
                        {failed ? t.chat.failed : t.chat.assistant}
                        {demo && (
                          <span className="explain-inline-demo">
                            {t.panel.demoBadge}
                          </span>
                        )}
                      </>
                    ) : (
                      t.chat.you
                    )}
                    {stale && (
                      <span className="explain-inline-demo explain-inline-stale">
                        {t.chat.stale}
                      </span>
                    )}
                  </div>
                  <div className="explain-message-body">
                    <MarkdownContent>{message.content}</MarkdownContent>
                  </div>
                  {/* Demo answers open with their own sample line. */}
                  {message.role === "assistant" && !failed && !demo && (
                    <p className="explain-message-provenance">
                      {t.provenance.ai}
                    </p>
                  )}
                </div>
              );
            })}
            {loading && (
              <div className="explain-loading" role="status">
                <span />
                <span />
                <span />
                <span className="explain-loading-text">{t.chat.loading}</span>
              </div>
            )}
            <div ref={chatEnd} />
          </div>
        )}
      </div>
      {tab !== "chat" ? (
        <div className="explain-followup">
          <button
            type="button"
            onClick={() => setTab("chat")}
            disabled={Boolean(file.blocked)}
          >
            <MessageCircle size={15} />
            {t.panel.askAboutChange}
            <ArrowRight size={15} />
          </button>
        </div>
      ) : (
        <div className="explain-composer">
          <form
            className="explain-input-box"
            onSubmit={(event) => {
              event.preventDefault();
              ask(question);
            }}
          >
            <textarea
              aria-label={t.chat.inputLabel}
              placeholder={
                file.blocked ? t.chat.placeholderBlocked : t.chat.placeholder
              }
              value={question}
              disabled={Boolean(file.blocked)}
              rows={2}
              maxLength={5000}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  ask(question);
                }
              }}
            />
            <div className="explain-input-bottom">
              <span>
                <FileCode2 size={12} />
                {file.blocked ? t.chat.contextBlocked : t.chat.contextAttached}
              </span>
              <button
                type="submit"
                aria-label={t.chat.send}
                disabled={!question.trim() || loading || Boolean(file.blocked)}
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </form>
          <p className="explain-disclaimer">
            {demo ? t.chat.disclaimerDemo : t.chat.disclaimerLive}
          </p>
        </div>
      )}
    </aside>
  );
}
