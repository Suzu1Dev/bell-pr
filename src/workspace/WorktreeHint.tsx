import { Copy, FolderGit2 } from "lucide-react";
import { useT } from "../i18n";

/**
 * Where the run's checkout is, for editing files by hand. While presenting
 * the path loses its folders (maskPath) and cannot be copied.
 */
export function WorktreeHint({
  path,
  presenting,
  maskPath,
  onCopy,
}: {
  path: string;
  presenting: boolean;
  maskPath: (path: string) => string;
  onCopy: () => void;
}) {
  const t = useT("workspace").changes;
  // The editing hint is the tooltip; screen readers read it with the path.
  return (
    <div className="worktree-hint" title={t.worktreeHint}>
      <FolderGit2 size={14} aria-hidden="true" />
      <span>{t.worktreeLabel}</span>
      <span className="visually-hidden">{t.worktreeHint}</span>
      <code>
        <span>{maskPath(path)}</span>
      </code>
      {!presenting && (
        <button
          type="button"
          className="icon-button"
          aria-label={t.copyWorktree}
          title={t.copyWorktree}
          onClick={onCopy}
        >
          <Copy size={13} />
        </button>
      )}
    </div>
  );
}
