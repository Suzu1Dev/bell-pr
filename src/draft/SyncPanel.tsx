import { GitMerge, LoaderCircle, Undo2, Wand2 } from "lucide-react";
import { activeFollowUp } from "../../shared/followups";
import type { Run } from "../types";

interface Props {
  run: Run;
  /** A request of this page is in flight. */
  busy: boolean;
  onSync: () => void;
  onResolve: () => void;
  onUndo: () => void;
}

const short = (commit?: string) => commit?.slice(0, 7) ?? "";

/**
 * Where the contribution stands against its target branch, and the way to
 * catch up: an unpublished run moves onto the latest base, a published PR
 * takes it in as a reviewed merge commit. Conflicts are listed until the
 * files no longer hold markers, which the server checks before approval.
 */
export function SyncPanel({ run, busy, onSync, onResolve, onUndo }: Props) {
  const published = !!run.prUrl;
  const round = activeFollowUp(run.followUps);
  const syncRound = round?.kind === "sync" ? round : undefined;
  const holder = published ? syncRound : run.sync;
  const conflicts = holder?.conflicts ?? [];
  // Read by the server whenever the diff is; until then every conflict is open.
  const open = holder?.unresolved ?? conflicts;
  // Only the conflict agent; a run's team can also be running after a sync.
  const running = !!holder?.resolving;
  const syncable = ["review", "approved", "awaiting_plan"].includes(run.status);
  const canSync =
    !busy &&
    !run.publishing &&
    (published
      ? run.status === "published" && !round
      : // The server refuses a new sync while the last one's conflicts are open.
        syncable && !open.length);
  // Why an unpublished run cannot sync, unless the conflict agent is at work.
  const waitNote =
    published || running
      ? ""
      : open.length
        ? "上一次同步的衝突解決前不能再同步。"
        : syncable
          ? ""
          : "只有審閱中、已核准或等待計畫核准的工作可以同步到最新目標分支。";
  const canUndo =
    !published &&
    !!run.sync &&
    !busy &&
    ["review", "approved", "awaiting_plan"].includes(run.status);
  const canResolve =
    open.length > 0 && !busy && ["review", "approved"].includes(run.status);
  return (
    <section className="sync-panel" aria-labelledby="sync-panel-title">
      <div className="sync-panel-head">
        <div>
          <h2 id="sync-panel-title">目標分支</h2>
          <p>
            這個貢獻以 <code>{run.baseBranch}</code> 的{" "}
            <code>{short(run.baseSha)}</code> 為基準。
            {published
              ? "同步會把最新版本合併進 PR：審閱後推送一個合併 commit，不會 force push，PR 說明也不變。"
              : "同步會把這次的修改移到最新版本上；目標分支改過的檔案需要重新審閱，可以復原。"}
          </p>
          {!published && run.sync && (
            <p className="sync-panel-meta">
              上次同步：<code>{short(run.sync.from)}</code> 到{" "}
              <code>{short(run.sync.to)}</code>，
              {new Date(run.sync.at).toLocaleString("zh-TW")}
            </p>
          )}
          {waitNote && <p className="sync-panel-meta">{waitNote}</p>}
          {published && round && !syncRound && (
            <p className="sync-panel-meta">
              這個 PR 有一輪修正在進行；完成或放棄後才能同步。
            </p>
          )}
        </div>
        <div className="sync-panel-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onSync}
            disabled={!canSync}
          >
            <GitMerge size={15} /> 同步到最新目標分支
          </button>
          {canUndo && (
            <button type="button" className="button secondary" onClick={onUndo}>
              <Undo2 size={15} /> 復原同步
            </button>
          )}
        </div>
      </div>
      {conflicts.length > 0 && (
        <div className="sync-conflicts" role="status">
          <strong>合併衝突</strong>
          <ul>
            {conflicts.map((file) => (
              <li key={file}>
                <code>{file}</code>
                {!open.includes(file) && " · 已解決"}
              </li>
            ))}
          </ul>
          {open.length ? (
            <p>
              檔案裡標示 <code>latest {run.baseBranch}</code>{" "}
              的一邊是目標分支現在的內容，標示{" "}
              <code>{published ? "this pull request" : "this contribution"}</code>{" "}
              的一邊是{published ? "這個 PR" : "這次的貢獻"}
              。衝突標記全部移除前不能核准；可以在工作目錄自己改，改完到「程式碼變更」重新整理差異，或請
              Agent 解決。改過的檔案仍要逐檔審閱。
            </p>
          ) : (
            <p>衝突標記都已移除；改過的檔案仍要逐檔審閱。</p>
          )}
          {holder?.report && <p className="sync-report">{holder.report}</p>}
          {!!holder?.resolutions?.length && (
            <ul className="sync-resolutions">
              {holder.resolutions.map((entry) => (
                <li key={entry.path}>
                  <code>{entry.path}</code> {entry.resolution}
                </li>
              ))}
            </ul>
          )}
          {(open.length > 0 || running) && (
            <button
              type="button"
              className="button primary"
              onClick={onResolve}
              disabled={!canResolve || running}
            >
              {running ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Wand2 size={15} />
              )}
              {running ? "Agent 正在解衝突…" : "請 Agent 解決衝突"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
