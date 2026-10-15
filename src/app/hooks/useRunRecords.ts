import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { api, send } from "../../api";
import { useT } from "../../i18n";
import type { FeedbackTag } from "../../../shared/understanding";
import type { DiffFile, Run } from "../../types";
import type { Notify, Tab } from "../AppShell";
import { closeCheckPanel } from "./useUnderstanding";

interface RunRecordsOptions {
  demo: boolean;
  setRun: Dispatch<SetStateAction<Run>>;
  notify: Notify;
  /** The changed file open in the code view. */
  file: DiffFile | undefined;
  /** Asks the agent about the open file (useRunActions). */
  ask: (question: string) => void;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<Tab>>;
}

/**
 * The person's own records on a run beyond the check: tags on maintainer
 * feedback, a reason for each weakened test, and asking the agent how the
 * change could be split. The sample keeps them on its run in this browser.
 */
export function useRunRecords(
  run: Run,
  files: DiffFile[],
  { demo, setRun, notify, file, ask, setSelectedPath, setTab }: RunRecordsOptions,
) {
  const t = useT("workspace").notices;
  const openRun = useRef(run.id);
  openRun.current = run.id;
  const latestAsk = useRef(ask);
  latestAsk.current = ask;
  const [pending, setPending] = useState<{ runId: string; path: string }>();
  // The preset is asked once the file it is about is open.
  useEffect(() => {
    if (!pending || pending.runId !== run.id || file?.path !== pending.path) return;
    setPending(undefined);
    latestAsk.current(t.askSplit);
  }, [pending, run.id, file?.path, t.askSplit]);

  async function save(path: string, method: string, body: unknown) {
    const id = run.id;
    try {
      const { run: updated } = await api<{ run: Run }>(
        `/runs/${encodeURIComponent(id)}${path}`,
        send(method, body),
      );
      if (openRun.current === updated.id) setRun(updated);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  const keep = (change: (previous: Run) => Partial<Run>) =>
    setRun((previous) =>
      previous.id === run.id ? { ...previous, ...change(previous) } : previous,
    );

  return {
    /** Tags one piece of maintainer feedback (PATCH /api/runs/:id/feedback-tags). */
    saveFeedbackTag(url: string, tag: Omit<FeedbackTag, "at">) {
      if (demo) {
        const at = new Date().toISOString();
        keep((previous) => ({
          feedbackTags: { ...previous.feedbackTags, [url]: { ...tag, at } },
        }));
        return;
      }
      void save("/feedback-tags", "PATCH", { url, ...tag });
    },
    /** One line per weakened-test item (PUT /api/runs/:id/test-reasons). */
    saveTestReasons(reasons: Record<string, string>) {
      if (demo) {
        keep((previous) => ({
          reviewability: { ...previous.reviewability, testReasons: reasons },
        }));
        return;
      }
      void save("/test-reasons", "PUT", { reasons });
    },
    /**
     * "How could this be split into separate changes?", asked about the
     * largest changed file in the Changes tab.
     */
    askSplit() {
      const largest = [...files].sort(
        (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
      )[0];
      if (!largest) return;
      // Asking the agent ends a closed-book check that is open.
      closeCheckPanel();
      setPending({ runId: run.id, path: largest.path });
      setSelectedPath(largest.path);
      setTab("changes");
    },
  };
}

export type RunRecords = ReturnType<typeof useRunRecords>;
