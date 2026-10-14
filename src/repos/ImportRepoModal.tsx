import type { Dispatch, FormEvent, SetStateAction } from "react";
import { ArrowDownToLine, FolderGit2, Github, Loader2 } from "lucide-react";
import { useT } from "../i18n";
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
  const t = useT("repos").import;
  return (
    <Modal
      title={t.title}
      subtitle={t.subtitle}
      onClose={closeModal}
    >
      <form onSubmit={importRepo}>
        <label className="field-label" htmlFor="repo-source">
          {t.source}
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
        <p className="field-help">{t.localPathHint}</p>
        <div className="callout">
          <FolderGit2 size={18} />
          <p>{t.callout}</p>
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
            {t.later}
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
            {busy ? t.importing : t.import}
          </button>
        </div>
      </form>
    </Modal>
  );
}
