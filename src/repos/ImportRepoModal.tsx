import type { Dispatch, FormEvent, SetStateAction } from "react";
import { ArrowDownToLine, FolderGit2, Github, Loader2 } from "lucide-react";
import { Modal } from "../modals/Modal";

interface ImportRepoModalProps {
  /** GitHub URL or local path typed so far. */
  source: string;
  setSource: Dispatch<SetStateAction<string>>;
  busy: boolean;
  formError: string;
  importRepo: (event: FormEvent) => void;
  closeModal: () => void;
}

/** Imports a GitHub repository or a local Git project. */
export function ImportRepoModal({
  source,
  setSource,
  busy,
  formError,
  importRepo,
  closeModal,
}: ImportRepoModalProps) {
  return (
    <Modal
      title="帶入你的下一個貢獻。"
      subtitle="貼上 GitHub 連結，或選擇本機 Git 專案的完整路徑。"
      onClose={closeModal}
    >
      <form onSubmit={importRepo}>
        <label className="field-label" htmlFor="repo-source">
          Repository 來源
        </label>
        <div className="input-with-icon">
          <Github size={18} />
          <input
            id="repo-source"
            className="text-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="https://github.com/owner/repository"
            required
            autoComplete="off"
          />
        </div>
        <p className="field-help">
          也支援 /Users/你的名稱/projects/repository
        </p>
        <div className="callout">
          <FolderGit2 size={18} />
          <p>
            GitHub 專案會下載至本機；後續開發使用獨立
            worktree，保留原專案狀態。
          </p>
        </div>
        {formError && (
          <p role="alert" className="inline-error">
            {formError}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={closeModal}
          >
            稍後再說
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !source.trim()}
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <ArrowDownToLine size={16} />
            )}{" "}
            {busy ? "正在匯入…" : "匯入 Repository"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
