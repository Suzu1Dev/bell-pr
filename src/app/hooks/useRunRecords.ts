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

type TagChoice = Omit<FeedbackTag, "at">;

/**
 * The PATCH body for one comment's tags. The route merges field by field
 * and keeps a field the body leaves out, so every chip and the lesson are
 * sent, an unset one as null; a tag with nothing left is removed.
 */
export function feedbackTagPatch(url: string, tag: TagChoice) {
  return {
    url,
    dimension: tag.dimension ?? null,
    predicted: tag.predicted ?? null,
    lesson: tag.lesson?.trim() || null,
  };
}

/** The sample's tags after one change, removed once nothing is left, as the server does. */
export function withFeedbackTag(
  tags: Run["feedbackTags"],
  url: string,
  tag: TagChoice,
  at: string,
): NonNullable<Run["feedbackTags"]> {
  const rest = { ...tags };
  delete rest[url];
  const lesson = tag.lesson?.trim();
  const next: FeedbackTag = {
    ...(tag.dimension ? { dimension: tag.dimension } : {}),
    ...(tag.predicted !== undefined ? { predicted: tag.predicted } : {}),
    ...(lesson ? { lesson } : {}),
    at,
  };
  return next.dimension || next.predicted !== undefined || next.lesson
    ? { ...rest, [url]: next }
    : rest;
}

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

  async function request(path: string, method: string, body: unknown) {
    const { run: updated } = await api<{ run: Run }>(
      `/runs/${encodeURIComponent(run.id)}${path}`,
      send(method, body),
    );
    if (openRun.current === updated.id) setRun(updated);
  }
  async function save(path: string, method: string, body: unknown) {
    try {
      await request(path, method, body);
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
    saveFeedbackTag(url: string, tag: TagChoice) {
      if (demo) {
        const at = new Date().toISOString();
        keep((previous) => ({
          feedbackTags: withFeedbackTag(previous.feedbackTags, url, tag, at),
        }));
        return;
      }
      void save("/feedback-tags", "PATCH", feedbackTagPatch(url, tag));
    },
    /**
     * One line per weakened-test item (PUT /api/runs/:id/test-reasons); ""
     * removes an item's reason. The card shows a failure itself.
     */
    saveTestReasons(reasons: Record<string, string>): Promise<void> {
      if (demo) {
        const kept = Object.fromEntries(
          Object.entries(reasons).filter(([, reason]) => reason.trim()),
        );
        keep((previous) => ({
          reviewability: { ...previous.reviewability, testReasons: kept },
        }));
        return Promise.resolve();
      }
      return request("/test-reasons", "PUT", { reasons });
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
