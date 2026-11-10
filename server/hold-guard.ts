/**
 * The write guard (docs/design/collab-write-guard.md). S1: a change BELL PR
 * is about to commit and push is compared with the group's holds, and a
 * file someone else holds stops it. S2: so are each agent write turn, each
 * teammate's change before it joins the contribution, and the files a plan
 * covers before its agents start. The person's own holds do not count.
 * Only with --group, and only for repositories in the group.
 *
 * Reading only: it writes nothing and takes no lock, so the answer is true
 * at the moment it is given, as the coordinator's `check` is.
 *
 * Who "you" are: the person of the `x-bell-participant` token when the
 * request sends one (unknown or removed: 403 `notJoined`); without it,
 * everyone still in the group who joined from the device the request comes
 * from, the install token counting as one device ("at the host").
 */
import { maxRunOwners } from "../shared/collab.js";
import type { DraftCheck } from "../shared/draft-checks.js";
import { reviewBaseSha } from "../shared/followups.js";
import { formatters } from "../shared/i18n/locale.js";
import { product } from "../shared/product.js";
import { nameOf, taskOf } from "./collab-board.js";
import type { CollabHost } from "./collab-host.js";
import { notJoined } from "./collab-refusal.js";
import { currentLocale, sm } from "./i18n/index.js";
import type { HoldCheck } from "./publish.js";
import { assertGitConfigSafe, git } from "./process.js";
import { participantOf } from "./routes/collab.js";
import type { ClaimView } from "./coordination.js";
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

/** The held claims of the group's projects for one repository. */
type GroupClaims = "outside" | "unknown" | { projectId: string; claim: ClaimView }[];

function groupClaims(host: CollabHost, repoId: string): GroupClaims {
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
  return projects.flatMap((projectId) =>
    coordinator
      .claimsForHost(projectId)
      .filter((claim) => claim.status === "held")
      .map((claim) => ({ projectId, claim })),
  );
}

function conflictsOf(
  host: CollabHost,
  claims: Exclude<GroupClaims, "outside" | "unknown">,
  paths: readonly string[],
  you: ReadonlySet<string>,
): HeldConflict[] {
  const side = host.side();
  const held: HeldConflict[] = [];
  for (const { projectId, claim } of claims) {
    if (you.has(claim.holder)) continue;
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

function heldByOthers(host: CollabHost, repoId: string, paths: readonly string[], asker: HoldsAsker): Holds {
  const claims = groupClaims(host, repoId);
  if (typeof claims === "string") return claims;
  return conflictsOf(host, claims, paths, yours(host, asker));
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

/**
 * Who starts a run, saved on it as `owners`: the participant ids that count
 * as "you" for the request that starts it, by the same rules as publishing.
 * Undefined when group work was never set up, or when nobody in the group
 * joined from that device; such a run counts every hold as someone else's.
 */
export function runOwners(host: CollabHost, asker: HoldsAsker): string[] | undefined {
  if (host.status().state === "notSetUp") return undefined;
  const ids = [...yours(host, asker)].sort().slice(0, maxRunOwners);
  return ids.length ? ids : undefined;
}

/** The 503 for work that cannot be checked because group work stopped. */
const holdsUnknown = () =>
  new AppError((m) => m.run.local.agentsHoldsUnknown({ name: product.name }), 503, {
    details: { reason: "holdsUnknown" },
  });

/**
 * The guard for work no request is behind: agent turns, teammates' changes
 * and plans (docs/design/collab-write-guard.md, S2). "You" is the run's
 * owners, those of them still in the group; a run with none respects every
 * hold.
 */
export interface RunHolds {
  /**
   * What a write turn is told: the scopes other people hold and the
   * owners' own, sorted. Undefined when the run's repository is not in the
   * group; 503 `holdsUnknown` when group work stopped.
   */
  scope(run: Run): { others: string[]; yours: string[] } | undefined;
  /** Each path that meets someone else's hold; [] when none or outside the group; 503 `holdsUnknown`. */
  conflicts(run: Run, paths: readonly string[]): HeldConflict[];
}

export function runHolds(host: CollabHost): RunHolds {
  const owners = (run: Run): ReadonlySet<string> => {
    const people = host.side().people ?? {};
    return new Set((run.owners ?? []).filter((id) => people[id] && !people[id].removedAt));
  };
  const claimsOf = (run: Run) => {
    const claims = groupClaims(host, run.repoId);
    if (claims === "unknown") throw holdsUnknown();
    return claims === "outside" ? undefined : claims;
  };
  return {
    scope(run) {
      const claims = claimsOf(run);
      if (!claims) return undefined;
      const you = owners(run);
      const scopes = (mine: boolean) =>
        [
          ...new Set(
            claims.filter(({ claim }) => you.has(claim.holder) === mine).flatMap(({ claim }) => claim.scopes),
          ),
        ].sort();
      return { others: scopes(false), yours: scopes(true) };
    },
    conflicts(run, paths) {
      const claims = claimsOf(run);
      return claims ? conflictsOf(host, claims, paths, owners(run)) : [];
    },
  };
}

/** Where the work stopped, for the wording of the refusal. */
export type HeldWork = "turn" | "task" | "plan";

/**
 * The 409 `heldByOther` for work that met someone else's hold, listing
 * each path, its holder, the hold's title and since when, in the run's
 * locale. Nothing is reverted: the files stay as the agent left them.
 */
export function heldByOtherError(work: HeldWork, held: readonly HeldConflict[]) {
  return new AppError(
    (m) => {
      const items = heldItems(held);
      return work === "turn"
        ? m.run.local.turnHeldByOther({ items })
        : work === "task"
          ? m.run.local.taskHeldByOther({ items })
          : m.run.local.planHeldByOther({ items });
    },
    409,
    { details: { reason: "heldByOther", held } },
  );
}

/**
 * The paths of a 409 `heldByOther`, each once; undefined for any other
 * error. All an agent may be told of it: names and titles are text other
 * people typed.
 */
export function heldPathsOf(error: unknown): string[] | undefined {
  if (!(error instanceof AppError) || error.details?.reason !== "heldByOther") return undefined;
  return [...new Set((error.details.held as readonly HeldConflict[]).map(({ path }) => path))];
}

/**
 * Refuses work over someone else's hold: no-op without group work, 409
 * `heldByOther` when `paths` meet a hold, 503 `holdsUnknown` when it
 * cannot be told. Returns the conflicts it let through, which is only
 * ever the case while heldByOtherKind is "confirm"; the caller flags them.
 */
export function assertNotHeld(
  holds: RunHolds | undefined,
  run: Run,
  paths: readonly string[],
  work: HeldWork,
): HeldConflict[] {
  const held = holds?.conflicts(run, paths) ?? [];
  if (held.length && heldByOtherKind === "block") throw heldByOtherError(work, held);
  return held;
}

/** The run-log notice for work that went on over a hold, when heldByOtherKind is "confirm". */
export const heldNotice = (held: readonly HeldConflict[]) =>
  [sm().run.local.heldByOther, ...heldItems(held)].join("\n");

/**
 * Every path a run's checkout changes against its review base, as the
 * guard compares them with holds: `--no-renames`, so a rename is its old
 * and its new path, and untracked files too. Names only: no patch is read.
 */
export async function changedPaths(run: Pick<Run, "worktreePath" | "baseSha" | "followUps">) {
  const base = reviewBaseSha(run);
  if (!base || !run.worktreePath) return [];
  // Comparing the checkout may run its filters; refuse a configuration that sets any.
  await assertGitConfigSafe(run.worktreePath);
  const names = (output: string) => output.split("\0").filter(Boolean);
  const changed = await git(run.worktreePath, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--name-only",
    "-z",
    base,
    "--",
  ]);
  const untracked = await git(run.worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return [...new Set([...names(changed.stdout), ...names(untracked.stdout)])];
}
