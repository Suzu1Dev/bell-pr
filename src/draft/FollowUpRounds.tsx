import { ExternalLink, GitCommitHorizontal, Undo2 } from "lucide-react";
import type { FollowUpRound } from "../../shared/followups";
import type { PrFeedbackItem } from "../../shared/pr-feedback";

interface Props {
  rounds: FollowUpRound[];
  /** owner/name the PR branch lives in, for commit links. */
  headRepository?: string;
  /** The latest feedback read, to show what each round was asked to address. */
  feedback?: PrFeedbackItem[];
  /** Shown on the round still waiting for review; never on a running or pushed one. */
  onDiscard?: () => void;
  busy?: boolean;
}

const statusLabels: Record<FollowUpRound["status"], string> = {
  running: "修正中",
  review: "等待審閱與推送",
  published: "已推送",
  failed: "沒有完成",
  cancelled: "已停止",
  discarded: "已放棄",
};

/** Rounds of changes made after maintainer review, newest first. */
export function FollowUpRounds({
  rounds,
  headRepository,
  feedback = [],
  onDiscard,
  busy = false,
}: Props) {
  const label = (url: string) => {
    if (!url) return "你的補充說明";
    const item = feedback.find((entry) => entry.url === url);
    return item
      ? `${item.author}${item.path ? ` · ${item.path}${typeof item.line === "number" ? `:${item.line}` : ""}` : ""}`
      : "回饋";
  };
  return (
    <section className="follow-up-rounds" aria-labelledby="follow-up-rounds-title">
      <h2 id="follow-up-rounds-title">依 review 修正的紀錄</h2>
      <p>
        每一輪經你審閱、核准後，會成為 PR 分支上的一個新 commit；PR
        標題與說明維持原樣，回覆 reviewer 仍由你在 GitHub 上處理。
      </p>
      <ol>
        {[...rounds].reverse().map((round) => {
          const number = rounds.indexOf(round) + 1;
          return (
            <li key={round.id} className={`is-${round.status}`}>
              <div className="follow-up-round-head">
                <strong>
                  第 {number} 輪
                  {round.adopted
                    ? " · 接續 GitHub 上的提交"
                    : round.kind === "sync"
                      ? " · 同步目標分支"
                      : ""}
                </strong>
                <span className="follow-up-status">{statusLabels[round.status]}</span>
                <time dateTime={round.requestedAt}>
                  {new Date(round.requestedAt).toLocaleString("zh-TW")}
                </time>
              </div>
              {!!round.feedbackUrls.length && (
                <ul className="follow-up-feedback">
                  {round.feedbackUrls.map((url) => (
                    <li key={url}>
                      <a href={url} target="_blank" rel="noreferrer">
                        {label(url)} <ExternalLink size={11} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {round.note && <p className="follow-up-note">補充說明：{round.note}</p>}
              {round.error && (
                <p className="follow-up-error" role="status">
                  {round.error}
                </p>
              )}
              {round.report && <p className="follow-up-report">{round.report}</p>}
              {!!round.conflicts?.length && (
                <div className="follow-up-list is-open">
                  <strong>合併衝突</strong>
                  <ul>
                    {round.conflicts.map((file) => (
                      <li key={file}>
                        <code>{file}</code>{" "}
                        {round.resolutions?.find((entry) => entry.path === file)
                          ?.resolution ?? ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!round.addressed?.length && (
                <div className="follow-up-list">
                  <strong>已處理</strong>
                  <ul>
                    {round.addressed.map((item, index) => (
                      <li key={`${item.url}-${index}`}>
                        <span>{label(item.url)}</span>
                        {item.change}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!round.notAddressed?.length && (
                <div className="follow-up-list is-open">
                  <strong>沒有修改，需要你判斷</strong>
                  <ul>
                    {round.notAddressed.map((item, index) => (
                      <li key={`${item.url}-${index}`}>
                        <span>{label(item.url)}</span>
                        {item.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!round.checks?.length && (
                <div className="follow-up-list">
                  <strong>實際執行的指令</strong>
                  <ul>
                    {round.checks.map((check, index) => (
                      <li key={`${check.command}-${index}`}>
                        <code>{check.command}</code> {check.outcome}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {round.commit && (
                <p className="follow-up-commit">
                  <GitCommitHorizontal size={14} />
                  {headRepository ? (
                    <a
                      href={`https://github.com/${headRepository}/commit/${round.commit}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {round.commit.slice(0, 7)}
                    </a>
                  ) : (
                    <code>{round.commit.slice(0, 7)}</code>
                  )}
                  {round.publishedAt
                    ? ` 已推送 ${new Date(round.publishedAt).toLocaleString("zh-TW")}`
                    : " 已建立，尚未確認推送"}
                </p>
              )}
              {/* With a commit, the server checks GitHub before allowing it. */}
              {round.status === "review" && onDiscard && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={onDiscard}
                >
                  <Undo2 size={14} /> 放棄這輪修改
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
