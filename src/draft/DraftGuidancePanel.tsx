import { useId, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Circle,
  ClipboardList,
  FileText,
  GitCommitHorizontal,
  Info,
  LoaderCircle,
  MessagesSquare,
  Quote,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { issueRule } from "../../shared/draft-checks";
import {
  linuxContributionUrl,
  type DraftPreparation,
  type DraftProposal,
  type DraftSource,
} from "../../shared/drafts";
import { MarkdownContent } from "../review/MarkdownContent";
import "./drafts.css";

interface Props {
  preparation?: DraftPreparation;
  busy: boolean;
  disabled?: boolean;
  demo?: boolean;
  /** The issue the user linked in the contribution settings, if any. */
  issueUrl?: string;
  onGenerate: () => void;
  onApply: (proposal: DraftProposal) => void;
  /** True while the editor holds this proposal's title and body unchanged. */
  applied?: boolean;
}

/**
 * Community etiquette the person confirms for themselves. The checkboxes
 * are local UI state only: nothing is saved and publishing is never blocked.
 */
const etiquetteReminders = [
  {
    id: "claimed",
    text: "是否已在 issue 留言表明要處理？",
    why: "避免和別人做重複的工作，也讓 maintainer 知道有人接手。",
  },
  {
    id: "discussed",
    text: "專案是否要求先開 issue 討論？",
    why: "有些專案希望先確認方向與 AI 協作是否可接受，再收 PR；先問一句，可以省下雙方審閱一份不會被接受的 PR 的時間。",
  },
] as const;

const sourceKinds: Record<DraftSource["kind"], string> = {
  contributing: "貢獻規範",
  template: "PR 範本",
  documentation: "專案文件",
  maintainer: "維護者指引",
  example: "參考案例",
  automation: "自動檢查",
};

function webLink(value?: string) {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function DraftGuidancePanel({
  preparation,
  busy,
  disabled = false,
  demo = false,
  issueUrl,
  onGenerate,
  onApply,
  applied = false,
}: Props) {
  const prefix = useId().replaceAll(":", "");
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const issueLink = webLink(issueUrl);
  const proposal = preparation?.proposal;
  const sources = preparation?.context?.sources ?? [];
  const template = sources.find(
    (source) => source.id === proposal?.templateSourceId,
  );
  const issueRequirement = issueRule(sources);
  const checkedAt = preparation?.context?.checkedAt;
  const checkedDate = checkedAt ? new Date(checkedAt) : undefined;
  const generating = busy || preparation?.status === "generating";
  const ready = preparation?.status === "ready" && !!proposal;
  const sourceAnchor = (index: number) => `draft-source-${prefix}-${index}`;
  const statusMessage = generating
    ? "正在閱讀貢獻規範與 PR 範本，並對照本次變更整理建議。你可以繼續編輯下方草稿。"
    : preparation?.status === "failed"
      ? preparation.error ||
        "這次未能整理草稿，請稍後重試。下方編輯內容已保留。"
      : preparation?.status === "stale"
        ? "變更內容已更新，這份建議需要重新整理。請產生新版建議後再套用。"
        : undefined;
  const generateLabel = generating
    ? "正在整理…"
    : preparation?.status === "failed"
      ? "重新嘗試"
      : preparation
        ? "重新整理建議"
        : demo
          ? "查看草稿建議示範"
          : "依專案規範產生建議草稿";

  return (
    <section
      className="draft-guidance-panel"
      aria-labelledby={`draft-guidance-${prefix}`}
    >
      <header className="draft-guidance-header">
        <span className="draft-guidance-icon" aria-hidden="true">
          <BookOpen size={21} />
        </span>
        <div className="draft-guidance-heading">
          <div className="draft-guidance-eyebrow">CONTRIBUTION GUIDE</div>
          <h2 id={`draft-guidance-${prefix}`}>寫出維護者容易理解的 PR</h2>
          <p>先看投稿規範與範本，再把這次貢獻整理成清楚的草稿。</p>
        </div>
        <div className="draft-guidance-actions">
          {demo && (
            <span className="draft-guidance-badge is-demo">示範資料</span>
          )}
          {proposal && (
            <span
              className={`draft-guidance-badge ${proposal.policy === "linux" ? "is-fallback" : ""}`}
            >
              {proposal.policy === "repository"
                ? "依專案規範"
                : "Linux 原則 · PR 調整版"}
            </span>
          )}
          <button
            type="button"
            className="button secondary draft-guidance-generate"
            onClick={onGenerate}
            disabled={disabled || generating}
          >
            {generating ? (
              <LoaderCircle className="spin" size={15} />
            ) : preparation ? (
              <RefreshCw size={15} />
            ) : (
              <Sparkles size={15} />
            )}
            {generateLabel}
          </button>
        </div>
      </header>

      {statusMessage && (
        <div
          className={`draft-guidance-notice ${preparation?.status === "failed" ? "is-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {generating ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Info size={17} />
          )}
          <p>{statusMessage}</p>
        </div>
      )}

      {!preparation && (
        <div className="draft-guidance-empty">
          <span>
            <FileText size={16} /> 核對規範與範本
          </span>
          <span>
            <Quote size={16} /> 每個建議附上依據
          </span>
          <span>
            <ArrowDownToLine size={16} /> 由你選擇套用
          </span>
          <p>
            {demo
              ? "使用示範文件體驗完整流程，不會讀取或修改遠端專案。"
              : "適用於已完成變更的任務；舊任務也可以在這裡補上草稿建議。"}
          </p>
        </div>
      )}

      {!!preparation?.context?.warnings.length && (
        <div className="draft-guidance-warnings">
          <div>
            <Info size={16} />
            <strong>閱讀範圍與待確認事項</strong>
          </div>
          <ul>
            {preparation.context.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {proposal && (
        <>
          <p className="draft-guidance-summary">{proposal.summary}</p>
          <div className="draft-guidance-columns">
            <div className="draft-guidance-rules">
              <h3>
                <Quote size={16} />{" "}
                {proposal.policy === "linux" && !proposal.rules.length
                  ? "預設寫作原則"
                  : "這份草稿的撰寫依據"}
              </h3>
              {proposal.rules.length ? (
                <ol>
                  {proposal.rules.map((rule, index) => {
                    const sourceIndex = sources.findIndex(
                      (source) => source.id === rule.sourceId,
                    );
                    const source = sources[sourceIndex];
                    const url = webLink(source?.url);
                    return (
                      <li key={`${rule.sourceId}-${index}`}>
                        <span
                          className="draft-guidance-number"
                          aria-hidden="true"
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <p>{rule.text}</p>
                          {source ? (
                            <a
                              className="draft-guidance-source-link"
                              href={url ?? `#${sourceAnchor(sourceIndex)}`}
                              {...(url
                                ? {
                                    target: "_blank",
                                    rel: "noopener noreferrer",
                                  }
                                : {})}
                            >
                              <FileText size={12} />
                              {source.label}
                              {url && <ArrowUpRight size={12} />}
                            </a>
                          ) : (
                            <span className="draft-guidance-source-missing">
                              未附可核對的來源
                            </span>
                          )}
                          <details className="draft-guidance-quote">
                            <summary>
                              <ChevronDown size={13} /> 查看原文依據
                            </summary>
                            <blockquote>{rule.quote}</blockquote>
                          </details>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : proposal.policy === "linux" ? (
                <ol>
                  {[
                    "具體簡潔的標題，直接說明變更。",
                    "交代問題與對使用者的影響。",
                    "說明修改理由、設計取捨與限制。",
                    "如實記錄驗證結果與未完成事項。",
                  ].map((principle, index) => (
                    <li key={principle}>
                      <span
                        className="draft-guidance-number"
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <p>{principle}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="draft-guidance-template-note">
                  {template ? (
                    <>
                      依照「<strong>{template.label}</strong>
                      」整理段落。此範本未附額外寫作規範，請核對每個段落是否符合本次變更。
                    </>
                  ) : (
                    "未附額外寫作規範，請對照來源文件確認草稿段落。"
                  )}
                </p>
              )}
            </div>
            <div className="draft-guidance-checks">
              <h3>
                <ClipboardList size={16} /> 送出前由你確認
              </h3>
              <p>以下是核對提醒，尚未代表完成檢查。</p>
              <ul>
                {proposal.checklist.map((item, index) => (
                  <li key={index}>
                    <Circle size={14} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <details className="draft-guidance-proposal">
            <summary>
              <span className="draft-guidance-proposal-label">
                <FileText size={17} />
                <span>
                  <strong>預覽建議草稿</strong>
                  <small>{proposal.title}</small>
                </span>
              </span>
              <ChevronDown size={17} />
            </summary>
            <div className="draft-guidance-proposal-content">
              <h3>{proposal.title}</h3>
              <MarkdownContent>{proposal.body}</MarkdownContent>
            </div>
          </details>
          <div className="draft-guidance-apply">
            <p>
              {applied
                ? "下方編輯區就是這份建議的原文。說明會原樣送到 GitHub，請用自己的話確認後再送出。"
                : "套用後仍可編輯，儲存後才更新草稿。"}
            </p>
            <button
              type="button"
              className="button primary"
              onClick={() => onApply(proposal)}
              disabled={disabled || generating || !ready || applied}
            >
              <ArrowDownToLine size={15} /> {applied ? "已套用" : "套用建議草稿"}
            </button>
          </div>

          {proposal.commitMessageSuggestion && (
            <div className="draft-guidance-commit">
              <h3>
                <GitCommitHorizontal size={16} /> 提交訊息建議
              </h3>
              <pre>{proposal.commitMessageSuggestion.message}</pre>
              <p>{proposal.commitMessageSuggestion.rationale}</p>
              {proposal.commitMessageSuggestion.sources.length > 0 && (
                <p className="draft-guidance-commit-sources">
                  依據：
                  {proposal.commitMessageSuggestion.sources.map((id) => {
                    const sourceIndex = sources.findIndex(
                      (source) => source.id === id,
                    );
                    const source = sources[sourceIndex];
                    const url = webLink(source?.url);
                    return source ? (
                      <a
                        key={id}
                        className="draft-guidance-source-link"
                        href={url ?? `#${sourceAnchor(sourceIndex)}`}
                        {...(url
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                      >
                        <FileText size={12} />
                        {source.label}
                        {url && <ArrowUpRight size={12} />}
                      </a>
                    ) : (
                      <span key={id} className="draft-guidance-source-missing">
                        未附可核對的來源
                      </span>
                    );
                  })}
                </p>
              )}
              <p className="draft-guidance-commit-why">
                為什麼專案會要求 <code>type(scope)</code> 或
                sign-off？採用 Conventional Commits 的專案靠主旨的{" "}
                <code>type(scope): 說明</code>{" "}
                自動產生變更日誌並決定版本號，commitlint 會在 CI
                擋下不符格式的提交；採用 DCO 的專案要求每個 commit 附上{" "}
                <code>Signed-off-by: 姓名 &lt;email&gt;</code>
                ，表示你有權以該授權貢獻這段程式碼，DCO bot 檢查的是 commit
                trailer，不是 PR
                說明。這份建議只整理規範要求的格式；簽署是你本人的聲明，請在「提交訊息」欄位自行輸入，模型不會代填。
              </p>
            </div>
          )}
        </>
      )}

      {!demo && preparation?.context && (
        <div className="draft-guidance-source-meta">
          <span>
            基準版本 <code>{preparation.context.baseSha.slice(0, 7)}</code>
          </span>
          {checkedDate && !Number.isNaN(checkedDate.getTime()) && (
            <span>
              查閱{" "}
              <time dateTime={checkedAt} title="台北時間">
                {checkedDate.toLocaleString("zh-TW", {
                  timeZone: "Asia/Taipei",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </time>
            </span>
          )}
        </div>
      )}

      {!!sources.length && (
        <details className="draft-guidance-sources">
          <summary>
            <FileText size={15} />
            <span>
              查閱來源文件 <small>{sources.length} 份</small>
            </span>
            <ChevronDown size={15} />
          </summary>
          <div className="draft-guidance-source-list">
            {sources.map((source, index) => {
              const url = webLink(source.url);
              return (
                <details key={source.id} id={sourceAnchor(index)}>
                  <summary>
                    <span>
                      {source.label}
                      <small>{source.path ?? sourceKinds[source.kind]}</small>
                    </span>
                    <span className="draft-guidance-source-kind">
                      {source.id === proposal?.templateSourceId
                        ? "本次採用範本"
                        : sourceKinds[source.kind]}
                    </span>
                    <ChevronDown size={14} />
                  </summary>
                  <div className="draft-guidance-source-content">
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        開啟來源文件 <ArrowUpRight size={13} />
                      </a>
                    )}
                    <pre tabIndex={0} aria-label={`${source.label}原文`}>
                      {source.content}
                    </pre>
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      )}

      <section
        className="draft-guidance-etiquette"
        aria-labelledby={`draft-etiquette-${prefix}`}
      >
        <h3 id={`draft-etiquette-${prefix}`}>
          <MessagesSquare size={16} /> 送出前，先和社群打個招呼
        </h3>
        <p>
          開源社群重視這兩件事，是因為 maintainer
          的時間有限：事先留言能避免兩個人改同一個問題，也讓對方在你投入前就能說「這個方向可以」或「我們不收這類變更」。這裡的勾選只是給自己的提醒，不會儲存，也不會阻擋送出。
        </p>
        <ul>
          {etiquetteReminders.map((reminder) => {
            const inputId = `draft-etiquette-${prefix}-${reminder.id}`;
            return (
              <li key={reminder.id}>
                <input
                  id={inputId}
                  type="checkbox"
                  checked={confirmed.includes(reminder.id)}
                  onChange={(event) =>
                    setConfirmed((previous) =>
                      event.target.checked
                        ? [...previous, reminder.id]
                        : previous.filter((entry) => entry !== reminder.id),
                    )
                  }
                />
                <label htmlFor={inputId}>
                  <strong>{reminder.text}</strong>
                  <small>{reminder.why}</small>
                </label>
              </li>
            );
          })}
        </ul>
        {issueRequirement && (
          <p className="draft-guidance-issue-rule" role="note">
            <strong>這個專案的規範：</strong>「{issueRequirement.quote}」
            <small>
              來源：{issueRequirement.label}。沒有連結 issue
              時，送出前會請你再確認一次。
            </small>
          </p>
        )}
        {issueLink && (
          <a href={issueLink} target="_blank" rel="noopener noreferrer">
            開啟你填寫的 issue <ArrowUpRight size={12} />
          </a>
        )}
      </section>

      {proposal?.policy === "linux" && (
        <p className="draft-guidance-linux">
          以{" "}
          <a
            href={linuxContributionUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Linux 官方提交指引 <ArrowUpRight size={12} />
          </a>{" "}
          中的動機、變更與驗證原則作為備用依據，調整成 GitHub PR
          格式。Signed-off-by 等簽署資訊需由本人確認，不會自動填入。
        </p>
      )}
    </section>
  );
}

/** Synthetic content for the local demo; none of these rules are attributed to a real repository. */
export const demoDraftPreparation: DraftPreparation = {
  status: "ready",
  fingerprint: "demo-draft-guidance",
  context: {
    checkedAt: "2026-10-03T00:00:00.000Z",
    baseSha: "demo",
    warnings: [
      "這是介面示範，來源文件、規範與草稿均為示範資料，未讀取任何實際專案。",
    ],
    sources: [
      {
        id: "demo-contributing",
        kind: "contributing",
        label: "貢獻規範（示範）",
        path: "CONTRIBUTING.md",
        content:
          "# 示範貢獻規範\n\n標題應直接描述使用者會得到的改善。\n\n測試段落應區分已執行的檢查與仍需驗證的項目。\n\n提交訊息主旨使用 type(scope): 說明 的格式，空一行後說明原因。",
      },
      {
        id: "demo-template",
        kind: "template",
        label: "PR 範本（示範）",
        path: ".github/PULL_REQUEST_TEMPLATE.md",
        content:
          "## 修改動機\n\n## 變更內容\n\n## 驗證與限制\n\n請區分已執行的檢查與待驗證項目。",
      },
    ],
  },
  proposal: {
    title: "改善讀取請求遇到暫時失敗時的恢復方式",
    policy: "repository",
    summary:
      "這份示範沿用專案範本，先交代使用者遇到的問題，再說明重試範圍與需要確認的限制。",
    templateSourceId: "demo-template",
    body: "## 修改動機\n\n當讀取請求遇到暫時性網路問題時，使用者需要重新操作才能繼續。此示範說明如何讓符合條件的讀取請求有機會自動恢復。\n\n## 變更內容\n\n- 限定可重試的請求與錯誤種類。\n- 加上等待時間與重試次數上限。\n- 保留最終失敗時的錯誤訊息。\n\n## 驗證與限制\n\n這是草稿介面示範，**尚未執行任何測試**。送出前需確認：\n\n- 暫時失敗後成功的情境。\n- 超過重試上限時仍正確回報錯誤。\n- 不適合重試的寫入操作不會重複送出。",
    rules: [
      {
        text: "標題直接說明這次貢獻帶來的改善。",
        sourceId: "demo-contributing",
        quote: "標題應直接描述使用者會得到的改善。",
      },
      {
        text: "把驗證狀況與限制放進範本，避免把待測項目寫成已通過。",
        sourceId: "demo-template",
        quote: "請區分已執行的檢查與待驗證項目。",
      },
    ],
    checklist: [
      "確認範本各段落與實際 diff 一致。",
      "填入真正執行過的測試指令與結果。",
      "核對重試上限及不應重試的操作範圍。",
    ],
    commitMessageSuggestion: {
      message:
        "fix(client): retry temporary read failures with backoff\n\nTemporary network errors forced users to repeat read requests.\nRetry only idempotent reads, cap the attempts and keep the final\nerror message when the retries are exhausted.",
      rationale:
        "示範貢獻規範要求主旨使用 type(scope): 說明 的格式，並在空一行後說明原因；這份建議不含任何簽署欄位。",
      sources: ["demo-contributing"],
    },
  },
};
