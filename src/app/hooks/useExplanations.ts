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

interface ExplanationsOptions {
  run: Run;
  demo: boolean;
  active: boolean;
  files: DiffFile[];
  /** The open run's id, read after awaits to drop answers for another run. */
  runIdRef: RefObject<string>;
  /** Bumped by draft saves; a run read begun before a save is discarded. */
  draftMutationEpoch: RefObject<number>;
  setFiles: Dispatch<SetStateAction<DiffFile[]>>;
  setRun: Dispatch<SetStateAction<Run>>;
}

/**
 * Whether a run's explanations and walkthroughs are asked for on their
 * own: once a real run stops, and never in a Learn-by-hand run, whose
 * files are asked for one by one on a click after Ready (DESIGN v1.2 F5,
 * F10).
 */
export function asksOnItsOwn(run: Pick<Run, "learnByHand">, demo: boolean, active: boolean) {
  return !demo && !active && !run.learnByHand;
}

/**
 * Loads the plain-language explanations of the open run's changed files:
 * on its own once the run stops, and again when the reader retries a file.
 */
export function useExplanations({
  run,
  demo,
  active,
  files,
  runIdRef,
  draftMutationEpoch,
  setFiles,
  setRun,
}: ExplanationsOptions) {
  const pendingExplanations = useRef(new Set<string>());
  const [explanationRequests, setExplanationRequests] = useState<Set<string>>(
    new Set(),
  );
  const filesRef = useRef(files);
  filesRef.current = files;
  const prepareExplanations = useCallback(
    async (id: string, retry = false, filePath?: string) => {
      if (pendingExplanations.current.has(id)) return;
      const epoch = draftMutationEpoch.current;
      pendingExplanations.current.add(id);
      setExplanationRequests((previous) => new Set(previous).add(id));
      const requested = new Map(
        filesRef.current
          .filter(
            (value) =>
              !value.blocked &&
              (!filePath || value.path === filePath) &&
              (retry || !value.explanation?.example),
          )
          .map((value) => [value.path, value.fingerprint]),
      );
      if (runIdRef.current === id)
        setFiles((previous) =>
          previous.map((value) =>
            requested.has(value.path) &&
            requested.get(value.path) === value.fingerprint &&
            (retry ||
              value.explanationStatus === "pending" ||
              value.explanationStatus === "generating" ||
              !value.explanationStatus)
              ? {
                  ...value,
                  explanationStatus: "generating",
                  explanationError: undefined,
                }
              : value,
          ),
        );
      try {
        const result = await api<{ files: DiffFile[]; run: Run }>(
          `/runs/${id}/explanations`,
          send("POST", { retry, filePath }),
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
              requested.has(value.path) &&
              requested.get(value.path) === value.fingerprint &&
              value.explanationStatus === "generating"
                ? {
                    ...value,
                    explanationStatus: "failed",
                    explanationError: (error as Error).message,
                  }
                : value,
            ),
          );
      } finally {
        pendingExplanations.current.delete(id);
        setExplanationRequests((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }
    },
    // Refs and state setters never change; listed for the hooks lint rule.
    [draftMutationEpoch, runIdRef, setFiles, setRun],
  );

  const { learnByHand } = run;
  useEffect(() => {
    if (
      !asksOnItsOwn({ learnByHand }, demo, active) ||
      !files.some(
        (value) =>
          !value.blocked &&
          !value.explanation?.example &&
          (!value.explanationStatus ||
            value.explanationStatus === "pending" ||
            value.explanationStatus === "generating"),
      )
    )
      return;
    void prepareExplanations(run.id);
  }, [run.id, learnByHand, demo, active, files, prepareExplanations]);
  return { explanationRequests, prepareExplanations };
}
