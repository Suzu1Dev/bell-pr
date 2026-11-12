/**
 * One repository's board, put together from the coordinator's view of the
 * project (its claims) and the side file (names and titles): who holds
 * what. Reading only, apart from `dropHoldEntries`, which edits a
 * `saveSide` draft.
 */
import type {
  CollabBoard,
  CollabBoardTodo,
  CollabFileDependency,
  CollabHold,
} from "../shared/collab.js";
import { sideEntry, type CollabSide } from "./collab-host.js";
import type { ClaimView, ProjectView } from "./coordination.js";
import { pathsMeet } from "./scope-paths.js";
import type { Run } from "./types.js";

/** The side file's key of a task. */
export const taskKey = (projectId: string, taskId: string) => `${projectId}/${taskId}`;

/** Drops recorded hold base commits from the side file; omits `holds` once empty. */
export function dropHoldEntries(draft: CollabSide, keys: readonly string[]) {
  if (!draft.holds || !keys.length) return;
  for (const key of keys) {
    if (Object.hasOwn(draft.holds, key)) delete draft.holds[key];
  }
  if (!Object.keys(draft.holds).length) delete draft.holds;
}

/** A person's name as the side file has it, else their id. */
export const nameOf = (side: CollabSide, id: string) => sideEntry(side.people, id)?.name ?? id;

/** A task's side-file entry: its title, what it waited for, and whether it is done. */
export const taskOf = (side: CollabSide, projectId: string, taskId: string) =>
  sideEntry(side.tasks, taskKey(projectId, taskId));

/** A task as other work names it; its id stands in for a title that was never saved. */
export const dependencyOf = (side: CollabSide, projectId: string, taskId: string) => ({
  taskId,
  title: taskOf(side, projectId, taskId)?.title ?? taskId,
});

/** A held claim as the board shows it. */
export function holdOf(side: CollabSide, projectId: string, claim: ClaimView): CollabHold {
  const task = taskOf(side, projectId, claim.taskId);
  return {
    claimId: claim.id,
    taskId: claim.taskId,
    title: task?.title ?? claim.taskId,
    holder: claim.holder,
    scopes: claim.scopes,
    fence: claim.fence,
    since: claim.createdAt,
    ...(task?.dependsOn?.length
      ? { dependsOn: task.dependsOn.map((id) => dependencyOf(side, projectId, id)) }
      : {}),
  };
}

/**
 * The held paths in the way of `scopes`, with the claim each belongs to:
 * the coordinator would refuse a hold that meets any of them, the asker's
 * own included.
 */
export function inTheWay(view: ProjectView, scopes: string[]) {
  const found: { claim: ClaimView; scope: string }[] = [];
  // shortcut: each asked path against each held one (about half a second for 50 against
  // the 20,000 a group can hold), sort as scopeParents does once groups hold thousands.
  for (const claim of view.claims) {
    if (claim.status !== "held") continue;
    for (const scope of claim.scopes)
      if (scopes.some((asked) => pathsMeet(asked, scope))) found.push({ claim, scope });
  }
  return found;
}

export function boardOf(
  view: ProjectView,
  side: CollabSide,
  extra?: { runs?: readonly Run[] },
): CollabBoard {
  const project = sideEntry(side.projects, view.id);
  const held = view.claims.filter((claim) => claim.status === "held");
  const holders = new Set(held.map((claim) => claim.holder));
  const people: CollabBoard["people"] = [];
  for (const [id, person] of Object.entries(side.people ?? {})) {
    if (person.removedAt && !holders.has(id)) continue;
    people.push({
      id,
      name: person.name ?? id,
      ...(person.admin ? { admin: true } : {}),
      ...(person.removedAt ? { removed: true } : {}),
      ...(person.disabledAt ? { disabled: true } : {}),
      ...(person.username ? { username: person.username } : {}),
    });
  }
  const dependencies: CollabFileDependency[] = Object.entries(
    sideEntry(side.fileDeps, view.id) ?? {},
  )
    .map(([id, dep]) => ({
      id,
      from: dep.from,
      to: dep.to,
      mode: dep.mode,
      createdBy: dep.createdBy,
      createdByName: nameOf(side, dep.createdBy),
      createdAt: dep.createdAt,
      ...(dep.note ? { note: dep.note } : {}),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const openTodos: CollabBoardTodo[] = [];
  if (extra?.runs && project?.repoId) {
    for (const run of extra.runs) {
      if (run.repoId !== project.repoId || !run.teamRecords?.todos?.length) continue;
      for (const todo of run.teamRecords.todos) {
        if (todo.done) continue;
        openTodos.push({
          id: todo.id,
          runId: run.id,
          runTitle: run.title,
          ...(todo.filePath ? { filePath: todo.filePath } : {}),
          text: todo.text,
          ...(todo.authorId ? { authorId: todo.authorId } : {}),
          authorName: todo.authorName,
          ...(todo.assigneeId ? { assigneeId: todo.assigneeId } : {}),
          ...(todo.assigneeName ? { assigneeName: todo.assigneeName } : {}),
          done: false,
          createdAt: todo.createdAt,
        });
      }
    }
    openTodos.sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0));
  }
  return {
    project: {
      id: view.id,
      name: project?.name ?? view.id,
      ...(project?.repoId === undefined ? {} : { repoId: project.repoId }),
    },
    people,
    held: held.map((claim) => holdOf(side, view.id, claim)),
    ...(dependencies.length ? { dependencies } : {}),
    ...(openTodos.length ? { openTodos: openTodos.slice(0, 100) } : {}),
  };
}
