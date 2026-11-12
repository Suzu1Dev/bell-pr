/**
 * Workspace-side team collaboration hook:
 * - Zero network requests when `!participantToken()` or `demo` is true.
 * - Reports this member's live run / tab / file / line-range activity (`POST /api/collab/activity`)
 *   and polls active teammate presence + holds + dependency rules (`GET /api/collab/activity`).
 * - Provides run-level team record mutations (reviewer sign-off, developer rationales, handoff TODOs).
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type {
  CollabDependencyMode,
  CollabFileDependency,
  CollabHold,
  CollabInfo,
  CollabMemberActivity,
} from "../../shared/collab";
import { api, send } from "../api";
import type { Notify, Tab } from "../app/AppShell";
import type { DiffFile, Run } from "../types";
import { participantHeaders, participantToken } from "./participant";

export type HeldWithName = CollabHold & { holderName: string };

export interface DirectHoldHit {
  claimId: string;
  holderName: string;
  title: string;
  scope: string;
  lineStart?: number;
  lineEnd?: number;
  overlapsSelection: boolean;
}

export interface DependencyHoldHit {
  holderName: string;
  title: string;
  otherPath: string;
  mode: CollabDependencyMode;
  note?: string;
}

function fold(path: string) {
  return path.replace(/^\/+|\/+$/g, "").toLowerCase();
}

function splitHoldScope(scope: string): { path: string; lineStart?: number; lineEnd?: number } {
  const match = /^(.*?)#L(\d+)(?:-L?(\d+))?$/i.exec(scope.trim());
  if (!match) return { path: scope.trim() };
  const a = Number(match[2]);
  const b = match[3] ? Number(match[3]) : a;
  return { path: match[1], lineStart: Math.min(a, b), lineEnd: Math.max(a, b) };
}

function pathCovers(scopePath: string, targetPath: string) {
  const a = fold(scopePath);
  const b = fold(targetPath);
  return Boolean(a && b && (a === b || b.startsWith(`${a}/`) || a.startsWith(`${b}/`)));
}

/** Pure conflict & dependency calculator for a file (and optional selected line range) in the workspace. */
export function computeFileHoldNotice(
  filePath: string | undefined,
  holds: readonly HeldWithName[],
  dependencies: readonly CollabFileDependency[],
  meId?: string,
  selection?: { start: number; end: number },
): { directHolds: DirectHoldHit[]; dependencyHolds: DependencyHoldHit[] } {
  if (!filePath) return { directHolds: [], dependencyHolds: [] };
  const directHolds: DirectHoldHit[] = [];
  const dependencyHolds: DependencyHoldHit[] = [];
  const otherHolds = holds.filter((hold) => !meId || hold.holder !== meId);

  for (const hold of otherHolds) {
    for (const rawScope of hold.scopes) {
      const parsed = splitHoldScope(rawScope);
      if (pathCovers(parsed.path, filePath)) {
        const overlapsSelection =
          parsed.lineStart === undefined ||
          parsed.lineEnd === undefined ||
          (selection !== undefined &&
            selection.start <= parsed.lineEnd &&
            parsed.lineStart <= selection.end);
        directHolds.push({
          claimId: hold.claimId,
          holderName: hold.holderName,
          title: hold.title,
          scope: rawScope,
          lineStart: parsed.lineStart,
          lineEnd: parsed.lineEnd,
          overlapsSelection,
        });
      }
    }
  }

  const seenDep = new Set<string>();
  for (const dep of dependencies) {
    const matchesFrom = pathCovers(dep.from, filePath);
    const matchesTo = pathCovers(dep.to, filePath);
    if (!matchesFrom && !matchesTo) continue;
    const counterpart = matchesFrom ? dep.to : dep.from;
    for (const hold of otherHolds) {
      if (hold.scopes.some((raw) => pathCovers(splitHoldScope(raw).path, counterpart))) {
        const key = `${dep.id}:${hold.claimId}`;
        if (seenDep.has(key)) continue;
        seenDep.add(key);
        dependencyHolds.push({
          holderName: hold.holderName,
          title: hold.title,
          otherPath: counterpart,
          mode: dep.mode,
          note: dep.note,
        });
      }
    }
  }

  return { directHolds, dependencyHolds };
}

function mapTabToView(tab: Tab): CollabMemberActivity["view"] {
  if (tab === "changes") return "changes";
  if (tab === "draft") return "draft";
  return "workspace";
}

export interface TeamCollaboration {
  activeInGroup: boolean;
  me?: { id: string; name: string; admin?: boolean };
  activities: CollabMemberActivity[];
  holds: HeldWithName[];
  dependencies: CollabFileDependency[];
  reportSelection: (range?: { start: number; end: number }) => void;
  selectedRange?: { start: number; end: number };
  signOffFile: (file: DiffFile, reviewed: boolean) => Promise<void>;
  addRationale: (input: {
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    text: string;
  }) => Promise<void>;
  removeRationale: (noteId: string) => Promise<void>;
  addTodo: (input: {
    filePath?: string;
    text: string;
    assigneeName?: string;
  }) => Promise<void>;
  toggleTodo: (todoId: string, done: boolean) => Promise<void>;
  removeTodo: (todoId: string) => Promise<void>;
}

export function useTeamCollaboration({
  run,
  setRun,
  tab,
  selectedPath,
  demo,
  notify,
}: {
  run: Run;
  setRun: Dispatch<SetStateAction<Run>>;
  tab: Tab;
  selectedPath: string;
  demo: boolean;
  notify: Notify;
}): TeamCollaboration {
  const token = demo ? "" : participantToken();
  const [me, setMe] = useState<{ id: string; name: string; admin?: boolean }>();
  const [activities, setActivities] = useState<CollabMemberActivity[]>([]);
  const [holds, setHolds] = useState<HeldWithName[]>([]);
  const [dependencies, setDependencies] = useState<CollabFileDependency[]>([]);
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number }>();

  useEffect(() => {
    setSelectedRange(undefined);
  }, [run.id, selectedPath]);

  // Poll teammate presence + holds + dependency rules when joined to a group.
  useEffect(() => {
    if (!token || demo) return;
    let cancelled = false;
    const headers = participantHeaders();

    void api<CollabInfo>("/collab", { headers })
      .then((info) => {
        if (!cancelled && info.me) setMe(info.me);
      })
      .catch(() => {});

    const poll = () => {
      void api<{
        activities: CollabMemberActivity[];
        holds?: HeldWithName[];
        dependencies?: CollabFileDependency[];
      }>(`/collab/activity?repoId=${encodeURIComponent(run.repoId)}`, { headers })
        .then((res) => {
          if (cancelled) return;
          setActivities(res.activities ?? []);
          if (res.holds) setHolds(res.holds);
          if (res.dependencies) setDependencies(res.dependencies);
        })
        .catch(() => {});
    };

    poll();
    const interval = setInterval(poll, 12_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, demo, run.repoId]);

  // Debounced live activity report whenever run, tab, file or selected line range changes.
  useEffect(() => {
    if (!token || demo) return;
    const timer = setTimeout(() => {
      void api("/collab/activity", {
        ...send("POST", {
          repoId: run.repoId,
          view: mapTabToView(tab),
          runId: run.id,
          runTitle: run.title,
          runStatus: run.status,
          ...(tab === "changes" && selectedPath ? { filePath: selectedPath } : {}),
          ...(tab === "changes" && selectedRange
            ? { lineStart: selectedRange.start, lineEnd: selectedRange.end }
            : {}),
        }),
        headers: participantHeaders(),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [
    token,
    demo,
    run.repoId,
    run.id,
    run.title,
    run.status,
    tab,
    selectedPath,
    selectedRange,
  ]);

  const base = `/runs/${encodeURIComponent(run.id)}`;

  async function signOffFile(file: DiffFile, reviewed: boolean) {
    if (!file.fingerprint) return;
    if (demo) {
      const reviewerId = me?.id ?? "demo-member";
      const reviewerName = me?.name ?? "Demo Reviewer";
      setRun((prev) => {
        const current = prev.teamRecords?.fileReviews?.[file.path] ?? [];
        const filtered = current.filter((entry) => entry.reviewerId !== reviewerId);
        const nextList = reviewed
          ? [
              ...filtered,
              {
                reviewerId,
                reviewerName,
                fingerprint: file.fingerprint!,
                reviewedAt: new Date().toISOString(),
              },
            ]
          : filtered;
        const fileReviews = { ...(prev.teamRecords?.fileReviews ?? {}), [file.path]: nextList };
        if (!nextList.length) delete fileReviews[file.path];
        return {
          ...prev,
          teamRecords: { ...prev.teamRecords, fileReviews },
        };
      });
      return;
    }
    try {
      const { run: updated } = await api<{ run: Run }>(`${base}/team-review`, {
        ...send("POST", { filePath: file.path, reviewed, fingerprint: file.fingerprint }),
        headers: participantHeaders(),
      });
      setRun(updated);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }

  async function addRationale(input: {
    filePath: string;
    lineStart?: number;
    lineEnd?: number;
    text: string;
  }) {
    if (demo) {
      setRun((prev) => {
        const rationales = [
          ...(prev.teamRecords?.rationales ?? []),
          {
            id: `demo-note-${Date.now()}`,
            filePath: input.filePath,
            ...(input.lineStart !== undefined ? { lineStart: input.lineStart } : {}),
            ...(input.lineEnd !== undefined ? { lineEnd: input.lineEnd } : {}),
            authorId: me?.id ?? "demo-member",
            authorName: me?.name ?? "Demo Developer",
            text: input.text.trim(),
            createdAt: new Date().toISOString(),
          },
        ];
        return { ...prev, teamRecords: { ...prev.teamRecords, rationales } };
      });
      return;
    }
    try {
      const { run: updated } = await api<{ run: Run }>(`${base}/team-rationales`, {
        ...send("POST", input),
        headers: participantHeaders(),
      });
      setRun(updated);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }

  async function removeRationale(noteId: string) {
    if (demo) {
      setRun((prev) => ({
        ...prev,
        teamRecords: {
          ...prev.teamRecords,
          rationales: (prev.teamRecords?.rationales ?? []).filter((n) => n.id !== noteId),
        },
      }));
      return;
    }
    try {
      const { run: updated } = await api<{ run: Run }>(
        `${base}/team-rationales/${encodeURIComponent(noteId)}`,
        { method: "DELETE", headers: participantHeaders() },
      );
      setRun(updated);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }

  async function addTodo(input: { filePath?: string; text: string; assigneeName?: string }) {
    if (demo) {
      setRun((prev) => {
        const todos = [
          ...(prev.teamRecords?.todos ?? []),
          {
            id: `demo-todo-${Date.now()}`,
            ...(input.filePath ? { filePath: input.filePath } : {}),
            text: input.text.trim(),
            authorId: me?.id ?? "demo-member",
            authorName: me?.name ?? "Demo Developer",
            ...(input.assigneeName?.trim() ? { assigneeName: input.assigneeName.trim() } : {}),
            done: false,
            createdAt: new Date().toISOString(),
          },
        ];
        return { ...prev, teamRecords: { ...prev.teamRecords, todos } };
      });
      return;
    }
    try {
      const { run: updated } = await api<{ run: Run }>(`${base}/team-todos`, {
        ...send("POST", {
          ...(input.filePath ? { filePath: input.filePath } : {}),
          text: input.text,
          ...(input.assigneeName?.trim() ? { assigneeName: input.assigneeName.trim() } : {}),
        }),
        headers: participantHeaders(),
      });
      setRun(updated);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }

  async function toggleTodo(todoId: string, done: boolean) {
    if (demo) {
      setRun((prev) => ({
        ...prev,
        teamRecords: {
          ...prev.teamRecords,
          todos: (prev.teamRecords?.todos ?? []).map((item) =>
            item.id === todoId
              ? { ...item, done, doneAt: done ? new Date().toISOString() : undefined }
              : item,
          ),
        },
      }));
      return;
    }
    try {
      const { run: updated } = await api<{ run: Run }>(
        `${base}/team-todos/${encodeURIComponent(todoId)}`,
        { ...send("PATCH", { done }), headers: participantHeaders() },
      );
      setRun(updated);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }

  async function removeTodo(todoId: string) {
    if (demo) {
      setRun((prev) => ({
        ...prev,
        teamRecords: {
          ...prev.teamRecords,
          todos: (prev.teamRecords?.todos ?? []).filter((item) => item.id !== todoId),
        },
      }));
      return;
    }
    try {
      const { run: updated } = await api<{ run: Run }>(
        `${base}/team-todos/${encodeURIComponent(todoId)}`,
        { method: "DELETE", headers: participantHeaders() },
      );
      setRun(updated);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }

  return {
    activeInGroup: Boolean(token),
    me,
    activities,
    holds,
    dependencies,
    selectedRange,
    reportSelection: setSelectedRange,
    signOffFile,
    addRationale,
    removeRationale,
    addTodo,
    toggleTodo,
    removeTodo,
  };
}
