/**
 * One repository's board, put together from the coordinator's view of the
 * project (tasks and claims) and the side file (names and titles): who
 * holds what, and what is free to take again. Reading only.
 */
import type { CollabBoard, CollabHold, CollabReleased } from "../shared/collab.js";
import { sideEntry, type CollabSide } from "./collab-host.js";
import type { ClaimView, ProjectView } from "./coordination.js";
import { pathsMeet } from "./scope-paths.js";

/** The board lists this many released tasks and counts the rest. */
export const maxReleased = 20;

/** The side file's key of a task. */
export const taskKey = (projectId: string, taskId: string) => `${projectId}/${taskId}`;

/** A person's name as the side file has it, else their id. */
export const nameOf = (side: CollabSide, id: string) => sideEntry(side.people, id)?.name ?? id;

/** What the side file adds to a task; its id stands in for a title that was never saved. */
function labelOf(side: CollabSide, projectId: string, taskId: string) {
  const task = sideEntry(side.tasks, taskKey(projectId, taskId));
  return {
    taskId,
    title: task?.title ?? taskId,
    ...(task?.runId === undefined ? {} : { runId: task.runId }),
  };
}

/** A held claim as the board shows it. */
export function holdOf(side: CollabSide, projectId: string, claim: ClaimView): CollabHold {
  return {
    claimId: claim.id,
    ...labelOf(side, projectId, claim.taskId),
    holder: claim.holder,
    scopes: claim.scopes,
    fence: claim.fence,
    since: claim.createdAt,
  };
}

/**
 * The held paths in the way of `scopes`, with the claim each belongs to:
 * the coordinator would refuse a hold that meets any of them, the asker's
 * own included.
 */
export function inTheWay(view: ProjectView, scopes: string[]) {
  const found: { claim: ClaimView; scope: string }[] = [];
  for (const claim of view.claims) {
    if (claim.status !== "held") continue;
    for (const scope of claim.scopes)
      if (scopes.some((asked) => pathsMeet(asked, scope))) found.push({ claim, scope });
  }
  return found;
}

export function boardOf(view: ProjectView, side: CollabSide): CollabBoard {
  const project = sideEntry(side.projects, view.id);
  const held = view.claims.filter((claim) => claim.status === "held");
  // Claims are kept in the order they were made, so a task's last one wins.
  const last = new Map<string, ClaimView>();
  for (const claim of view.claims) last.set(claim.taskId, claim);
  const released: CollabReleased[] = [];
  for (const task of view.tasks) {
    const claim = last.get(task.id);
    if (task.status !== "open" || claim?.status === "held") continue;
    const label = labelOf(side, view.id, task.id);
    if (claim)
      released.push({
        ...label,
        scopes: claim.scopes,
        at: claim.updatedAt,
        ...(claim.endedBy === undefined ? {} : { by: claim.endedBy }),
        how: claim.status === "revoked" ? "revoked" : "released",
        ...(claim.reason === undefined ? {} : { reason: claim.reason }),
      });
    else {
      // Made, and then the hold was refused: the coordinator keeps no time of a task.
      const made = sideEntry(side.tasks, taskKey(view.id, task.id))?.createdAt;
      released.push({ ...label, scopes: [], at: made ?? project?.addedAt ?? "", how: "never" });
    }
  }
  // Newest first; the times are ISO 8601 in UTC, which sort as text.
  released.reverse().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const holders = new Set(held.map((claim) => claim.holder));
  const people: CollabBoard["people"] = [];
  for (const [id, person] of Object.entries(side.people ?? {})) {
    if (person.removedAt && !holders.has(id)) continue;
    people.push({
      id,
      name: person.name ?? id,
      ...(person.admin ? { admin: true } : {}),
      ...(person.removedAt ? { removed: true } : {}),
    });
  }
  return {
    project: {
      id: view.id,
      name: project?.name ?? view.id,
      ...(project?.repoId === undefined ? {} : { repoId: project.repoId }),
      ...(view.undecided ? { closed: true } : {}),
    },
    people,
    held: held.map((claim) => holdOf(side, view.id, claim)),
    released: released.slice(0, maxReleased),
    ...(released.length > maxReleased ? { moreReleased: released.length - maxReleased } : {}),
  };
}
