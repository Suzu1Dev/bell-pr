/**
 * Project coordination: one authority for who may change which files of a
 * project, after which other work, and onto which integration branch.
 *
 * One process keeps a data directory's coordination file, and only while
 * it holds that directory's lock under the strict rule (writer-lock.ts):
 * no start of this version takes the lock over from a holder that is not
 * shown to have stopped. It answers for every
 * participant, person or agent, wherever they work from: who is asking
 * comes from the participant token alone, never from what a request says
 * about itself.
 *
 * - A claim gives one participant the file scopes of one task. Scopes of
 *   held claims never meet (scope-paths.ts), so two claims never share a
 *   file. A claim is granted or widened whole or not at all, and is
 *   reported only once it is on disk.
 * - A task takes no claim, and integrates nothing, until each task it
 *   depends on is integrated; a failed dependency stops it until an admin
 *   reopens that task. A reopened task keeps its history: its ended claims
 *   stay ended, and its next claim takes a new, higher fence.
 * - Only its holder (release, failing the task), an admin (revoke) or its
 *   integration ends a claim; time and disconnects never do. Each grant
 *   takes the project's next fence, and an ended claim authorises nothing.
 * - An integration moves the project's integration branch from the base
 *   the participant names to a change of only the claim's files, with a
 *   compare-and-swap. The intent is saved first, so a restart can tell
 *   whether the branch moved.
 *
 * Any doubt stops it: a missing, damaged or newer file, a lost lock or a
 * failed write refuses every request until the coordinator is opened
 * again. An interrupted integration it cannot settle from the branch
 * closes only its own project, until an admin settles it from the branch.
 * No answer ever stands in for "nobody holds this".
 *
 * This guards what goes through it. Writes made around it (a shell, an
 * editor, a push straight to the repository) are not stopped here; see
 * docs/multiuser-collaboration.md.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataPaths } from "./config.js";
import { digestsMatch, sha256Hex } from "./device-tokens.js";
import { writeDurable } from "./fs-atomic.js";
import { sensitivePath } from "./git.js";
import { lenientRead } from "./persisted-schema.js";
import { git, noGraftFile } from "./process.js";
import {
  claimableScope,
  comparablePath,
  foldPath,
  scopeParents,
  scopesHolding,
} from "./scope-paths.js";
import { AppError } from "./types.js";
import { isWriterLock, type WriterLock } from "./writer-lock.js";

/** At most this many scopes in one claim. */
export const maxScopes = 200;
/** At most this many commits in one integration. */
export const maxCommits = 200;
const maxDependencies = 50;
const maxPaths = 1000;
const maxReason = 500;

/** How much one coordination file holds; tasks and claims count per project. */
export interface CoordinationLimits {
  participants: number;
  projects: number;
  tasks: number;
  claims: number;
  /** Claims held at once in one project, and their scopes together. */
  heldClaims: number;
  heldScopes: number;
  /** Claims one participant holds at once across all projects, and their scopes together. */
  participantHeldClaims: number;
  participantHeldScopes: number;
  /** Bytes of the file as written. */
  bytes: number;
  /** Reopenings one task keeps, each with who reopened it and when. */
  reopenings: number;
  /** Settlements one project keeps; keeping another drops its oldest. */
  recoveries: number;
}
export const coordinationLimits: Readonly<CoordinationLimits> = Object.freeze({
  participants: 1000,
  projects: 100,
  tasks: 10_000,
  claims: 100_000,
  heldClaims: 1000,
  heldScopes: 20_000,
  participantHeldClaims: 100,
  participantHeldScopes: 2000,
  bytes: 8 * 1024 * 1024,
  reopenings: 100,
  recoveries: 10,
});
/**
 * The reader takes files up to this many times the writer's limit (32 MiB
 * by default), as lenientRead does for lengths.
 */
const readSlack = 4;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const tokenPattern = /^bpc_[A-Za-z0-9_-]{43}$/;
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

const id = z.string().regex(idPattern);
const sha = z.string().regex(shaPattern);
const claimId = z.string().regex(/^[0-9a-f-]{36}$/);
const timestamp = z.string().max(40);

// Objects keep keys a newer build added, so writing the file back loses
// nothing. A newer build that adds anything an older one must enforce
// raises `version`, which this build refuses to read.
const participantSchema = z.looseObject({
  id,
  role: z.enum(["member", "admin"]),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: timestamp,
});
const taskSchema = z.looseObject({
  id,
  dependsOn: z.array(id).max(maxDependencies),
  status: z.enum(["open", "integrated", "failed"]),
  createdBy: id,
  createdAt: timestamp,
  integratedSha: sha.optional(),
  /** Each time an admin opened the task again after it failed, oldest first. */
  reopenings: z
    .array(z.looseObject({ by: id, at: timestamp, reason: z.string().max(maxReason).optional() }))
    .max(coordinationLimits.reopenings)
    .optional(),
});
const claimSchema = z.looseObject({
  id: claimId,
  taskId: id,
  holder: id,
  scopes: z.array(z.string().max(1024)).min(1).max(maxScopes),
  fence: z.number().int().min(1),
  status: z.enum(["held", "released", "revoked", "integrated"]),
  createdAt: timestamp,
  updatedAt: timestamp,
  endedBy: id.optional(),
  reason: z.string().max(maxReason).optional(),
});
const projectSchema = z.looseObject({
  id,
  baseline: z.looseObject({
    repository: z.string().max(4096),
    ref: z.string().max(255),
    sha,
  }),
  /** The last fence issued; every grant takes the next one. */
  fence: z.number().int().min(0),
  tasks: z.array(taskSchema).max(coordinationLimits.tasks),
  claims: z.array(claimSchema).max(coordinationLimits.claims),
  /** An integration whose branch update may or may not have happened. */
  pending: z
    .looseObject({ claimId, fence: z.number().int().min(1), from: sha, to: sha, startedAt: timestamp })
    .optional(),
  /**
   * Each time an admin settled an integration that opening could not,
   * oldest first: who, when, the intent and what the branch showed.
   */
  recoveries: z
    .array(
      z.looseObject({
        by: id,
        at: timestamp,
        claimId,
        fence: z.number().int().min(1),
        from: sha,
        to: sha,
        startedAt: timestamp,
        outcome: z.enum(["integrated", "notIntegrated"]),
      }),
    )
    .max(coordinationLimits.recoveries)
    .optional(),
});
const fileSchema = z.looseObject({
  format: z.literal("bellpr-coordination"),
  version: z.literal(1),
  /** Counts every write. */
  revision: z.number().int().min(0),
  participants: z.array(participantSchema).max(coordinationLimits.participants),
  projects: z.array(projectSchema).max(coordinationLimits.projects),
});
const readSchema = lenientRead(fileSchema);

type CoordinationState = z.output<typeof fileSchema>;
type Participant = CoordinationState["participants"][number];
type Project = CoordinationState["projects"][number];
type Task = Project["tasks"][number];
type Claim = Project["claims"][number];
type Recovery = NonNullable<Project["recoveries"]>[number];
export type Role = Participant["role"];

/** The steps of an integration a crash can fall between. */
export type CoordinationStep = "intent-saved" | "ref-updated";

export interface CoordinatorOptions {
  dataDir: string;
  /**
   * The data directory's lock (index.ts acquireWriterLock); asked before
   * opening, every write and every branch update.
   */
  lock: WriterLock;
  /** Replaces writeDurable, for tests of failed writes. */
  write?: typeof writeDurable;
  /** Called at each step of an integration; tests crash the process here. */
  onStep?: (step: CoordinationStep) => void | Promise<void>;
  /** Lower limits, for tests that fill coordination up; a higher one is ignored. */
  limits?: Partial<CoordinationLimits>;
}

/** Who is asking: only authenticate() makes one. */
export interface Actor {
  readonly id: string;
  readonly role: Role;
}
const issuedActors = new WeakSet<Actor>();

export interface ClaimView {
  id: string;
  taskId: string;
  holder: string;
  scopes: string[];
  fence: number;
  status: Claim["status"];
  createdAt: string;
  updatedAt: string;
  endedBy?: string;
  reason?: string;
}

export interface TaskView {
  id: string;
  dependsOn: string[];
  status: Task["status"];
  createdBy: string;
  integratedSha?: string;
  reopenings?: { by: string; at: string; reason?: string }[];
}

export interface PendingView {
  claimId: string;
  fence: number;
  from: string;
  to: string;
  startedAt: string;
}

export interface RecoveryView extends PendingView {
  by: string;
  at: string;
  outcome: Recovery["outcome"];
}

export interface ProjectView {
  id: string;
  branch: { ref: string; sha: string };
  fence: number;
  revision: number;
  tasks: TaskView[];
  claims: ClaimView[];
  /** The interrupted integration that keeps the project closed until an admin settles it. */
  undecided?: PendingView;
  recoveries?: RecoveryView[];
}

export interface IntegrationView {
  claim: ClaimView;
  task: TaskView;
  branch: { ref: string; sha: string };
}

type Message = ConstructorParameters<typeof AppError>[0];

/** An AppError with a stable `details.reason` that clients and tests branch on. */
function refuse(
  status: number,
  reason: string,
  message: Message,
  details: Record<string, unknown> = {},
  cause?: unknown,
) {
  return new AppError(message, status, { details: { reason, ...details }, cause });
}

const notSingleWriter = () =>
  refuse(503, "notSingleWriter", (m) => m.coordination.store.notSingleWriter);

/** Whether `options.lock` is the strict lock of this data directory, still held. */
function holdsLock(options: CoordinatorOptions) {
  const { lock } = options;
  return isWriterLock(lock) && lock.dataDir === path.resolve(options.dataDir) && lock.holds();
}
const damaged = (problem: string, cause?: unknown) =>
  refuse(503, "damaged", (m) => m.coordination.store.damaged, {}, cause ?? new Error(problem));
const unavailable = (cause: unknown) =>
  refuse(503, "unavailable", (m) => m.coordination.store.unavailable, {}, cause);
const inconsistent = (cause: unknown) =>
  refuse(500, "inconsistent", (m) => m.coordination.store.damaged, {}, cause);
const full = (limit: keyof CoordinationLimits, max: number) =>
  refuse(409, "full", (m) => m.coordination.store.full, { limit, max });
const unreadableChange = () =>
  refuse(503, "unreadableChange", (m) => m.coordination.integration.unreadableChange);
const unauthenticated = () =>
  refuse(401, "unauthenticated", (m) => m.coordination.participant.unauthenticated);

/** Untrusted text, safe to repeat inside a message. */
const printable = (value: unknown) =>
  String(value).replace(/[^\x20-\x7e]/g, "?").slice(0, 200);

function validId(value: unknown): string {
  if (typeof value === "string" && idPattern.test(value)) return value;
  throw refuse(400, "invalidId", (m) => m.coordination.invalidId({ id: printable(value) }));
}

/** Every scope in the one spelling claims compare, or a refusal naming the first that has none. */
function normalizeScopes(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0)
    throw refuse(400, "invalidScope", (m) => m.coordination.claim.invalidScope({ scope: "" }));
  if (raw.length > maxScopes)
    throw refuse(400, "tooManyScopes", (m) => m.coordination.claim.tooManyScopes);
  return unionScopes([], raw.map((value: unknown) => {
    const scope = typeof value === "string" ? claimableScope(value) : undefined;
    if (scope === undefined)
      throw refuse(400, "invalidScope", (m) =>
        m.coordination.claim.invalidScope({ scope: printable(value) }),
      );
    return scope;
  }));
}

/** `held` and then each new scope not already there in another ASCII case. */
function unionScopes(held: string[], added: string[]) {
  const scopes = [...held];
  const folded = new Set(held.map(foldPath));
  for (const scope of added) {
    if (folded.has(foldPath(scope))) continue;
    folded.add(foldPath(scope));
    scopes.push(scope);
  }
  return scopes;
}

/**
 * The claims among `claims` whose scopes meet one of `scopes`, in their
 * order. Held claims never meet each other, so of every scope linked to
 * a scope of the other side (scopeParents), the claim's side names one.
 */
function meetingClaims(claims: Claim[], scopes: string[]): Claim[] {
  const all = [...scopes];
  const owners: (Claim | undefined)[] = scopes.map(() => undefined);
  for (const claim of claims)
    for (const scope of claim.scopes) {
      all.push(scope);
      owners.push(claim);
    }
  const meeting = new Set<Claim>();
  scopeParents(all).forEach((parent, index) => {
    if (parent < 0) return;
    const [above, below] = [owners[parent], owners[index]];
    if (!above !== !below) meeting.add((above ?? below) as Claim);
  });
  return claims.filter((claim) => meeting.has(claim));
}

/** What in a state breaks the rules every write keeps, if anything. */
function problemIn(state: CoordinationState): string | undefined {
  const participants = new Set<string>();
  for (const participant of state.participants) {
    if (participants.has(participant.id)) return `participant ${participant.id} twice`;
    participants.add(participant.id);
  }
  const projects = new Set<string>();
  const branches = new Set<string>();
  for (const project of state.projects) {
    if (projects.has(project.id)) return `project ${project.id} twice`;
    projects.add(project.id);
    const branch = `${project.baseline.repository}\0${project.baseline.ref}`;
    if (
      !path.isAbsolute(project.baseline.repository) ||
      !project.baseline.ref.startsWith("refs/heads/") ||
      branches.has(branch)
    )
      return `project ${project.id} baseline`;
    branches.add(branch);
    const tasks = new Map<string, Task>();
    for (const task of project.tasks) {
      if (tasks.has(task.id)) return `task ${task.id} twice`;
      // Dependencies come before their dependants, so the graph has no cycle.
      if (task.dependsOn.some((dependency) => !tasks.has(dependency)))
        return `task ${task.id} dependency`;
      if (!participants.has(task.createdBy)) return `task ${task.id} creator`;
      if (task.reopenings?.some((reopening) => !participants.has(reopening.by)))
        return `task ${task.id} reopening`;
      if ((task.status === "integrated") !== (task.integratedSha !== undefined))
        return `task ${task.id} integration`;
      tasks.set(task.id, task);
    }
    const claims = new Set<string>();
    const fences = new Set<number>();
    const held: Claim[] = [];
    const heldTasks = new Set<string>();
    for (const claim of project.claims) {
      const task = tasks.get(claim.taskId);
      if (claims.has(claim.id) || !task || !participants.has(claim.holder))
        return `claim ${claim.id}`;
      claims.add(claim.id);
      if (claim.fence > project.fence || fences.has(claim.fence))
        return `claim ${claim.id} fence`;
      fences.add(claim.fence);
      if (claim.scopes.some((scope) => claimableScope(scope) !== scope))
        return `claim ${claim.id} scope`;
      if (claim.status !== "held") continue;
      if (task.status !== "open" || heldTasks.has(task.id)) return `claim ${claim.id} task`;
      heldTasks.add(task.id);
      held.push(claim);
    }
    // Every scope of every held claim, sorted once (scopeParents): one
    // linked to a scope of another claim overlaps it.
    const scopes = held.flatMap((claim) => claim.scopes);
    const owners = held.flatMap((claim) => claim.scopes.map(() => claim));
    const overlap = scopeParents(scopes).findIndex(
      (parent, index) => parent >= 0 && owners[parent] !== owners[index],
    );
    if (overlap >= 0) return `claim ${owners[overlap].id} overlaps`;
    const pending = project.pending;
    if (
      pending &&
      !held.some((claim) => claim.id === pending.claimId && claim.fence === pending.fence)
    )
      return `project ${project.id} pending`;
    if (pending && pending.from !== project.baseline.sha)
      return `project ${project.id} pending base`;
    if (project.recoveries?.some((recovery) => !participants.has(recovery.by)))
      return `project ${project.id} recovery`;
  }
  return undefined;
}

function parseState(text: string, limits: CoordinationLimits): CoordinationState {
  if (Buffer.byteLength(text) > limits.bytes * readSlack) throw damaged("too large");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw damaged("not JSON", error);
  }
  const parsed = readSchema.safeParse(value);
  if (!parsed.success) throw damaged("schema", parsed.error);
  const problem = problemIn(parsed.data);
  if (problem) throw damaged(problem);
  return parsed.data;
}

const serialize = (state: CoordinationState) => `${JSON.stringify(state, null, 2)}\n`;

/** The default limits, lowered where `lower` asks; never raised. */
function limitsFrom(lower: Partial<CoordinationLimits> = {}): CoordinationLimits {
  const limits = { ...coordinationLimits };
  for (const key of Object.keys(limits) as (keyof CoordinationLimits)[]) {
    const value = lower[key];
    if (typeof value === "number" && value >= 0 && value < limits[key])
      limits[key] = Math.floor(value);
  }
  return limits;
}

/** The first collection that grew from `before` to `after` past its limit, if any. */
function overgrown(
  before: CoordinationState,
  after: CoordinationState,
  limits: CoordinationLimits,
): keyof CoordinationLimits | undefined {
  // Only growth counts, so a file a build with higher limits wrote still settles.
  const over = (limit: number, count: number, earlier = 0) => count > limit && count > earlier;
  if (over(limits.participants, after.participants.length, before.participants.length))
    return "participants";
  if (over(limits.projects, after.projects.length, before.projects.length)) return "projects";
  for (const project of after.projects) {
    const earlier = before.projects.find((candidate) => candidate.id === project.id);
    if (over(limits.tasks, project.tasks.length, earlier?.tasks.length)) return "tasks";
    if (over(limits.claims, project.claims.length, earlier?.claims.length)) return "claims";
    const [now, then] = [heldIn([project]).get(""), heldIn(earlier ? [earlier] : []).get("")];
    if (over(limits.heldClaims, now?.claims ?? 0, then?.claims)) return "heldClaims";
    if (over(limits.heldScopes, now?.scopes ?? 0, then?.scopes)) return "heldScopes";
  }
  const [now, then] = [heldIn(after.projects), heldIn(before.projects)];
  for (const [holder, count] of now) {
    if (!holder) continue;
    if (over(limits.participantHeldClaims, count.claims, then.get(holder)?.claims))
      return "participantHeldClaims";
    if (over(limits.participantHeldScopes, count.scopes, then.get(holder)?.scopes))
      return "participantHeldScopes";
  }
  return undefined;
}

/** Claims held in `projects` and their scopes, by holder and in all under "". */
function heldIn(projects: Project[]) {
  const counts = new Map<string, { claims: number; scopes: number }>();
  for (const project of projects)
    for (const claim of project.claims) {
      if (claim.status !== "held") continue;
      for (const key of ["", claim.holder]) {
        const count = counts.get(key) ?? { claims: 0, scopes: 0 };
        count.claims += 1;
        count.scopes += claim.scopes.length;
        counts.set(key, count);
      }
    }
  return counts;
}

/**
 * The bytes `change` adds to the file, measured with the serializer
 * every write uses. Indentation depends only on depth, so a change adds
 * the same bytes to any state.
 */
function growth(change: (project: Project) => void) {
  const probe = (): CoordinationState => ({
    format: "bellpr-coordination",
    version: 1,
    revision: 0,
    participants: [],
    projects: [
      {
        id: "p",
        baseline: { repository: "/", ref: "refs/heads/p", sha: "0".repeat(40) },
        fence: 1,
        tasks: [{ id: "t", dependsOn: [], status: "open", createdBy: "a", createdAt: "" }],
        claims: [
          {
            id: "0".repeat(36),
            taskId: "t",
            holder: "a",
            scopes: ["a"],
            fence: 1,
            status: "held",
            createdAt: "",
            updatedAt: "",
          },
        ],
      },
    ],
  });
  const before = probe();
  const after = probe();
  change(after.projects[0]);
  return Buffer.byteLength(serialize(after)) - Buffer.byteLength(serialize(before));
}

// Each field settling writes at its longest: ids, times and shas at their
// limits, and a reason of characters JSON escapes into six bytes each.
const longest = { id: "x".repeat(64), time: "x".repeat(40), sha: "0".repeat(64) };
const room = {
  /** A held claim ending in any way. */
  claim: growth(({ claims: [claim] }) =>
    Object.assign(claim, {
      status: "integrated",
      updatedAt: longest.time,
      endedBy: longest.id,
      reason: "\0".repeat(maxReason),
    }),
  ),
  /** An open task failing or being integrated. */
  task: growth(({ tasks: [task] }) =>
    Object.assign(task, { status: "integrated", integratedSha: longest.sha }),
  ),
  /** An integration's intent. */
  pending: growth((project) => {
    project.pending = {
      claimId: "0".repeat(36),
      fence: Number.MAX_SAFE_INTEGER,
      from: longest.sha,
      to: longest.sha,
      startedAt: longest.time,
    };
  }),
};

/** Bytes `records` take in a project, over a project without them. */
const recoveriesSize = (records: Recovery[]) =>
  records.length
    ? growth((project) => {
        project.recoveries = records;
      })
    : 0;

/** Bytes a project's settlements take at most once it keeps `count`. */
function recoveriesRoom(count: number) {
  const record: Recovery = {
    by: longest.id,
    at: longest.time,
    claimId: "0".repeat(36),
    fence: Number.MAX_SAFE_INTEGER,
    from: longest.sha,
    to: longest.sha,
    startedAt: longest.time,
    outcome: "notIntegrated",
  };
  return recoveriesSize(Array.from({ length: count }, () => record));
}

/**
 * Bytes the file keeps free for what may happen without anything being
 * added: every held claim ending, every open task closing, an intent in
 * every project, each project's settlements growing to `recoveries`
 * bytes (recoveriesRoom) and the revision counting up. Releasing,
 * revoking, failing, integrating, recovering and settling only spend this
 * room, so they never take the file past its limit.
 */
function reserve(state: CoordinationState, recoveries: number) {
  let bytes = Math.max(0, String(Number.MAX_SAFE_INTEGER).length - String(state.revision).length);
  for (const project of state.projects) {
    bytes += room.pending;
    bytes += Math.max(0, recoveries - recoveriesSize(project.recoveries ?? []));
    for (const task of project.tasks) if (task.status === "open") bytes += room.task;
    for (const claim of project.claims) if (claim.status === "held") bytes += room.claim;
  }
  return bytes;
}

/** A record of `git diff-tree -r --raw --no-renames`: both modes, both ids and the status. */
const rawRecord =
  /^:([0-7]{6}) ([0-7]{6}) [0-9a-f]{40}(?:[0-9a-f]{24})? [0-9a-f]{40}(?:[0-9a-f]{24})? [ADMT]$/;

/**
 * The files `git diff-tree --stdin --always -r -z --raw --no-renames`
 * reports for `commits`: each commit's id in order, then a record and the
 * path, exactly as stored, of every file it changes. Undefined for output
 * in any other shape, which is never guessed at.
 */
export function changedFiles(output: string, commits: string[]) {
  const fields = output.split("\0");
  if (fields.pop() !== "") return undefined;
  const files: { path: string; modes: [string, string] }[] = [];
  let next = 0;
  for (let index = 0; index < fields.length; index += 1) {
    if (fields[index] === commits[next]) {
      next += 1;
      continue;
    }
    const record = next ? rawRecord.exec(fields[index]) : null;
    if (!record || index + 1 === fields.length) return undefined;
    index += 1;
    files.push({ path: fields[index], modes: [record[1], record[2]] });
  }
  return next === commits.length ? files : undefined;
}

/**
 * Why coordination does not integrate a file it can compare: one BELL PR
 * holds back (sensitivePath, in any ASCII case), or anything but a
 * regular file on either side, such as a symbolic link or a submodule.
 */
function heldBack(file: string, modes: string[]) {
  if (sensitivePath(file) || sensitivePath(foldPath(file))) return "sensitive";
  if (modes.includes("120000")) return "symlink";
  if (modes.includes("160000")) return "submodule";
  if (modes.some((mode) => !["000000", "100644", "100755"].includes(mode))) return "mode";
  return undefined;
}

function pendingView({ claimId, fence, from, to, startedAt }: PendingView): PendingView {
  return { claimId, fence, from, to, startedAt };
}

function recoveryView(record: Recovery): RecoveryView {
  const { by, at, outcome } = record;
  return { ...pendingView(record), by, at, outcome };
}

function claimView(claim: Claim): ClaimView {
  return {
    id: claim.id,
    taskId: claim.taskId,
    holder: claim.holder,
    scopes: [...claim.scopes],
    fence: claim.fence,
    status: claim.status,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    ...(claim.endedBy === undefined ? {} : { endedBy: claim.endedBy }),
    ...(claim.reason === undefined ? {} : { reason: claim.reason }),
  };
}

function taskView(task: Task): TaskView {
  return {
    id: task.id,
    dependsOn: [...task.dependsOn],
    status: task.status,
    createdBy: task.createdBy,
    ...(task.integratedSha === undefined ? {} : { integratedSha: task.integratedSha }),
    ...(task.reopenings === undefined
      ? {}
      : {
          reopenings: task.reopenings.map(({ by, at, reason }) => ({
            by,
            at,
            ...(reason === undefined ? {} : { reason }),
          })),
        }),
  };
}

function projectIn(state: CoordinationState, projectId: string): Project {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  if (project) return project;
  throw refuse(404, "unknownProject", (m) =>
    m.coordination.project.unknown({ project: printable(projectId) }),
  );
}

function taskIn(project: Project, taskId: string): Task {
  const task = project.tasks.find((candidate) => candidate.id === taskId);
  if (task) return task;
  throw refuse(404, "unknownTask", (m) =>
    m.coordination.task.unknown({ task: printable(taskId) }),
  );
}

function claimIn(project: Project, id: string): Claim {
  const claim = project.claims.find((candidate) => candidate.id === id);
  if (claim) return claim;
  throw refuse(404, "unknownClaim", (m) => m.coordination.claim.unknown);
}

/** Refuses unless every task `task` depends on is integrated. */
function assertDependenciesIntegrated(project: Project, task: Task) {
  for (const dependencyId of task.dependsOn) {
    const dependency = project.tasks.find((candidate) => candidate.id === dependencyId);
    if (!dependency)
      throw refuse(409, "dependencyUnknown", (m) =>
        m.coordination.task.dependencyUnknown({ task: dependencyId }),
      );
    if (dependency.status === "failed")
      throw refuse(409, "dependencyFailed", (m) =>
        m.coordination.task.dependencyFailed({ task: dependencyId }),
      );
    if (dependency.status !== "integrated")
      throw refuse(409, "dependencyPending", (m) =>
        m.coordination.task.dependencyPending({ task: dependencyId }),
      );
  }
}

/** Refuses unless `claim` is held, by `who`, under `fence`. */
function assertHeldBy(claim: Claim, who: Participant, fence: unknown) {
  if (claim.status !== "held") throw refuse(409, "ended", (m) => m.coordination.claim.ended);
  if (claim.holder !== who.id)
    throw refuse(403, "notHolder", (m) => m.coordination.claim.notHolder);
  if (fence !== claim.fence)
    throw refuse(409, "staleFence", (m) => m.coordination.claim.staleFence, {
      fence: claim.fence,
    });
}

/** Ends what an integration began: the task, its claim and the branch move together. */
function completeIntegration(project: Project, now: string) {
  const pending = project.pending!;
  const claim = claimIn(project, pending.claimId);
  const task = taskIn(project, claim.taskId);
  claim.status = "integrated";
  claim.updatedAt = now;
  claim.endedBy = claim.holder;
  task.status = "integrated";
  task.integratedSha = pending.to;
  project.baseline.sha = pending.to;
  delete project.pending;
  return { claim, task };
}

export class Coordinator {
  #state: CoordinationState;
  /** Set once the file and memory may disagree; every request is refused with it. */
  #broken: AppError | undefined;
  readonly #file: string;
  readonly #options: CoordinatorOptions;
  readonly #write: typeof writeDurable;
  readonly #limits: CoordinationLimits;
  /** Settlements a project keeps; at least the one just made. */
  readonly #recoveries: number;
  readonly #recoveriesRoom: number;
  readonly #locks = new Map<string, Promise<unknown>>();
  /**
   * Projects whose interrupted integration opening could not settle from
   * the branch. Each stays closed, its intent and claims as written,
   * while it still has that intent: until an admin settles it.
   */
  readonly #undecided = new Set<string>();

  private constructor(options: CoordinatorOptions, state: CoordinationState) {
    this.#options = options;
    this.#file = dataPaths(options.dataDir).coordination;
    this.#write = options.write ?? writeDurable;
    this.#limits = limitsFrom(options.limits);
    this.#recoveries = Math.max(1, this.#limits.recoveries);
    this.#recoveriesRoom = recoveriesRoom(this.#recoveries);
    this.#state = state;
  }

  /** Sets coordination up in a data directory that has none. */
  static async create(options: CoordinatorOptions): Promise<Coordinator> {
    if (!holdsLock(options)) throw notSingleWriter();
    const file = dataPaths(options.dataDir).coordination;
    // The lock keeps every other BELL PR process out between check and write.
    if (await stat(file).then(() => true, () => false))
      throw refuse(409, "exists", (m) => m.coordination.store.exists);
    const state: CoordinationState = {
      format: "bellpr-coordination",
      version: 1,
      revision: 0,
      participants: [],
      projects: [],
    };
    const coordinator = new Coordinator(options, state);
    await coordinator.#write(file, coordinator.#writable(state, true));
    return coordinator;
  }

  /**
   * Reads the coordination file back and settles an integration a crash
   * interrupted. A missing file is refused, never taken as "no claims".
   */
  static async open(options: CoordinatorOptions): Promise<Coordinator> {
    if (!holdsLock(options)) throw notSingleWriter();
    let text: string;
    try {
      text = await readFile(dataPaths(options.dataDir).coordination, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw refuse(503, "missing", (m) => m.coordination.store.missing);
      throw damaged("unreadable", error);
    }
    const coordinator = new Coordinator(options, parseState(text, limitsFrom(options.limits)));
    await coordinator.#recover();
    return coordinator;
  }

  /**
   * An interrupted integration happened if the branch is at its change,
   * and did not if the branch is still at its base. Anything else, or a
   * branch that cannot be read, leaves it undecided: that project stays
   * closed until an admin settles it, and the others open.
   */
  async #recover() {
    const outcomes = new Map<string, boolean>();
    for (const project of this.#state.projects) {
      const pending = project.pending;
      if (!pending) continue;
      const head = await this.#branchHead(project).catch(() => undefined);
      if (head === pending.to) outcomes.set(project.id, true);
      else if (head === pending.from) outcomes.set(project.id, false);
      else this.#undecided.add(project.id);
    }
    if (!outcomes.size) return;
    await this.#mutate((draft, now) => {
      for (const project of draft.projects) {
        const happened = outcomes.get(project.id);
        if (happened === true) completeIntegration(project, now);
        else if (happened === false) delete project.pending;
      }
    });
  }

  /** Runs `task` after every earlier task with the same key has settled. */
  async #serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.#locks.set(key, current);
    try {
      return await current;
    } finally {
      if (this.#locks.get(key) === current) this.#locks.delete(key);
    }
  }

  /**
   * Applies `change` to a copy of the state, writes the copy durably and
   * only then makes it the state. A refusal from `change` or #writable
   * writes nothing; a failed write or a lost lock stops the coordinator,
   * because the file may now hold either version. `grows` marks a change
   * that adds something, which must leave the reserve free.
   */
  #mutate<T>(
    change: (draft: CoordinationState, now: string) => T,
    { grows = false }: { grows?: boolean } = {},
  ): Promise<T> {
    return this.#serial("state", async () => {
      this.#assertUsable();
      const draft = structuredClone(this.#state);
      draft.revision += 1;
      const result = change(draft, new Date().toISOString());
      const text = this.#writable(draft, grows);
      if (!holdsLock(this.#options)) {
        this.#broken = notSingleWriter();
        throw this.#broken;
      }
      try {
        await this.#write(this.#file, text);
      } catch (error) {
        this.#broken = unavailable(error);
        throw this.#broken;
      }
      this.#state = draft;
      return result;
    });
  }

  /**
   * The text to write for `state`, read back by the reader open() uses,
   * or a refusal while nothing has changed yet. No collection may grow
   * past its limit, and a change that adds must leave the reserve free.
   */
  #writable(state: CoordinationState, grows: boolean): string {
    const limit = overgrown(this.#state, state, this.#limits);
    if (limit) throw full(limit, this.#limits[limit]);
    const text = serialize(state);
    if (grows && Buffer.byteLength(text) + reserve(state, this.#recoveriesRoom) > this.#limits.bytes)
      throw full("bytes", this.#limits.bytes);
    try {
      parseState(text, this.#limits);
    } catch (error) {
      throw inconsistent(error);
    }
    return text;
  }

  /**
   * #mutate for a write that follows a branch update which may have
   * happened: unwritten, memory no longer tells where the branch is, so
   * coordination stops until opening again settles it from the branch.
   */
  async #settle<T>(change: (draft: CoordinationState, now: string) => T): Promise<T> {
    try {
      return await this.#mutate(change);
    } catch (error) {
      this.#broken ??= unavailable(error);
      throw this.#broken;
    }
  }

  #assertUsable() {
    if (this.#broken) throw this.#broken;
  }

  /** The participant behind an actor that authenticate() issued. */
  #who(actor: Actor, state: CoordinationState = this.#state): Participant {
    const participant = issuedActors.has(actor)
      ? state.participants.find((candidate) => candidate.id === actor.id)
      : undefined;
    if (!participant) throw unauthenticated();
    return participant;
  }

  /** The project, unless an integration into it is still undecided. */
  #openProject(state: CoordinationState, projectId: string): Project {
    const project = projectIn(state, projectId);
    if (this.#undecided.has(project.id) && project.pending)
      throw refuse(409, "recoveryUndecided", (m) =>
        m.coordination.recovery.undecided({ project: project.id }),
        { project: project.id },
      );
    return project;
  }

  /**
   * Git in the project's repository, which must be a bare one. Replace
   * refs, which anyone who can push may add, are never followed, nor is a
   * graft file (info/grafts, which takes write access to the repository
   * directory). Nor is a commit-graph read, one file or a split chain:
   * Git takes the parents and trees of the commits it walks to from it, and
   * the same access can write one. Every check and the branch update see
   * the commits and parents as they are. The git dir goes in one argument,
   * so process.ts still finds the command's name.
   */
  async #git(repository: string, args: string[], options: Parameters<typeof git>[2] = {}) {
    return await git(
      repository,
      [
        "--no-replace-objects",
        "-c",
        "advice.graftFileDeprecated=false",
        "-c",
        "core.commitGraph=false",
        `--git-dir=${repository}`,
        ...args,
      ],
      { ...options, env: { ...options.env, GIT_GRAFT_FILE: noGraftFile } },
    );
  }

  async #assertBare(repository: string) {
    const bare = await this.#git(repository, ["rev-parse", "--is-bare-repository"]).catch(
      () => undefined,
    );
    if (bare?.stdout.trim() !== "true")
      throw refuse(400, "invalidBaseline", (m) => m.coordination.project.invalidBaseline);
  }

  /** Where the project's integration branch points now; throws when unreadable. */
  async #branchHead(project: Project) {
    await this.#assertBare(project.baseline.repository);
    const { stdout } = await this.#git(project.baseline.repository, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      project.baseline.ref,
    ]);
    return stdout.trim();
  }

  /** Adds a participant and returns its token, which is never stored or shown again. */
  async addParticipant(participantId: string, role: Role) {
    const idValue = validId(participantId);
    if (role !== "member" && role !== "admin")
      throw refuse(400, "invalidId", (m) => m.coordination.invalidId({ id: printable(role) }));
    const token = `bpc_${randomBytes(32).toString("base64url")}`;
    await this.#mutate((draft, now) => {
      if (draft.participants.some((participant) => participant.id === idValue))
        throw refuse(409, "participantExists", (m) =>
          m.coordination.participant.exists({ id: idValue }),
        );
      draft.participants.push({ id: idValue, role, tokenHash: sha256Hex(token), createdAt: now });
    }, { grows: true });
    return { id: idValue, role, token };
  }

  /** The participant a token belongs to. */
  authenticate(token: unknown): Actor {
    this.#assertUsable();
    if (typeof token !== "string" || !tokenPattern.test(token)) throw unauthenticated();
    const digest = sha256Hex(token);
    let found: Participant | undefined;
    // Compares with every participant, so the time taken says nothing about which.
    for (const participant of this.#state.participants)
      if (digestsMatch(digest, participant.tokenHash)) found = participant;
    if (!found) throw unauthenticated();
    const actor: Actor = Object.freeze({ id: found.id, role: found.role });
    issuedActors.add(actor);
    return actor;
  }

  /**
   * Adds a project integrating into `branch` of the bare repository at
   * `repository`, starting from where that branch points now.
   */
  async defineProject(projectId: string, repository: string, branch: string) {
    const idValue = validId(projectId);
    const invalid = () =>
      refuse(400, "invalidBaseline", (m) => m.coordination.project.invalidBaseline);
    if (
      typeof repository !== "string" ||
      !path.isAbsolute(repository) ||
      typeof branch !== "string" ||
      !branchPattern.test(branch) ||
      /\.\.|\/\/|@\{|\.lock(?:\/|$)|[/.]$/.test(branch)
    )
      throw invalid();
    const location = await realpath(repository).catch(() => {
      throw invalid();
    });
    const ref = `refs/heads/${branch}`;
    await this.#assertBare(location);
    const head = await this.#git(location, ["rev-parse", "--verify", "--end-of-options", ref]).catch(
      () => {
        throw invalid();
      },
    );
    const baseline = { repository: location, ref, sha: head.stdout.trim() };
    if (!shaPattern.test(baseline.sha)) throw invalid();
    return await this.#mutate((draft) => {
      if (draft.projects.some((project) => project.id === idValue))
        throw refuse(409, "projectExists", (m) =>
          m.coordination.project.exists({ project: idValue }),
        );
      if (
        draft.projects.some(
          (project) => project.baseline.repository === location && project.baseline.ref === ref,
        )
      )
        throw refuse(409, "branchTaken", (m) => m.coordination.project.branchTaken);
      const project: Project = { id: idValue, baseline, fence: 0, tasks: [], claims: [] };
      draft.projects.push(project);
      return this.#projectView(project, draft.revision);
    }, { grows: true });
  }

  #projectView(project: Project, revision: number): ProjectView {
    const { pending, recoveries } = project;
    return {
      id: project.id,
      branch: { ref: project.baseline.ref, sha: project.baseline.sha },
      fence: project.fence,
      revision,
      tasks: project.tasks.map(taskView),
      claims: project.claims.map(claimView),
      ...(pending && this.#undecided.has(project.id) ? { undecided: pendingView(pending) } : {}),
      ...(recoveries ? { recoveries: recoveries.map(recoveryView) } : {}),
    };
  }

  /**
   * The project's branch, tasks and claims, as last written, and the
   * integration that keeps it closed, if any: reading never needs it open.
   */
  project(actor: Actor, projectId: string): ProjectView {
    this.#assertUsable();
    this.#who(actor);
    return this.#projectView(projectIn(this.#state, projectId), this.#state.revision);
  }

  /** Adds a task. Its dependencies must exist already, so they never form a cycle. */
  async defineTask(actor: Actor, projectId: string, input: { id: string; dependsOn?: string[] }) {
    const taskId = validId(input.id);
    if (!Array.isArray(input.dependsOn ?? []))
      throw refuse(400, "invalidId", (m) => m.coordination.invalidId({ id: "" }));
    const dependsOn = [...new Set((input.dependsOn ?? []).map(validId))];
    if (dependsOn.length > maxDependencies)
      throw refuse(400, "tooManyDependencies", (m) => m.coordination.task.tooManyDependencies);
    return await this.#mutate((draft, now) => {
      const who = this.#who(actor, draft);
      const project = this.#openProject(draft, projectId);
      if (project.tasks.some((task) => task.id === taskId))
        throw refuse(409, "taskExists", (m) => m.coordination.task.exists({ task: taskId }));
      for (const dependency of dependsOn)
        if (!project.tasks.some((task) => task.id === dependency))
          throw refuse(400, "dependencyUnknown", (m) =>
            m.coordination.task.dependencyUnknown({ task: dependency }),
          );
      const task: Task = { id: taskId, dependsOn, status: "open", createdBy: who.id, createdAt: now };
      project.tasks.push(task);
      return taskView(task);
    }, { grows: true });
  }

  /**
   * Grants the task's scopes to the actor, all of them or none: the task
   * must be open and unclaimed, each dependency integrated, and no held
   * claim may meet any scope.
   */
  async claim(actor: Actor, projectId: string, input: { taskId: string; scopes: string[] }) {
    const scopes = normalizeScopes(input.scopes);
    return await this.#mutate((draft, now) => {
      const who = this.#who(actor, draft);
      const project = this.#openProject(draft, projectId);
      const task = taskIn(project, input.taskId);
      if (task.status !== "open")
        throw refuse(409, "taskClosed", (m) => m.coordination.task.closed({ task: task.id }));
      if (project.claims.some((claim) => claim.status === "held" && claim.taskId === task.id))
        throw refuse(409, "taskClaimed", (m) => m.coordination.task.claimed({ task: task.id }));
      assertDependenciesIntegrated(project, task);
      this.#assertFree(project, scopes);
      project.fence += 1;
      const claim: Claim = {
        id: randomUUID(),
        taskId: task.id,
        holder: who.id,
        scopes,
        fence: project.fence,
        status: "held",
        createdAt: now,
        updatedAt: now,
      };
      project.claims.push(claim);
      return claimView(claim);
    }, { grows: true });
  }

  /** Refuses when a held claim other than `except` meets one of `scopes`. */
  #assertFree(project: Project, scopes: string[], except?: string) {
    const conflicts = meetingClaims(
      project.claims.filter((claim) => claim.status === "held" && claim.id !== except),
      scopes,
    );
    if (conflicts.length)
      throw refuse(409, "conflict", (m) => m.coordination.claim.conflict, {
        conflicts: conflicts.map((claim) => ({
          claimId: claim.id,
          taskId: claim.taskId,
          holder: claim.holder,
          scopes: claim.scopes,
        })),
      });
  }

  /**
   * Widens a held claim in one step: the new scopes are arbitrated with
   * the old ones held throughout, and a conflict changes nothing.
   */
  async expand(
    actor: Actor,
    projectId: string,
    id: string,
    input: { fence: number; scopes: string[] },
  ) {
    const added = normalizeScopes(input.scopes);
    return await this.#mutate((draft, now) => {
      const who = this.#who(actor, draft);
      const project = this.#openProject(draft, projectId);
      const claim = claimIn(project, id);
      assertHeldBy(claim, who, input.fence);
      const scopes = unionScopes(claim.scopes, added);
      if (scopes.length > maxScopes)
        throw refuse(400, "tooManyScopes", (m) => m.coordination.claim.tooManyScopes);
      this.#assertFree(project, scopes, claim.id);
      claim.scopes = scopes;
      claim.updatedAt = now;
      return claimView(claim);
    }, { grows: true });
  }

  /** The holder gives a claim up. */
  async release(actor: Actor, projectId: string, id: string, input: { fence: number }) {
    return await this.#serial(`integrate:${projectId}`, () =>
      this.#mutate((draft, now) => {
        const who = this.#who(actor, draft);
        const claim = claimIn(this.#openProject(draft, projectId), id);
        assertHeldBy(claim, who, input.fence);
        Object.assign(claim, { status: "released", updatedAt: now, endedBy: who.id });
        return claimView(claim);
      }),
    );
  }

  /** An admin ends someone's claim; its fence authorises nothing after this. */
  async revoke(actor: Actor, projectId: string, id: string, input: { reason?: string }) {
    const reason = input.reason === undefined ? undefined : String(input.reason).slice(0, maxReason);
    return await this.#serial(`integrate:${projectId}`, () =>
      this.#mutate((draft, now) => {
        const who = this.#who(actor, draft);
        if (who.role !== "admin")
          throw refuse(403, "adminOnly", (m) => m.coordination.participant.adminOnly);
        const claim = claimIn(this.#openProject(draft, projectId), id);
        if (claim.status !== "held")
          throw refuse(409, "ended", (m) => m.coordination.claim.ended);
        Object.assign(claim, {
          status: "revoked",
          updatedAt: now,
          endedBy: who.id,
          ...(reason === undefined ? {} : { reason }),
        });
        return claimView(claim);
      }),
    );
  }

  /**
   * Marks an open task failed, which stops every task depending on it, and
   * releases its claim. Its holder or an admin may do this.
   */
  async failTask(actor: Actor, projectId: string, taskId: string, input: { reason?: string }) {
    const reason = input.reason === undefined ? undefined : String(input.reason).slice(0, maxReason);
    return await this.#serial(`integrate:${projectId}`, () =>
      this.#mutate((draft, now) => {
        const who = this.#who(actor, draft);
        const project = this.#openProject(draft, projectId);
        const task = taskIn(project, taskId);
        if (task.status !== "open")
          throw refuse(409, "taskClosed", (m) => m.coordination.task.closed({ task: task.id }));
        const claim = project.claims.find(
          (candidate) => candidate.status === "held" && candidate.taskId === task.id,
        );
        if (who.role !== "admin" && claim?.holder !== who.id)
          throw refuse(403, "notFailable", (m) => m.coordination.task.notFailable);
        task.status = "failed";
        if (claim)
          Object.assign(claim, {
            status: "released",
            updatedAt: now,
            endedBy: who.id,
            ...(reason === undefined ? {} : { reason }),
          });
        return taskView(task);
      }),
    );
  }

  /**
   * An admin opens a failed task again. Its id, creator, dependencies and
   * every claim it had stay as they were: an ended claim stays ended, and
   * the next claim takes a fence higher than all of them. Reopening claims
   * nothing and reopens no task that depends on it; a new claim still
   * needs integrated dependencies and free scopes. Each reopening is kept
   * with who and when, and once a task has as many as the limit allows,
   * the next is refused rather than an old one dropped.
   */
  async reopenTask(actor: Actor, projectId: string, taskId: string, input: { reason?: string }) {
    const reason = input.reason === undefined ? undefined : String(input.reason).slice(0, maxReason);
    return await this.#mutate((draft, now) => {
      const who = this.#who(actor, draft);
      if (who.role !== "admin")
        throw refuse(403, "adminOnly", (m) => m.coordination.participant.adminOnly);
      const task = taskIn(this.#openProject(draft, projectId), taskId);
      if (task.status !== "failed")
        throw refuse(409, "notFailed", (m) => m.coordination.task.notFailed({ task: task.id }));
      const reopenings = task.reopenings ?? [];
      if (reopenings.length >= this.#limits.reopenings)
        throw full("reopenings", this.#limits.reopenings);
      task.status = "open";
      task.reopenings = [
        ...reopenings,
        { by: who.id, at: now, ...(reason === undefined ? {} : { reason }) },
      ];
      return taskView(task);
    }, { grows: true });
  }

  /**
   * The check a managed operation makes before it touches `paths`: the
   * claim is held by the actor under `fence`, and holds every path. It
   * answers for this moment only; a write that must not outlive a revoke
   * has to be fenced where it lands.
   */
  authorize(actor: Actor, projectId: string, input: { claimId: string; fence: number; paths: string[] }) {
    this.#assertUsable();
    const who = this.#who(actor);
    const project = this.#openProject(this.#state, projectId);
    const claim = claimIn(project, input.claimId);
    assertHeldBy(claim, who, input.fence);
    assertDependenciesIntegrated(project, taskIn(project, claim.taskId));
    if (!Array.isArray(input.paths) || input.paths.length > maxPaths)
      throw refuse(400, "unreliablePath", (m) =>
        m.coordination.claim.unreliablePath({ path: "" }),
      );
    const holds = scopesHolding(claim.scopes);
    for (const file of input.paths) this.#assertHolds(claim, file, holds);
    return { claimId: claim.id, fence: claim.fence };
  }

  #assertHolds(claim: Claim, file: unknown, holds = scopesHolding(claim.scopes)) {
    if (typeof file !== "string" || !comparablePath(file))
      throw refuse(400, "unreliablePath", (m) =>
        m.coordination.claim.unreliablePath({ path: printable(file) }),
      );
    if (!holds(file))
      throw refuse(403, "outOfScope", (m) =>
        m.coordination.claim.outOfScope({ path: printable(file) }),
        { path: file },
      );
  }

  /**
   * Moves the integration branch from `base` to `commit`, a linear series
   * of commits on `base` whose every changed path (both sides of a
   * rename, and files a later commit changes back) the claim holds. The
   * branch must still be where coordination last left it and at `base`;
   * otherwise the participant syncs onto the branch and tries again. The
   * move itself is a compare-and-swap, between saving the intent and
   * saving the outcome.
   */
  async integrate(
    actor: Actor,
    projectId: string,
    id: string,
    input: { fence: number; base: string; commit: string },
  ): Promise<IntegrationView> {
    this.#assertUsable();
    if (
      typeof input.base !== "string" ||
      typeof input.commit !== "string" ||
      !shaPattern.test(input.base) ||
      !shaPattern.test(input.commit)
    )
      throw refuse(400, "invalidCommit", (m) => m.coordination.integration.invalidCommit);
    const { base, commit } = input;
    return await this.#serial(`integrate:${projectId}`, async () => {
      this.#assertUsable();
      const who = this.#who(actor);
      const project = this.#openProject(this.#state, projectId);
      const claim = claimIn(project, id);
      assertHeldBy(claim, who, input.fence);
      const task = taskIn(project, claim.taskId);
      assertDependenciesIntegrated(project, task);
      const { repository, ref } = project.baseline;
      const head = await this.#branchHead(project);
      if (head !== project.baseline.sha)
        throw refuse(409, "baselineMoved", (m) => m.coordination.integration.baselineMoved);
      if (head !== base)
        throw refuse(409, "staleBase", (m) => m.coordination.integration.staleBase({ current: head }), {
          current: head,
        });
      await this.#checkChange(repository, claim, base, commit);

      await this.#mutate((draft, now) => {
        const current = this.#openProject(draft, projectId);
        assertHeldBy(claimIn(current, id), who, input.fence);
        current.pending = { claimId: id, fence: input.fence, from: base, to: commit, startedAt: now };
        // Its outcome must be writable as well, before the branch moves.
        const outcome = structuredClone(draft);
        outcome.revision += 1;
        completeIntegration(projectIn(outcome, projectId), now);
        this.#writable(outcome, false);
      });
      let moved: boolean;
      try {
        await this.#options.onStep?.("intent-saved");
        // Leave the branch alone once the lock is lost. This notices a
        // takeover that happened; it is no fence against one under way.
        if (!holdsLock(this.#options)) {
          this.#broken = notSingleWriter();
          throw this.#broken;
        }
        moved = await this.#swapBranch(repository, ref, base, commit, task.id);
        if (moved) await this.#options.onStep?.("ref-updated");
      } catch (error) {
        // Whether the branch moved is unknown now; opening again decides.
        this.#broken ??= unavailable(error);
        throw this.#broken;
      }
      if (!moved) {
        const after = await this.#branchHead(project).catch(() => undefined);
        if (after === undefined || after === commit) {
          this.#broken = unavailable(new Error("branch state unknown after a refused update"));
          throw this.#broken;
        }
        // The branch did not move to the change: nothing was integrated.
        await this.#settle((draft) => {
          delete projectIn(draft, projectId).pending;
        });
        if (after === base)
          throw refuse(503, "branchBusy", (m) => m.coordination.integration.branchBusy);
        throw refuse(409, "staleBase", (m) => m.coordination.integration.staleBase({ current: after }), {
          current: after,
        });
      }
      return await this.#settle((draft, now) => {
        const current = projectIn(draft, projectId);
        const done = completeIntegration(current, now);
        return {
          claim: claimView(done.claim),
          task: taskView(done.task),
          branch: { ref: current.baseline.ref, sha: current.baseline.sha },
        };
      });
    });
  }

  /** Refuses a change that is not a short linear series on `base` within the claim. */
  async #checkChange(repository: string, claim: Claim, base: string, commit: string) {
    const resolved = await this.#git(
      repository,
      ["rev-parse", "--verify", "--quiet", "--end-of-options", `${commit}^{commit}`],
      { allowedCodes: [0, 1] },
    );
    if (resolved.stdout.trim() !== commit)
      throw refuse(409, "unknownCommit", (m) => m.coordination.integration.unknownCommit);
    if (commit === base) throw refuse(400, "empty", (m) => m.coordination.integration.empty);
    const ancestor = await this.#git(repository, ["merge-base", "--is-ancestor", base, commit], {
      allowedCodes: [0, 1],
    });
    if (ancestor.code !== 0)
      throw refuse(409, "notFastForward", (m) => m.coordination.integration.notFastForward);
    const range = `${base}..${commit}`;
    const merges = await this.#git(repository, ["rev-list", "--merges", "--count", range]);
    if (merges.stdout.trim() !== "0")
      throw refuse(409, "mergeCommit", (m) => m.coordination.integration.mergeCommit);
    const count = await this.#git(repository, ["rev-list", "--count", range]);
    if (!(Number(count.stdout.trim()) <= maxCommits))
      throw refuse(409, "tooManyCommits", (m) => m.coordination.integration.tooManyCommits);
    // Each commit against its one parent, every path exactly as Git stores
    // it: renames as both sides, and a file a later commit changes back or
    // removes again still counts.
    const listed = await this.#git(repository, ["rev-list", "--reverse", "--parents", range]);
    const pairs = listed.stdout.split("\n").filter(Boolean).map((line) => line.split(" "));
    if (
      pairs.length !== Number(count.stdout.trim()) ||
      pairs.some((pair) => pair.length !== 2 || !pair.every((id) => shaPattern.test(id)))
    )
      throw unreadableChange();
    const changed = await this.#git(
      repository,
      ["diff-tree", "--stdin", "--always", "-r", "-z", "--raw", "--no-renames", "--no-ext-diff", "--no-textconv"],
      { input: pairs.map((pair) => `${pair.join(" ")}\n`).join("") },
    );
    const files = changedFiles(changed.stdout, pairs.map(([id]) => id));
    if (!files) throw unreadableChange();
    const holds = scopesHolding(claim.scopes);
    for (const file of files) {
      this.#assertHolds(claim, file.path, holds);
      const kind = heldBack(file.path, file.modes);
      if (kind)
        throw refuse(
          403,
          "needsManualHandling",
          (m) => m.coordination.integration.needsManualHandling({ path: printable(file.path) }),
          { path: file.path, kind },
        );
    }
  }

  /**
   * `git update-ref` with the old value: it moves the branch only if it
   * is still at `base`. Returns whether it moved.
   */
  async #swapBranch(repository: string, ref: string, base: string, commit: string, taskId: string) {
    const result = await this.#git(
      repository,
      ["update-ref", "-m", `bell-pr: integrate ${taskId}`, ref, commit, base],
      { allowedCodes: [0, 1, 128] },
    );
    return result.code === 0;
  }

  /**
   * An admin accepts where the branch points now after it moved outside
   * coordination, naming the commit they checked; claims stay as they are.
   */
  async adoptBaseline(actor: Actor, projectId: string, input: { sha: string }) {
    this.#assertUsable();
    if (typeof input.sha !== "string" || !shaPattern.test(input.sha))
      throw refuse(400, "invalidCommit", (m) => m.coordination.integration.invalidCommit);
    return await this.#serial(`integrate:${projectId}`, async () => {
      if (this.#who(actor).role !== "admin")
        throw refuse(403, "adminOnly", (m) => m.coordination.participant.adminOnly);
      const head = await this.#branchHead(this.#openProject(this.#state, projectId));
      if (head !== input.sha)
        throw refuse(409, "staleBase", (m) => m.coordination.integration.staleBase({ current: head }), {
          current: head,
        });
      return await this.#mutate((draft) => {
        const project = this.#openProject(draft, projectId);
        project.baseline.sha = head;
        return this.#projectView(project, draft.revision);
      });
    });
  }

  /**
   * An admin settles an integration that opening could not, naming the
   * intent the project shows and the commit the branch points at, which
   * must be one of the intent's two ends: at its change, the integration
   * completes; at its base, it never happened and the claim stays held
   * under the same fence. A branch anywhere else is refused, never
   * guessed at, moved or adopted. The settlement is kept with who made it
   * and when; once a project keeps as many as the limit allows, the
   * oldest is dropped, so settling is never refused for room.
   */
  async settleRecovery(
    actor: Actor,
    projectId: string,
    input: { claimId: string; fence: number; from: string; to: string; startedAt: string; head: string },
  ) {
    this.#assertUsable();
    if (
      [input.from, input.to, input.head].some(
        (value) => typeof value !== "string" || !shaPattern.test(value),
      )
    )
      throw refuse(400, "invalidCommit", (m) => m.coordination.integration.invalidCommit);
    return await this.#serial(`integrate:${projectId}`, async () => {
      this.#assertUsable();
      const who = this.#who(actor);
      if (who.role !== "admin")
        throw refuse(403, "adminOnly", (m) => m.coordination.participant.adminOnly);
      const named = (project: Project) => {
        const pending = this.#undecided.has(project.id) ? project.pending : undefined;
        if (!pending)
          throw refuse(409, "nothingToSettle", (m) => m.coordination.recovery.nothingToSettle);
        if (
          pending.claimId !== input.claimId ||
          pending.fence !== input.fence ||
          pending.from !== input.from ||
          pending.to !== input.to ||
          pending.startedAt !== input.startedAt
        )
          throw refuse(409, "stalePending", (m) => m.coordination.recovery.stalePending, {
            pending: pendingView(pending),
          });
        return pending;
      };
      const project = projectIn(this.#state, projectId);
      const pending = named(project);
      const head = await this.#branchHead(project).catch(() => {
        throw refuse(503, "branchUnreadable", (m) => m.coordination.recovery.branchUnreadable);
      });
      if (head !== pending.from && head !== pending.to)
        throw refuse(409, "branchElsewhere", (m) =>
          m.coordination.recovery.branchElsewhere({ current: head }),
          { current: head },
        );
      if (head !== input.head)
        throw refuse(409, "staleBase", (m) => m.coordination.integration.staleBase({ current: head }), {
          current: head,
        });
      const view = await this.#mutate((draft, now) => {
        const current = projectIn(draft, projectId);
        const { claimId, fence, from, to, startedAt } = named(current);
        const outcome = head === to ? "integrated" : "notIntegrated";
        if (outcome === "integrated") completeIntegration(current, now);
        else delete current.pending;
        const record: Recovery = { by: who.id, at: now, claimId, fence, from, to, startedAt, outcome };
        current.recoveries = [...(current.recoveries ?? []), record].slice(-this.#recoveries);
        return this.#projectView(current, draft.revision);
      });
      this.#undecided.delete(projectId);
      return view;
    });
  }
}
