import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { api, send } from "../../api";
import type { DiffFile, Run } from "../../types";

interface WalkthroughsOptions {
  run: Run;
  demo: boolean;
  active: boolean;
  files: DiffFile[];
  /** The file open in the code view; its walkthrough is prepared first. */
  selectedPath: string;
  /** The open run's id, read after awaits to drop answers for another run. */
  runIdRef: RefObject<string>;
  /** Bumped by draft saves; a run read begun before a save is discarded. */
  draftMutationEpoch: RefObject<number>;
  setFiles: Dispatch<SetStateAction<DiffFile[]>>;
  setRun: Dispatch<SetStateAction<Run>>;
}

export interface Walkthroughs {
  /** True while a walkthrough request is on its way; only one runs at a time. */
  walkthroughBusy: boolean;
  /** Asks for one file's walkthrough; `retry` makes a failed one again. */
  requestWalkthrough: (
    id: string,
    filePath: string,
    retry?: boolean,
  ) => Promise<void>;
}

/**
 * Prepares the code walkthroughs of the open run's changed files once the
 * run stops: one file at a time (each is a full agent turn), the file being
 * read first, and again when the reader retries one. The sample's are
 * prewritten.
 */
export function useWalkthroughs({
  run,
  demo,
  active,
  files,
  selectedPath,
  runIdRef,
  draftMutationEpoch,
  setFiles,
  setRun,
}: WalkthroughsOptions): Walkthroughs {
  const pending = useRef(false);
  const [walkthroughBusy, setWalkthroughBusy] = useState(false);
  const requestWalkthrough = useCallback(
    async (id: string, filePath: string, retry = false) => {
      if (pending.current) return;
      pending.current = true;
      setWalkthroughBusy(true);
      const epoch = draftMutationEpoch.current;
      if (runIdRef.current === id)
        setFiles((previous) =>
          previous.map((value) =>
            value.path === filePath
              ? { ...value, walkthroughStatus: "generating", walkthroughError: undefined }
              : value,
          ),
        );
      try {
        const result = await api<{ files: DiffFile[]; run: Run }>(
          `/runs/${encodeURIComponent(id)}/walkthroughs`,
          send("POST", { filePath, retry }),
        );
        if (runIdRef.current !== id) return;
        setFiles(result.files);
        setRun((previous) =>
          epoch === draftMutationEpoch.current ? result.run : previous,
        );
      } catch (error) {
        if (runIdRef.current === id)
          setFiles((previous) =>
            previous.map((value) =>
              value.path === filePath && value.walkthroughStatus === "generating"
                ? {
                    ...value,
                    walkthroughStatus: "failed",
                    walkthroughError: (error as Error).message,
                  }
                : value,
            ),
          );
      } finally {
        pending.current = false;
        setWalkthroughBusy(false);
      }
    },
    // Refs and state setters never change; listed for the hooks lint rule.
    [draftMutationEpoch, runIdRef, setFiles, setRun],
  );

  useEffect(() => {
    if (demo || active || walkthroughBusy) return;
    const waiting = files.filter((value) => value.walkthroughStatus === "pending");
    const next =
      waiting.find((value) => value.path === selectedPath) ?? waiting[0];
    if (next) void requestWalkthrough(run.id, next.path);
  }, [run.id, demo, active, files, selectedPath, walkthroughBusy, requestWalkthrough]);

  return { walkthroughBusy, requestWalkthrough };
}
