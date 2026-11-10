/**
 * The write guard's first slice (docs/design/collab-write-guard.md, S1): a
 * change BELL PR is about to commit and push is compared with the group's
 * holds, and a file someone else holds stops it. The person's own holds do
 * not. Only with --group, and only for repositories in the group.
 *
 * Reading only: it writes nothing and takes no lock, so the answer is true
 * at the moment it is given, as the coordinator's `check` is.
 *
 * Who "you" are: the person of the `x-bell-participant` token when the
 * request sends one (unknown or removed: 403 `notJoined`); without it,
 * everyone still in the group who joined from the device the request comes
 * from, the install token counting as one device ("at the host").
 */
import type { DraftCheck } from "../shared/draft-checks.js";
import { formatters } from "../shared/i18n/locale.js";
import { product } from "../shared/product.js";
import { nameOf, taskOf } from "./collab-board.js";
import type { CollabHost } from "./collab-host.js";
import { notJoined } from "./collab-refusal.js";
import { currentLocale, sm } from "./i18n/index.js";
import type { HoldCheck } from "./publish.js";
import { participantOf } from "./routes/collab.js";
import { comparablePath, pathsMeet } from "./scope-paths.js";
import { AppError, type DiffFile, type Run } from "./types.js";

/**
 * What a change over someone else's hold does, the one place it is
 * decided. "block" refuses the publish, and the publish dialog cannot tick
 * it away (the design's default). "confirm" would let the person tick
 * `held-by-other` in the dialog and publish anyway. Not confirmed by the
 * product owner yet; only "block" is tested.
 */
export const heldByOtherKind: DraftCheck["kind"] = "block";

/** A changed file and the hold of someone else it meets. */
export interface HeldConflict {
  path: string;
  claimId: string;
  /** The holder's name as the group knows it, else their id. */
  holder: string;
  /** The hold's title, else its task id. */
  title: string;
  /** When the hold was taken (ISO). */
  since: string;
}

/** Who is asking: the request's participant token, if it sent one, and its device. */
export interface HoldsAsker {
  participant?: string;
  /** The paired device's id; undefined for the install token. */
  deviceId?: string;
}

/**
 * `outside`: nothing to check (no group set up, or the repository is not
 * in it). `unknown`: group work is on but cannot answer.
 */
type Holds = "outside" | "unknown" | HeldConflict[];

/** The participant ids that count as "you" for this request. */
function yours(host: CollabHost, asker: HoldsAsker): ReadonlySet<string> {
  if (asker.participant !== undefined) {
    const found = participantOf(host, asker.participant);
    if (!found) throw notJoined();
    return new Set([found.actor.id]);
  }
  return new Set(
    Object.entries(host.side().people ?? {})
      .filter(([, person]) => !person.removedAt && person.deviceId === asker.deviceId)
      .map(([id]) => id),
  );
}

function heldByOthers(host: CollabHost, repoId: string, paths: readonly string[], asker: HoldsAsker): Holds {
  const { state } = host.status();
  if (state === "notSetUp") return "outside";
  const side = host.side();
  const projects = Object.entries(side.projects ?? {})
    .filter(([, project]) => project.repoId === repoId)
    .map(([id]) => id);
  // Stopped: the side file as last read says which repositories are the
  // group's; without one (missing or damaged) every repository may be.
  if (state === "stopped") return side.groupId && !projects.length ? "outside" : "unknown";
  if (!projects.length) return "outside";
  const coordinator = host.coordinator();
  const you = yours(host, asker);
  const held: HeldConflict[] = [];
  for (const projectId of projects)
    for (const claim of coordinator.claimsForHost(projectId)) {
      if (claim.status !== "held" || you.has(claim.holder)) continue;
      for (const path of paths)
        // A path that cannot be compared reliably is taken to meet the hold.
        if (!comparablePath(path) || claim.scopes.some((scope) => pathsMeet(scope, path)))
          held.push({
            path,
            claimId: claim.id,
            holder: nameOf(side, claim.holder),
            title: taskOf(side, projectId, claim.taskId)?.title ?? claim.taskId,
            since: claim.createdAt,
          });
    }
  return held;
}

/** One line per conflict, in the request's locale like the other publish checks. */
function heldItems(held: readonly HeldConflict[]) {
  const format = formatters(currentLocale());
  const m = sm().run.local;
  return held.map((conflict) =>
    m.heldByOtherItem({ ...conflict, since: format.dateTime(conflict.since) }),
  );
}

/**
 * The guard for one request, from the group's host. The review routes
 * build it only when BELL PR runs with --group.
 */
export function holdGuard(host: CollabHost, asker: HoldsAsker) {
  const check = (run: Run, files: readonly DiffFile[]) =>
    heldByOthers(
      host,
      run.repoId,
      files.map((file) => file.path),
      asker,
    );
  /** For publish(), first publishes and follow-ups alike: 409 `heldByOther`, 503 `holdsUnknown`. */
  const publishing: HoldCheck = (run, files, acknowledged) => {
    const held = check(run, files);
    if (held === "outside") return;
    if (held === "unknown")
      throw new AppError((m) => m.run.publish.holdsUnknown({ name: product.name }), 503, {
        details: { reason: "holdsUnknown" },
      });
    if (!held.length) return;
    if (heldByOtherKind === "confirm" && acknowledged.includes("held-by-other")) return;
    throw new AppError((m) => m.run.publish.heldByOther({ items: heldItems(held) }), 409, {
      details: { reason: "heldByOther", held },
    });
  };
  /** For the publish dialog: the same answer as a check. */
  const preflight = (run: Run, files: readonly DiffFile[]): DraftCheck[] => {
    const held = check(run, files);
    const m = sm().run.local;
    if (held === "outside") return [];
    if (held === "unknown")
      return [
        {
          id: "holds-unknown",
          kind: "block",
          message: m.holdsUnknown({ name: product.name }),
          details: [],
        },
      ];
    if (!held.length) return [];
    return [{ id: "held-by-other", kind: heldByOtherKind, message: m.heldByOther, details: heldItems(held) }];
  };
  return { publishing, preflight };
}
