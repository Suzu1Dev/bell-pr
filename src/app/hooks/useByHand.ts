import { useEffect, useRef, useState } from "react";
import { readyNow } from "../../../shared/by-hand";
import { api, send } from "../../api";
import { parseDiff } from "../../review/diff";
import type { DiffFile, Repo, Run } from "../../types";
import { readRunFiles, runPath, type RunActions } from "./useRunActions";

/** A diff selection as the guide's question names it: `path:start-end` (0 when unknown). */
export type GuideSelection = { path: string; startLine: number; endLine: number };

/**
 * The lines a diff selection's question quotes (selectionQuestion in
 * src/review/diff.ts), found in the file's patch by their text: the new
 * file's numbers, or the old one's for removed lines only.
 */
export function selectionOf(file: DiffFile, question: string): GuideSelection {
  const body = /(`{3,})diff\n([\s\S]*?)\n\1/.exec(question)?.[2].split("\n") ?? [];
  const lines = parseDiff(file.patch);
  const sign: Record<string, string> = { added: "+", removed: "-", context: " " };
  const at = lines.findIndex((_, start) =>
    body.length > 0 && body.every((text, index) => `${sign[lines[start + index]?.kind] ?? "?"}${lines[start + index]?.text}` === text),
  );
  const picked = at < 0 ? [] : lines.slice(at, at + body.length);
  const added = picked.flatMap((line) => (line.newLine === null ? [] : [line.newLine]));
  const range = added.length ? added : picked.flatMap((line) => (line.oldLine === null ? [] : [line.oldLine]));
  return { path: file.path, startLine: range.length ? Math.min(...range) : 0, endLine: range.length ? Math.max(...range) : 0 };
}

/**
 * A Learn-by-hand run in the workspace (DESIGN v1.2 F3-F6, F9, F5): its
 * requests, each showing the server's message when refused, the Ready
 * dialog, and, while the person writes, one diff read 2 s after the window
 * comes back (no polling). The views themselves load lazily.
 */
export function useByHand(
  run: Run,
  files: DiffFile[],
  { demo, repo, actions, handBack }: {
    demo: boolean;
    repo?: Repo;
    actions: Pick<RunActions, "setRun" | "setFiles" | "approveTeamPlan">;
    /** Opens the task dialog with this run's task, for the agent team. */
    handBack(): void;
  },
) {
  const id = run.id;
  const byHand = !!run.learnByHand && !demo;
  const ready = byHand && readyNow(run, files.map(({ path, fingerprint }) => ({ path, fingerprint: fingerprint ?? "" })));
  const open = byHand && run.status === "review" && !run.publishing;
  const [state, setState] = useState({ busy: false, error: "" });
  const [readyOpen, setReadyOpen] = useState(false);
  const [selection, setSelection] = useState<GuideSelection>();
  const shown = useRef(id);
  shown.current = id;
  useEffect(() => {
    setState({ busy: false, error: "" });
    setSelection(undefined);
    setReadyOpen(false);
  }, [id]);
  /** A request of this run's; a refusal shows the server's message and rejects. */
  const call = (path: string, method = "POST", then?: () => void) => async (body?: unknown) => {
    setState({ busy: true, error: "" });
    try {
      const result = await api<{ run?: Run }>(path.startsWith("/") ? path : `${runPath(id)}/by-hand/${path}`, send(method, body));
      if (result.run && shown.current === id) actions.setRun(result.run);
      setState({ busy: false, error: "" });
      then?.();
    } catch (cause) {
      setState({ busy: false, error: shown.current === id ? (cause as Error).message : "" });
      throw cause;
    }
  };

  // Back from the editor: one diff read, 2 s after the last focus or
  // visibility change, never two at once (DESIGN v1.2 F4).
  const reading = useRef(false);
  const { setFiles } = actions;
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const back = () => {
      if (document.visibilityState === "hidden") return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (reading.current) return;
        reading.current = true;
        readRunFiles(id)
          .then((next) => shown.current === id && setFiles(next))
          // The next return, or Refresh, reads it again.
          .catch(() => undefined)
          .finally(() => (reading.current = false));
      }, 2000);
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [id, open, setFiles]);

  return {
    /** The person writes: an LBH run in review whose change isn't the version marked ready. */
    writing: open && !ready,
    ready,
    readyOpen,
    openReady: () => setReadyOpen(true),
    closeReady: () => setReadyOpen(false),
    /** A diff selection's Ask prefills the guide's question. */
    ask: (file: DiffFile, question: string) => setSelection(selectionOf(file, question)),
    plan: {
      ...state,
      onSave: call("plan", "PUT"),
      onReveal: (mode: "names" | "compare") => call("plan/reveal")({ mode }),
      onAskQuestions: call("plan/questions"),
      onConfirm: actions.approveTeamPlan,
    },
    guide: {
      ...state,
      selection,
      issueUrl: run.contributionSettings?.issueUrl,
      onGuide: call("guide", "POST", () => setSelection(undefined)),
      onStep: (stepId: string, input: object) => call(`steps/${encodeURIComponent(stepId)}`, "PATCH")(input),
      onCheckIn: call("check-ins"),
      onConfirmTestCommand: (command: string) => call(`/repos/${encodeURIComponent(run.repoId)}/test-command`, "PUT")({ command }),
      onRunTests: call("tests"),
      onStopTests: call("tests/stop"),
      onReportTests: call("tests/report"),
      onLeave: call("leave", "POST", handBack),
    },
    readyDialog: {
      ...state,
      onReady: call("ready", "POST", () => setReadyOpen(false)),
      // Any AI rule but "open an issue first" asks for care before an AI review.
      aiRules: (repo?.contributionRules?.findings ?? []).some((finding) => finding.kind !== "issue-first"),
    },
  };
}

export type ByHand = ReturnType<typeof useByHand>;
