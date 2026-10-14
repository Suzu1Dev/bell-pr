import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { ArrowDownToLine, FolderGit2, GitBranch, Loader2 } from "lucide-react";
import { getDemo } from "../demo";
import { createDemoPlayback, type DemoPlayback } from "../demo/playback";
import { useLocale, useT } from "../i18n";
import { Modal } from "../modals/Modal";
import type { Repo } from "../types";

/** An example path to a Git project on this kind of computer. */
export function examplePath(platform: string): string {
  if (/^Mac|iPhone|iPad|iPod/i.test(platform)) return "/Users/you/projects/repository";
  if (/^Win/i.test(platform)) return "C:\\Users\\you\\projects\\repository";
  return "/home/you/projects/repository";
}

/**
 * Whether `input` names the sample repository: its `owner/name` or its
 * GitHub address, in any case, with or without `.git` or a final slash.
 */
export function namesSample(input: string, fullName: string): boolean {
  const name = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "")
    .replace(/(?:\.git)?\/*$/i, "");
  return name.toLowerCase() === fullName.toLowerCase();
}

interface ImportRepoModalProps {
  /** GitHub URL or local path typed so far. */
  source: string;
  setSource: Dispatch<SetStateAction<string>>;
  busy: boolean;
  formError: string;
  importRepo: (event: FormEvent) => void;
  closeModal: () => void;
  /** demo=play: every import plays the sample's import instead. */
  playDemo?: boolean;
  /** The playback speed (speed=1..4). */
  speed?: number;
  /** The sample was imported in the browser; the caller lists and opens it. */
  onSampleImported?: (repo: Repo) => void;
}

/**
 * Imports a GitHub repository (a link or `owner/repo`) or a local Git
 * project. The sample repository, or any source while `demo=play` is set,
 * plays its import from the demo playback instead and never reaches the
 * server.
 */
export function ImportRepoModal({
  source,
  setSource,
  busy,
  formError,
  importRepo,
  closeModal,
  playDemo = false,
  speed,
  onSampleImported,
}: ImportRepoModalProps) {
  const t = useT("repos").import;
  const [locale] = useLocale();
  const demo = getDemo(locale);
  const [progress, setProgress] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const playback = useRef<DemoPlayback | undefined>(undefined);
  useEffect(() => () => playback.current?.stop(), []);
  const working = busy || playing;

  const submit = (event: FormEvent) => {
    if (!onSampleImported || !(playDemo || namesSample(source, demo.repo.fullName))) {
      importRepo(event);
      return;
    }
    event.preventDefault();
    playback.current?.stop();
    const player = createDemoPlayback({ demo, speed });
    playback.current = player;
    setProgress([]);
    setPlaying(true);
    const unsubscribe = player.subscribe((update) => {
      if (update.kind === "import" && update.phase !== "ready")
        setProgress((lines) => [...lines, update.line]);
    });
    void player.importSample(source.trim()).then((repo) => {
      unsubscribe();
      if (playback.current !== player) return;
      setPlaying(false);
      if (repo) onSampleImported(repo);
    });
  };

  return (
    <Modal
      title={t.title}
      subtitle={t.subtitle}
      onClose={closeModal}
    >
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="repo-source">
          {t.source}
        </label>
        <div className="input-with-icon">
          <GitBranch size={18} aria-hidden="true" />
          <input
            id="repo-source"
            className="text-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t.placeholder}
            aria-describedby="repo-source-hint"
            readOnly={playing}
            required
            autoComplete="off"
          />
        </div>
        <p className="field-help" id="repo-source-hint">
          {t.localPathHint({ example: examplePath(navigator.platform) })}
        </p>
        <div className="callout">
          <FolderGit2 size={18} aria-hidden="true" />
          <p>{t.callout}</p>
        </div>
        {busy && (
          <p className="field-help import-cloning" role="status">
            {t.cloning}
          </p>
        )}
        {progress.length > 0 && (
          <ol className="import-progress" aria-label={t.sampleProgress} aria-live="polite">
            {progress.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
        )}
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
            disabled={working || !source.trim()}
          >
            {working ? (
              <Loader2 size={16} className="spin" aria-hidden="true" />
            ) : (
              <ArrowDownToLine size={16} aria-hidden="true" />
            )}{" "}
            {working ? t.importing : t.import}
          </button>
        </div>
      </form>
    </Modal>
  );
}
