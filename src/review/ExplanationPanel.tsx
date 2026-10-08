import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  Eye,
  FileCode2,
  FlaskConical,
  FolderTree,
  HelpCircle,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  PenLine,
  RotateCcw,
  Shuffle,
  Sparkles,
} from "lucide-react";
import type { LearnerNote } from "../../shared/explanations";
import type { ChatMessage, DiffFile, Run } from "../types";
import { MarkdownContent } from "./MarkdownContent";
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
const reportSections = [
  { key: "implementer", title: "Lead 整合摘要", author: "Atlas · Team lead" },
  { key: "reviewer", title: "程式審查", author: "Lens · Reviewer" },
  { key: "tester", title: "測試分析", author: "Scout · Test analyst" },
] as const;

/** Paragraphs (split on blank lines) that mention the path or its basename. */
export function reportMentionCount(report: string, filePath: string) {
  const basename = filePath.split("/").pop() || filePath;
  return report
    .split(/\n\s*\n/)
    .filter(
      (paragraph) =>
        paragraph.includes(filePath) || paragraph.includes(basename),
    ).length;
}

export function ReviewReports({
  file,
  reports,
  demo,
}: {
  file: DiffFile;
  reports?: Run["reports"];
  demo: boolean;
}) {
  const available = reportSections.filter((section) =>
    reports?.[section.key]?.trim(),
  );
  if (!available.length)
    return (
      <div className="explain-empty">
        <Eye size={28} />
        <h3>這次工作還沒有審查報告</h3>
        <p>Lead 整合、Reviewer 與 Test analyst 完成後，報告全文會放在這裡。</p>
      </div>
    );
  return (
    <>
      <div className="explain-ready-label">
        <Check size={13} />
        {demo ? "示範報告 · 預先整理的內容" : "團隊回報的完整內容"}
      </div>
      <p className="explain-reports-intro">
        這些是獨立靜態審查，不是執行結果；每份報告保留全文，並標示提到目前檔案的段落數。
      </p>
      {available.map((section) => {
        const report = reports![section.key]!;
        const mentions = reportMentionCount(report, file.path);
        return (
          <section className="explain-card explain-card-report" key={section.key}>
            <h3>
              <Eye size={15} />
              {section.title}
              <span className="explain-report-author">{section.author}</span>
            </h3>
            <p className="explain-report-meta">
              <span className="explain-report-badge">
                獨立靜態審查，非執行結果
              </span>
              <span>
                {mentions
                  ? `本報告提到此檔 ${mentions} 處`
                  : "此報告未直接提到本檔"}
              </span>
            </p>
            <MarkdownContent>{report}</MarkdownContent>
          </section>
        );
      })}
      <p className="explain-evidence-note">
        {demo
          ? "示範報告不是即時 AI 推論，也不代表測試結果。"
          : "報告內容由各角色靜態檢視產生；實測結果以報告中明確列出的指令與輸出為準。"}
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
}: ExplanationPanelProps) {
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
  const presets = [
    "為什麼要這樣改？",
    "有哪些需要注意的風險？",
    "要怎麼測試這段程式碼？",
    ...(explanation
      ? [
          "這個觀念在專案其他地方還能用在哪？",
          "如果不這樣改，還有哪些做法？各有什麼取捨？",
        ]
      : []),
    ...(isTestFile ? ["這個測試在保護什麼行為？"] : []),
  ];

  return (
    <aside className="explain-panel" aria-label="程式碼學習助手">
      <div className="explain-header">
        <span className="explain-avatar">
          <Sparkles size={17} />
        </span>
        <div>
          <h2>讀懂每一次改變</h2>
          <p>從發生什麼，到為什麼這樣做</p>
        </div>
        <span className={`explain-mode ${demo ? "explain-mode-demo" : ""}`}>
          {demo ? "示範" : "AI"}
        </span>
      </div>
      <div className="explain-tabs" role="tablist" aria-label="學習面板">
        <button
          type="button"
          role="tab"
          id={`${panelId}-explain`}
          aria-selected={tab === "explain"}
          aria-controls={`${panelId}-content`}
          className={tab === "explain" ? "explain-tab-active" : ""}
          onClick={() => setTab("explain")}
        >
          <BookOpen size={14} />
          變更解說
        </button>
        <button
          type="button"
          role="tab"
          id={`${panelId}-reports`}
          aria-selected={tab === "reports"}
          aria-controls={`${panelId}-content`}
          className={tab === "reports" ? "explain-tab-active" : ""}
          onClick={() => setTab("reports")}
        >
          <Eye size={14} />
          審查者怎麼看
        </button>
        <button
          type="button"
          role="tab"
          id={`${panelId}-chat`}
          aria-selected={tab === "chat"}
          aria-controls={`${panelId}-content`}
          className={tab === "chat" ? "explain-tab-active" : ""}
          onClick={() => setTab("chat")}
        >
          <MessageCircle size={14} />
          追問 Agent
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
            所在模組 <code>{fileModule.path}</code>：{fileModule.purpose}
          </span>
        </p>
      )}
      <div
        className="explain-content"
        id={`${panelId}-content`}
        role="tabpanel"
        aria-labelledby={`${panelId}-${tab}`}
      >
        {tab === "explain" ? (
          <>
            {file.blocked || status === "unavailable" ? (
              <div className="explain-empty">
                <AlertCircle size={28} />
                <h3>目前無法解說此檔案</h3>
                <p>
                  {file.blocked ||
                    file.explanationError ||
                    "這份變更目前沒有可供解說的文字差異。"}
                </p>
              </div>
            ) : explanation ? (
              <>
                <div className="explain-ready-label">
                  <Check size={13} />
                  {demo
                    ? "示範解說 · 預先整理的學習內容"
                    : "已依這份 diff 自動整理"}
                </div>
                {isTestFile && (
                  <p className="explain-test-hint">
                    <FlaskConical size={13} />
                    測試就是行為規格：先讀 it/test 描述，再對照 expect
                    看它保護哪個邊界。
                  </p>
                )}
                <section className="explain-card explain-card-example">
                  <h3>
                    <MessageCircle size={15} />
                    白話文舉例
                  </h3>
                  {explanation.example ? (
                    <>
                      <p className="explain-example-intro">
                        先用一個情境，看懂修改前後的差別。
                      </p>
                      <div className="explain-example-scenario">
                        <span className="explain-example-label">
                          想像這個情境
                        </span>
                        <MarkdownContent>
                          {explanation.example.scenario}
                        </MarkdownContent>
                      </div>
                      <div className="explain-example-comparison">
                        <div className="explain-example-before">
                          <h4>修改前</h4>
                          <MarkdownContent>
                            {explanation.example.before}
                          </MarkdownContent>
                        </div>
                        <div className="explain-example-after">
                          <h4>
                            <ArrowRight size={13} />
                            修改後
                          </h4>
                          <MarkdownContent>
                            {explanation.example.after}
                          </MarkdownContent>
                        </div>
                      </div>
                    </>
                  ) : status === "failed" ? (
                    <div className="explain-example-status" role="alert">
                      <p>白話例子尚未整理完成，其他解說可以繼續閱讀。</p>
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
                            ? "其他解說整理中…"
                            : "重新整理白話例子"}
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
                        正在補上白話例子
                      </p>
                      <p>完成後會自動放在這裡，你可以先閱讀下方解說。</p>
                    </div>
                  )}
                </section>
                <section className="explain-card explain-card-summary">
                  <h3>
                    <span className="explain-card-number">01</span>
                    這段改了什麼？
                  </h3>
                  <MarkdownContent>{explanation.summary}</MarkdownContent>
                </section>
                <section className="explain-card">
                  <h3>
                    <span className="explain-card-number">02</span>
                    為什麼這樣改？
                  </h3>
                  <MarkdownContent>{explanation.reason}</MarkdownContent>
                </section>
                <section className="explain-card explain-card-concept">
                  <h3>
                    <Lightbulb size={15} />
                    帶走一個開發觀念
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
                    審閱時，多想一步
                  </h3>
                  <MarkdownContent>{explanation.tip}</MarkdownContent>
                </section>
                {explanation.alternatives && (
                  <section className="explain-card explain-card-alternatives">
                    <h3>
                      <Shuffle size={15} />
                      如果換個做法？
                    </h3>
                    <MarkdownContent>{explanation.alternatives}</MarkdownContent>
                    {explanation.lookup && explanation.lookup.length > 0 && (
                      <p className="explain-lookup">
                        <span>可以查：</span>
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
                      考考自己
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
                      {showAnswer ? "收起答案" : "看答案"}
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
                  {demo
                    ? "示範內容不是即時 AI 推論，也不代表測試結果。"
                    : "解說以目前差異為依據；實際行為請搭配原始碼與測試確認。"}
                </p>
              </>
            ) : status === "failed" ? (
              <div
                className="explain-empty explain-generation-error"
                role="alert"
              >
                <AlertCircle size={28} />
                <h3>這份解說尚未整理完成</h3>
                <p>
                  {file.explanationError ||
                    "產生解說時發生問題，變更內容仍可正常審閱。"}
                </p>
                {onRetryExplanation && (
                  <button
                    className="explain-retry"
                    type="button"
                    disabled={explanationBusy}
                    onClick={onRetryExplanation}
                  >
                    <RotateCcw size={14} />
                    {explanationBusy ? "其他解說整理中…" : "重新整理解說"}
                  </button>
                )}
                <span className="explain-empty-note">
                  完成後會直接出現在這裡
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
                        ? "正在把變更整理成白話"
                        : "解說會自動準備好"}
                    </h3>
                    <p>
                      {status === "generating"
                        ? "對照實際 diff，整理具體情境、設計原因與審閱重點。"
                        : "Agents 完成變更後，就會在這裡整理解說。"}
                    </p>
                  </div>
                </div>
                <div className="explain-skeletons" aria-hidden="true">
                  {[
                    "白話文舉例",
                    "這段改了什麼？",
                    "為什麼這樣改？",
                    "帶走一個開發觀念",
                    "如果換個做法？",
                    "考考自己",
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
                  <label htmlFor={`${panelId}-note`}>我的理解</label>
                  {noteStale && (
                    <span className="explain-note-badge">diff 已更新</span>
                  )}
                </h3>
                <p className="explain-note-intro">
                  用自己的話寫下這份變更做了什麼、為什麼；筆記會和寫下時的 diff
                  版本一起保存。
                </p>
                <textarea
                  id={`${panelId}-note`}
                  className="explain-note-input"
                  rows={3}
                  maxLength={2000}
                  placeholder="例如：這次把固定等待改成指數退避，是為了……"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                />
                <div className="explain-note-actions">
                  <span>
                    {noteStale
                      ? "這段筆記寫於較早的 diff 版本，文字已保留；確認後重新儲存即可更新。"
                      : demo
                        ? "示範模式的筆記不會保存，重新整理後會消失"
                        : note?.updatedAt
                          ? `已儲存 · ${new Date(note.updatedAt).toLocaleString("zh-TW")}`
                          : "尚未儲存"}
                  </span>
                  <button
                    type="button"
                    className="explain-note-save"
                    disabled={!(noteDirty || noteStale) || noteSaving}
                    onClick={() => void saveNote()}
                  >
                    {noteSaving ? "儲存中…" : "儲存筆記"}
                  </button>
                </div>
              </section>
            )}
          </>
        ) : tab === "reports" ? (
          <ReviewReports file={file} reports={reports} demo={demo} />
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
                <h3>讓理解，更進一步</h3>
                <p>問設計原因、測試方式，或在左側選取一段程式碼深入討論。</p>
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
              const failed =
                message.role === "assistant" &&
                message.content.startsWith("這次未能取得回答：");
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
                        {failed ? "回答失敗" : "學習助手"}
                        {demo && (
                          <span className="explain-inline-demo">示範</span>
                        )}
                      </>
                    ) : (
                      "你"
                    )}
                  </div>
                  <div className="explain-message-body">
                    <MarkdownContent>{message.content}</MarkdownContent>
                  </div>
                </div>
              );
            })}
            {loading && (
              <div className="explain-loading" role="status">
                <span />
                <span />
                <span />
                <span className="explain-loading-text">正在閱讀變更…</span>
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
            針對這份變更追問
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
              aria-label="向 Agent 提問"
              placeholder={
                file.blocked
                  ? "此檔案目前無法提供解說"
                  : "想更深入了解哪個部分？"
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
                {file.blocked ? "無法附上檔案上下文" : "已附上檔案 diff"}
              </span>
              <button
                type="submit"
                aria-label="送出問題"
                disabled={!question.trim() || loading || Boolean(file.blocked)}
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </form>
          <p className="explain-disclaimer">
            {demo
              ? "示範回覆為預寫內容，未呼叫 AI 模型"
              : "Enter 送出 · Shift + Enter 換行"}
          </p>
        </div>
      )}
    </aside>
  );
}
