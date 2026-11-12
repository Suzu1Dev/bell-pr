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
import { activeFollowUp, reviewBaseSha } from "../shared/followups.js";
import { formatters } from "../shared/i18n/locale.js";
import { product } from "../shared/product.js";
import type { HeldUpstreamChange } from "../shared/sync.js";
import { nameOf, taskKey, taskOf } from "./collab-board.js";
import { sideEntry, type CollabHost } from "./collab-host.js";
import { notJoined } from "./collab-refusal.js";
import { currentLocale, sm, withLocale } from "./i18n/index.js";
import { log } from "./log.js";
import type { HoldCheck } from "./publish.js";
import { assertGitConfigSafe, git } from "./process.js";
import { participantOf } from "./routes/collab.js";
import type { ClaimView } from "./coordination.js";
import { baseScopePath, comparablePath, pathsMeet } from "./scope-paths.js";
import { AppError, type DiffFile, type Repository, type Run } from "./types.js";

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
  /** Line-range hold scope (`path#Lstart-Lend`) when the conflict is on a locked region. */
  scope?: string;
  /** Peer path when blocked by an active cross-file dependency guard (`mode: "block"`). */
  viaDependency?: string;
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
      .filter(([, person]) => !person.removedAt && !person.disabledAt && person.deviceId === asker.deviceId)
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
  const seen = new Set<string>();
  for (const { projectId, claim } of claims) {
    if (you.has(claim.holder)) continue;
    const deps = Object.values(sideEntry(side.fileDeps, projectId) ?? {}).filter(
      (dep) => dep.mode === "block",
    );
    for (const rawPath of paths) {
      const basePath = baseScopePath(rawPath);
      const key = `${claim.id}\0${basePath.toLowerCase()}`;
      if (seen.has(key)) continue;
      // A path that cannot be compared reliably is taken to meet the hold.
      const uncomparable = !comparablePath(rawPath);
      const matchedScope = uncomparable
        ? undefined
        : claim.scopes.find((scope) => pathsMeet(scope, rawPath));
      if (uncomparable || matchedScope !== undefined) {
        seen.add(key);
        held.push({
          path: basePath,
          ...(matchedScope?.includes("#L") ? { scope: matchedScope } : {}),
          claimId: claim.id,
          holder: nameOf(side, claim.holder),
          title: taskOf(side, projectId, claim.taskId)?.title ?? claim.taskId,
          since: claim.createdAt,
        });
        continue;
      }
      for (const dep of deps) {
        const hitFrom =
          pathsMeet(dep.from, rawPath) && claim.scopes.some((scope) => pathsMeet(scope, dep.to));
        const hitTo =
          !hitFrom &&
          pathsMeet(dep.to, rawPath) &&
          claim.scopes.some((scope) => pathsMeet(scope, dep.from));
        if (hitFrom || hitTo) {
          seen.add(key);
          held.push({
            path: basePath,
            viaDependency: hitFrom ? dep.to : dep.from,
            claimId: claim.id,
            holder: nameOf(side, claim.holder),
            title: taskOf(side, projectId, claim.taskId)?.title ?? claim.taskId,
            since: claim.createdAt,
          });
          break;
        }
      }
    }
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
    m.heldByOtherItem({
      ...conflict,
      path:
        conflict.scope ??
        (conflict.viaDependency ? `${conflict.path} (⇄ ${conflict.viaDependency})` : conflict.path),
      since: format.dateTime(conflict.since),
    }),
  );
}

const shaPattern = /^[a-f0-9]{40,64}$/;
const maxCommitsPerFile = 10;

function activeOwners(host: CollabHost, run: Pick<Run, "owners">): ReadonlySet<string> {
  const people = host.side().people;
  return new Set(
    (run.owners ?? []).filter((id) => {
      const person = sideEntry(people, id);
      return person && !person.removedAt && !person.disabledAt;
    }),
  );
}

/**
 * The newest commit of `branch` already present in BELL PR's local clone:
 * `origin/<branch>`, `<branch>` and the recorded bases of runs on that
 * branch. Reads local objects only and never calls the network.
 */
export async function knownBranchTip(
  repo: Repository | undefined,
  runs: readonly Run[],
  branch = repo?.defaultBranch,
): Promise<string | undefined> {
  if (!repo || !branch || branch.includes("\n")) return undefined;
  const refs = [
    `refs/remotes/origin/${branch}^{commit}`,
    `refs/heads/${branch}^{commit}`,
  ];
  for (const run of runs) {
    if (run.repoId !== repo.id || run.baseBranch !== branch) continue;
    if (shaPattern.test(run.baseSha)) refs.push(run.baseSha);
    if (run.sync?.to && shaPattern.test(run.sync.to)) refs.push(run.sync.to);
    for (const round of run.followUps ?? [])
      if (round.mergeParent && shaPattern.test(round.mergeParent)) refs.push(round.mergeParent);
  }
  const uniqueRefs = [...new Set(refs)];
  try {
    const out = (
      await git(repo.path, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
        input: uniqueRefs.map((ref) => `${ref}\n`).join(""),
      })
    ).stdout.split("\n");
    const commits: string[] = [];
    for (const line of out) {
      const match = /^([a-f0-9]{40,64}) commit$/.exec(line.trim());
      if (match && !commits.includes(match[1])) commits.push(match[1]);
    }
    if (!commits.length) return undefined;
    let best = commits[0];
    for (let index = 1; index < commits.length; index += 1) {
      const candidate = commits[index];
      const ancestor = await git(
        repo.path,
        ["merge-base", "--is-ancestor", best, candidate],
        { allowedCodes: [0, 1] },
      );
      if (ancestor.code === 0) best = candidate;
    }
    return best;
  } catch {
    return undefined;
  }
}

/**
 * Files under the caller's own holds on `run.repoId` that first-parent
 * commits on `target` changed since each hold's recorded base commit
 * (`<hold base>..<target>`). Returns commit short SHAs only, never subjects
 * or other people's holds. Reads at most the newest 500 first-parent commits
 * of each range; an older change is not reported. Empty while group work is
 * stopped or the repository is outside the group: the check is a warning
 * and never refuses a sync.
 */
export async function heldUpstreamChanges(
  host: CollabHost,
  repo: Repository | undefined,
  run: Pick<Run, "repoId" | "owners">,
  target: string | undefined,
  asker?: HoldsAsker,
): Promise<HeldUpstreamChange[]> {
  const claims = groupClaims(host, run.repoId);
  if (typeof claims === "string") return [];
  const you = asker ? yours(host, asker) : activeOwners(host, run);
  if (!repo || !target || !shaPattern.test(target)) return [];
  const holds = host.side().holds;
  const byBase = new Map<string, Set<string>>();
  for (const { projectId, claim } of claims) {
    if (!you.has(claim.holder)) continue;
    const base = sideEntry(holds, taskKey(projectId, claim.taskId));
    if (!base || base === target || !shaPattern.test(base)) continue;
    let scopes = byBase.get(base);
    if (!scopes) byBase.set(base, (scopes = new Set()));
    for (const scope of claim.scopes) scopes.add(scope);
  }
  if (!byBase.size) return [];
  const byPath = new Map<string, string[]>();
  for (const [base, scopeSet] of byBase) {
    const listed = await git(repo.path, [
      "--no-pager",
      "log",
      "--max-count=500",
      "--first-parent",
      "-m",
      "--no-renames",
      "--pretty=format:%x00%x00%H",
      "--name-only",
      "-z",
      "--end-of-options",
      `${base}..${target}`,
      "--",
    ]).catch((error: unknown) => {
      // Nothing is reported for this hold base; the host's log says why.
      log.warn("hold_guard.upstream_unread", {
        repoId: run.repoId,
        base: base.slice(0, 7),
        target: target.slice(0, 7),
        error,
      });
      return undefined;
    });
    if (!listed?.stdout) continue;
    const scopes = [...scopeSet];
    const meets = (file: string) =>
      !comparablePath(file) || scopes.some((scope) => pathsMeet(scope, file));
    for (const raw of listed.stdout.split("\0\0")) {
      const entry = raw.replace(/^\0+/, "");
      if (!entry) continue;
      const newline = entry.indexOf("\n");
      if (newline < 0) continue;
      const sha = entry.slice(0, newline).trim().slice(0, 7);
      if (!sha) continue;
      const touched = new Set<string>();
      for (const file of entry.slice(newline + 1).split("\0")) {
        if (file && meets(file)) touched.add(file);
      }
      for (const file of touched) {
        const commits = byPath.get(file) ?? [];
        if (!commits.includes(sha) && commits.length < maxCommitsPerFile) commits.push(sha);
        byPath.set(file, commits);
      }
    }
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, commits]) => ({ path, commits }));
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
      diffScopes(files),
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
  /** S4 + cross-file warn dependencies: upstream commits on own holds and held dependent files. */
  const confirms = async (
    run: Run,
    repo: Repository | undefined,
    runs: readonly Run[],
    files?: readonly DiffFile[],
  ): Promise<DraftCheck[]> => {
    const out: DraftCheck[] = [];
    const m = sm().run.local;
    if (!activeFollowUp(run.followUps)) {
      const target = (await knownBranchTip(repo, runs, run.baseBranch)) ?? run.baseSha;
      const changes = await heldUpstreamChanges(host, repo, run, target, asker);
      if (changes.length)
        out.push({
          id: "held-changed-upstream",
          kind: "confirm",
          message: m.heldChangedUpstream({ branch: run.baseBranch }),
          details: changes.map((change) => m.heldChangedUpstreamItem(change)),
        });
    }
    if (files?.length) {
      const claims = groupClaims(host, run.repoId);
      if (Array.isArray(claims)) {
        const you = yours(host, asker);
        const side = host.side();
        const scopes = diffScopes(files);
        const warnDetails: string[] = [];
        const seen = new Set<string>();
        for (const { projectId, claim } of claims) {
          if (you.has(claim.holder)) continue;
          const deps = Object.values(sideEntry(side.fileDeps, projectId) ?? {}).filter(
            (dep) => dep.mode === "warn",
          );
          for (const dep of deps) {
            for (const rawPath of scopes) {
              const hitFrom =
                pathsMeet(dep.from, rawPath) && claim.scopes.some((s) => pathsMeet(s, dep.to));
              const hitTo =
                !hitFrom &&
                pathsMeet(dep.to, rawPath) &&
                claim.scopes.some((s) => pathsMeet(s, dep.from));
              if (!hitFrom && !hitTo) continue;
              const basePath = baseScopePath(rawPath);
              const peer = hitFrom ? dep.to : dep.from;
              const key = `${claim.id}\0${basePath.toLowerCase()}\0${peer.toLowerCase()}`;
              if (seen.has(key)) continue;
              seen.add(key);
              warnDetails.push(
                m.dependencyWarningItem({
                  path: basePath,
                  peer,
                  holder: nameOf(side, claim.holder),
                  title: taskOf(side, projectId, claim.taskId)?.title ?? claim.taskId,
                }),
              );
            }
          }
        }
        if (warnDetails.length)
          out.push({
            id: "collab-dependency-warn",
            kind: "confirm",
            message: m.dependencyWarning,
            details: warnDetails,
          });
      }
    }
    return out;
  };
  return { publishing, preflight, confirms };
}

/**
 * Who starts a run, saved on it as `owners`: the participant ids that count
 * as "you" for the request that starts it, by the same rules as publishing
 * (the first `maxRunOwners` of them, by id).
 * Undefined when nobody in the group joined from that device; such a run
 * counts every hold as someone else's. A request the group refuses (a token
 * it does not know, group work that stopped) is no refusal in a repository
 * outside the group, where nothing is checked: the run starts without owners.
 */
export function runOwners(host: CollabHost, repoId: string, asker: HoldsAsker): string[] | undefined {
  let ids: string[];
  try {
    ids = [...yours(host, asker)].sort().slice(0, maxRunOwners);
  } catch (error) {
    if (groupClaims(host, repoId) === "outside") return undefined;
    throw error;
  }
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
  /** Validates the request's participant token when `run` belongs to a group repository. */
  assertAsker?(run: Pick<Run, "repoId">, asker?: HoldsAsker): void;
  /** S4: upstream commits on `target` since each of the caller's holds was taken. */
  upstreamChanges?(
    run: Pick<Run, "repoId" | "owners">,
    repo: Repository,
    target: string,
    asker?: HoldsAsker,
  ): Promise<HeldUpstreamChange[]>;
}

export function runHolds(host: CollabHost): RunHolds {
  const claimsOf = (run: Run) => {
    const claims = groupClaims(host, run.repoId);
    if (claims === "unknown") throw holdsUnknown();
    return claims === "outside" ? undefined : claims;
  };
  return {
    scope(run) {
      const claims = claimsOf(run);
      if (!claims) return undefined;
      const you = activeOwners(host, run);
      const side = host.side();
      const depGuarded: string[] = [];
      for (const { projectId, claim } of claims) {
        if (you.has(claim.holder)) continue;
        for (const dep of Object.values(sideEntry(side.fileDeps, projectId) ?? {})) {
          if (dep.mode !== "block") continue;
          if (claim.scopes.some((s) => pathsMeet(s, dep.to))) depGuarded.push(dep.from);
          if (claim.scopes.some((s) => pathsMeet(s, dep.from))) depGuarded.push(dep.to);
        }
      }
      const scopes = (mine: boolean) =>
        [
          ...new Set([
            ...claims
              .filter(({ claim }) => you.has(claim.holder) === mine)
              .flatMap(({ claim }) => claim.scopes),
            ...(mine ? [] : depGuarded),
          ]),
        ].sort();
      return { others: scopes(false), yours: scopes(true) };
    },
    conflicts(run, paths) {
      const claims = claimsOf(run);
      return claims ? conflictsOf(host, claims, paths, activeOwners(host, run)) : [];
    },
    assertAsker(run, asker) {
      if (!asker) return;
      const claims = groupClaims(host, run.repoId);
      if (Array.isArray(claims)) yours(host, asker);
    },
    upstreamChanges(run, repo, target, asker) {
      return heldUpstreamChanges(host, repo, run, target, asker);
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
 * Matches a persisted turn-level `heldByOther` error in any supported locale
 * by its fixed prefix, without parsing paths out of text containing holder
 * names or hold titles.
 */
export function isTurnHeldByOtherMessage(text: string | undefined): boolean {
  if (!text) return false;
  return (["en", "zh-TW"] as const).some((locale) =>
    withLocale(locale, () => {
      const prefix = sm().run.local.turnHeldByOther({ items: ["\0"] }).split("\0")[0];
      return Boolean(prefix && text.startsWith(prefix));
    }),
  );
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

const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * 1-based line ranges in the base file touched by a unified diff patch.
 * Context lines (' ') are skipped so two people holding non-overlapping
 * `#L<start>-L<end>` regions of the same file can edit concurrently.
 */
export function changedLineRanges(patch: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let oldLine = 0;
  let inHunk = false;
  let runStart = 0;
  let runEnd = 0;
  const flush = () => {
    if (!runStart) return;
    const prev = ranges[ranges.length - 1];
    if (prev && runStart <= prev.end + 1) prev.end = Math.max(prev.end, runEnd);
    else ranges.push({ start: runStart, end: runEnd });
    runStart = 0;
    runEnd = 0;
  };
  for (const line of patch.split("\n")) {
    const header = hunkHeaderPattern.exec(line);
    if (header) {
      flush();
      const oldStart = Number(header[1]);
      const oldCount = header[2] === undefined ? 1 : Number(header[2]);
      oldLine = oldCount === 0 ? oldStart + 1 : oldStart;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith(" ")) {
      flush();
      oldLine += 1;
    } else if (line.startsWith("-")) {
      const at = Math.max(1, oldLine);
      if (!runStart) runStart = at;
      runEnd = Math.max(runEnd, at);
      oldLine += 1;
    } else if (line.startsWith("+")) {
      if (!runStart) {
        const at = Math.max(1, oldLine);
        runStart = at;
        runEnd = at;
      }
    } else if (!line.startsWith("\\")) {
      flush();
      inHunk = false;
    }
  }
  flush();
  return ranges;
}

/** Emits `path#L<start>-L<end>` per modified hunk on modified text files, else `path`. */
export function diffScopes(files: readonly DiffFile[]): string[] {
  const scopes: string[] = [];
  for (const file of files) {
    if (file.status === "modified" && !file.blocked && file.patch) {
      const ranges = changedLineRanges(file.patch);
      if (ranges.length) {
        for (const range of ranges) scopes.push(`${file.path}#L${range.start}-L${range.end}`);
        continue;
      }
    }
    scopes.push(file.path);
  }
  return scopes;
}

/**
 * Changed scopes in a run's checkout against its review base, with `#Lstart-Lend`
 * granularity on modified tracked text files so concurrent intra-file holds do
 * not block non-overlapping Agent edits.
 */
export async function changedScopes(run: Pick<Run, "worktreePath" | "baseSha" | "followUps">) {
  const base = reviewBaseSha(run);
  if (!base || !run.worktreePath) return [];
  await assertGitConfigSafe(run.worktreePath);
  const names = (output: string) => output.split("\0").filter(Boolean);
  const tracked = names(
    (
      await git(run.worktreePath, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--name-only",
        "-z",
        base,
        "--",
      ])
    ).stdout,
  );
  const untracked = names(
    (await git(run.worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"])).stdout,
  );
  const scopes: string[] = [];
  for (const filePath of tracked) {
    const patch = (
      await git(
        run.worktreePath,
        [
          "--literal-pathspecs",
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--unified=0",
          base,
          "--",
          filePath,
        ],
        { maxBytes: 600_000 },
      ).catch(() => ({ stdout: "" }))
    ).stdout;
    if (
      patch &&
      !patch.includes("\nnew file mode ") &&
      !patch.includes("\ndeleted file mode ") &&
      !patch.includes("Binary files ") &&
      !patch.includes("GIT binary patch")
    ) {
      const ranges = changedLineRanges(patch);
      if (ranges.length) {
        for (const range of ranges) scopes.push(`${filePath}#L${range.start}-L${range.end}`);
        continue;
      }
    }
    scopes.push(filePath);
  }
  for (const filePath of untracked) {
    if (!tracked.includes(filePath)) scopes.push(filePath);
  }
  return scopes;
}
