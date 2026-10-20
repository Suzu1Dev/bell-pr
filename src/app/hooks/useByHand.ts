import { useEffect, useRef, useState, type RefObject } from "react";
import { readyNow, type ByHandCheckInInput } from "../../../shared/by-hand";
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

/** Focuses what `find` returns once it is on screen (a lazy view mounts a render or two later); gives up after 2 s. */
export function focusWhenShown(find: () => HTMLElement | null | undefined, tries = 40) {
  const target = find();
  if (target) target.focus();
  else if (tries > 0) setTimeout(() => focusWhenShown(find, tries - 1), 50);
}

/** The repeated-failure check-ins this tab sent, by run, step and last failing test run. */
const repeatsSent = new Set<string>();

/**
 * Whether a repeated-failure check-in is still to be sent (DESIGN v1.2 F6):
 * once per step and failing test run. Not again when its card mounts once
 * more (another tab and back), nor after a reload, where the run's own
 * check-ins already hold one for the step since that test run.
 */
export function repeatCheckInDue(run: Pick<Run, "id" | "byHand">, stepId?: string) {
  const record = run.byHand ?? {};
  const last = Math.max(0, ...(record.tests ?? []).filter((test) => !test.reported).map((test) => Date.parse(test.at)));
  const key = `${run.id}:${stepId ?? ""}:${last}`;
  const recorded = (record.checkIns ?? []).some((entry) => entry.signal === "repeat-failure" && entry.stepId === stepId && Date.parse(entry.at) >= last);
  if (recorded || repeatsSent.has(key)) return false;
  repeatsSent.add(key);
  return true;
}

/**
 * A Learn-by-hand run in the workspace (DESIGN v1.2 F3-F6, F9, F5): its
 * requests, each showing the server's message when refused, the Ready
 * dialog, and, while the run is in review, one read of the run and its
 * diff 2 s after the window comes back (no polling; it never asks for an
 * explanation or a walkthrough). The views themselves load lazily.
 */
export function useByHand(
  run: Run,
  files: DiffFile[],
  { demo, repo, actions, handBack, draftMutationEpoch, requesting = false }: {
    demo: boolean;
    /** This tab asks for an explanation or a walkthrough of the run right now. */
    requesting?: boolean;
    repo?: Repo;
    /** Bumped by draft saves and by these requests' answers; a read begun before one keeps the newer run. */
    draftMutationEpoch: RefObject<number>;
    actions: Pick<RunActions, "setRun" | "setFiles" | "approveTeamPlan">;
    /** Opens the task dialog with this run's task, for the agent team. */
    handBack(): void;
  },
) {
  const id = run.id;
  const byHand = !!run.learnByHand && !demo;
  const ready = byHand && readyNow(run, files.map(({ path, fingerprint }) => ({ path, fingerprint: fingerprint ?? "" })));
  const open = byHand && run.status === "review" && !run.publishing;
  // A refusal shows in the view that asked (the plan, the guide or the Ready dialog), never in another.
  const [state, setState] = useState({ busy: false, error: "", from: "" });
  const [readyOpen, setReadyOpen] = useState(false);
  const [selection, setSelection] = useState<GuideSelection>();
  const shown = useRef(id);
  shown.current = id;
  useEffect(() => {
    setState({ busy: false, error: "", from: "" });
    setSelection(undefined);
    setReadyOpen(false);
  }, [id]);
  /** A request of this run's, from a view; a refusal shows the server's message there and rejects. */
  const attempt = async (from: string, request: () => Promise<{ run?: Run } | void>, then?: () => void) => {
    setState({ busy: true, error: "", from });
    try {
      const result = await request();
      // A read begun before this answer (back from the editor, a poll) mustn't bring the older run back.
      if (result?.run && shown.current === id) {
        actions.setRun(result.run);
        draftMutationEpoch.current++;
      }
      setState({ busy: false, error: "", from });
      then?.();
    } catch (cause) {
      setState({ busy: false, error: shown.current === id ? (cause as Error).message : "", from });
      throw cause;
    }
  };
  const call = (path: string, method = "POST", then?: () => void) => (body?: unknown) =>
    // While the Ready dialog is open (modal), its own requests (Mark it ready, the Tests card) answer in it.
    attempt(path === "ready" || readyOpen ? "ready" : path.startsWith("plan") ? "plan" : "guide",
      () => api<{ run?: Run }>(path.startsWith("/") ? path : `${runPath(id)}/by-hand/${path}`, send(method, body)), then);

  // Back from the editor: one read of the diff and the run (an explanation
  // asked for meanwhile shows when it is ready), 2 s after the last focus or
  // visibility change, never two at once (DESIGN v1.2 F4).
  const reading = useRef(false);
  const { setFiles, setRun } = actions;
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const back = () => {
      if (document.visibilityState === "hidden") return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (reading.current) return;
        reading.current = true;
        const epoch = draftMutationEpoch.current;
        Promise.all([readRunFiles(id), api<{ run: Run }>(runPath(id))])
          .then(([next, current]) => {
            if (shown.current !== id) return;
            setFiles(next);
            if (epoch === draftMutationEpoch.current) setRun(current.run);
          })
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
  }, [id, open, setFiles, setRun, draftMutationEpoch]);

  // An explanation or a walkthrough asked for before a reload is still written: read the diff
  // (a GET, never a request for one) every 3 s until it settles, unless this tab asks itself.
  const generating = byHand && !requesting && files.some((file) => file.explanationStatus === "generating" || file.walkthroughStatus === "generating");
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => {
      if (reading.current) return;
      reading.current = true;
      readRunFiles(id).then((next) => shown.current === id && setFiles(next), () => undefined).finally(() => (reading.current = false));
    }, 3000);
    return () => clearInterval(timer);
  }, [id, generating, setFiles]);

  // A test run can write new files, which change the version: read the diff once it ends.
  const testing = byHand && run.byHand?.busy?.kind === "tests";
  const tested = useRef(testing);
  useEffect(() => {
    if (tested.current && !testing) readRunFiles(id).then((next) => shown.current === id && setFiles(next), () => undefined);
    tested.current = testing;
  }, [id, testing, setFiles]);

  const view = (from: string) => ({ busy: state.busy, error: state.from === from ? state.error : "" });
  const tests = {
    onConfirmTestCommand: (command: string) => call(`/repos/${encodeURIComponent(run.repoId)}/test-command`, "PUT")({ command }),
    onRunTests: call("tests"),
    onStopTests: call("tests/stop"),
    onReportTests: call("tests/report"),
  };
  return {
    /** The person writes: an LBH run in review whose change isn't the version marked ready. */
    writing: open && !ready,
    ready,
    readyOpen,
    openReady: () => (setState((now) => (now.from === "ready" ? { ...now, error: "" } : now)), setReadyOpen(true)),
    closeReady: () => setReadyOpen(false),
    /** A diff selection's Ask prefills the guide's question. */
    ask: (file: DiffFile, question: string) => setSelection(selectionOf(file, question)),
    plan: {
      ...view("plan"),
      /** The person writes, so the plan's steps can still change (also after a Ready, once edited). */
      writing: open && !ready,
      onSave: call("plan", "PUT"),
      onReveal: (mode: "names" | "compare") => call("plan/reveal")({ mode }),
      onAskQuestions: call("plan/questions"),
      // A refused "This is my plan" shows in the plan, not as a toast.
      onConfirm: () => attempt("plan", () => actions.approveTeamPlan(true)),
    },
    guide: {
      ...view("guide"),
      selection,
      issueUrl: run.contributionSettings?.issueUrl,
      channels: repo?.contributionRules?.channels,
      onGuide: call("guide", "POST", () => setSelection(undefined)),
      onStep: (stepId: string, input: object) => call(`steps/${encodeURIComponent(stepId)}`, "PATCH")(input),
      onCheckIn: (input: ByHandCheckInInput) =>
        input.signal === "repeat-failure" && !repeatCheckInDue(run, input.stepId) ? Promise.resolve() : call("check-ins")(input),
      ...tests,
      onLeave: call("leave", "POST", handBack),
    },
    readyDialog: {
      ...view("ready"),
      tests,
      onReady: call("ready", "POST", () => setReadyOpen(false)),
      // A rule about AI (a ban, disclosure, reserved area or one addressed to agents, or one whose words name AI) asks for care before an AI review.
      aiRules: (repo?.contributionRules?.findings ?? []).some((finding) => ["ban", "disclose", "area", "agent"].includes(finding.kind) || /\b(?:AI|LLMs?|GPT|Copilot)\b|artificial intelligence|language model/i.test(finding.quote)),
    },
  };
}

export type ByHand = ReturnType<typeof useByHand>;
