// Two contributions of one person in this BELL PR (server/group-local.ts):
// which other runs of the project hold paths a plan or a change meets, when
// a published one stops counting, and the parts of a split that must be
// merged first. Real repositories and worktrees, no network.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dropSplitLinks } from "../shared/split.js";
import type { TeamTask } from "../shared/team.js";
import { localOverlaps, localPublishChecks, pathsMeet, planOverlaps, splitOrder, type LocalScope } from "./group-local.js";
import { withLocale } from "./i18n/index.js";
import { git } from "./process.js";
import { directoryScopes } from "./team.js";
import { approvePlan } from "./team-plan.js";
import { AppError, type DiffFile, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench-context.js";

const task = (id: string, files: string[]): TeamTask => ({
  id,
  title: id,
  description: id,
  owner: "member-1",
  files,
  dependsOn: [],
  status: "pending",
});

/** A project with web/, docs/ and a README, and a way to make runs with checkouts of their own. */
async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-group-local-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repoPath = path.join(directory, "repo");
  await mkdir(path.join(repoPath, "web"), { recursive: true });
  await mkdir(path.join(repoPath, "docs"), { recursive: true });
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.name", "BELL Test"]);
  await git(repoPath, ["config", "user.email", "test@example.invalid"]);
  for (const [file, text] of [
    ["web/a.js", "export const a = 1;\n"],
    ["web/b.js", "export const b = 1;\n"],
    ["docs/guide.md", "# Guide\n"],
    ["README.md", "# Project\n"],
  ])
    await writeFile(path.join(repoPath, file), text);
  await git(repoPath, ["add", "--", "."]);
  await git(repoPath, ["commit", "-m", "initial"]);
  const baseSha = (await git(repoPath, ["rev-parse", "HEAD"])).stdout.trim();
  const repo = { id: "repo-1", path: repoPath } as Repository;
  let count = 0;
  /** A run whose checkout starts at `base` and has `changes` (null deletes a file); committed when `commit`. */
  const run = async (
    fields: Partial<Run>,
    changes: Record<string, string | null> = {},
    { base = baseSha, commit = false } = {},
  ): Promise<Run> => {
    const id = `run-${++count}`;
    const worktreePath = path.join(directory, "worktrees", id);
    await git(repoPath, ["worktree", "add", "-b", `fix/${id}`, worktreePath, base]);
    for (const [file, text] of Object.entries(changes))
      if (text === null) await rm(path.join(worktreePath, file));
      else await writeFile(path.join(worktreePath, file), text);
    let publishCommit: string | undefined;
    if (commit) {
      await git(worktreePath, ["add", "-A"]);
      await git(worktreePath, ["commit", "-m", id]);
      publishCommit = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    }
    return {
      id,
      repoId: repo.id,
      title: `Run ${count}`,
      prompt: "",
      status: "review",
      branch: `fix/${id}`,
      baseBranch: "main",
      baseSha: base,
      worktreePath,
      createdAt: new Date().toISOString(),
      agents: [],
      logs: [],
      draft: { title: "", body: "" },
      reviewedFiles: [],
      reviewedFingerprints: {},
      ...(publishCommit ? { publishCommit } : {}),
      ...fields,
    };
  };
  /** A commit on main with `changes`, as a squash merge would make it. */
  const advance = async (changes: Record<string, string>) => {
    for (const [file, text] of Object.entries(changes)) await writeFile(path.join(repoPath, file), text);
    await git(repoPath, ["commit", "-am", "upstream"]);
    return (await git(repoPath, ["rev-parse", "HEAD"])).stdout.trim();
  };
  /** What a check reads, over `runs`. */
  const scope = (runs: Run[]): LocalScope => ({ runs, repo, directory });
  return { directory, repo, baseSha, run, advance, scope };
}

test("paths meet when they are the same, when one is a directory of the other, and in any ASCII case", () => {
  assert.equal(pathsMeet("web/a.js", "web/a.js"), true);
  assert.equal(pathsMeet("web/", "web/a.js"), true);
  assert.equal(pathsMeet("web/a.js", "web/"), true);
  // A file and a directory cannot share a name, so an exact name meets what is below it.
  assert.equal(pathsMeet("web", "web/a.js"), true);
  assert.equal(pathsMeet("web/", "web"), true);
  assert.equal(pathsMeet("README.md", "readme.MD"), true);
  assert.equal(pathsMeet("web/", "web2/a.js"), false);
  assert.equal(pathsMeet("web/a.js", "web/a.jsx"), false);
  // Only ASCII is folded, as every build folds it alike.
  assert.equal(pathsMeet("docs/Ä.md", "docs/ä.md"), false);
});

test("another run's changed files and planned scopes meet a plan, task by task; finished, foreign and split runs do not", async (t) => {
  const f = await fixture(t);
  const mine = await f.run({ status: "awaiting_plan" });
  const tasks = [task("web", ["web/a.js"]), task("docs", ["docs/"])];
  const reviewing = await f.run({ title: "Fix a" }, { "web/a.js": "export const a = 2;\n", "README.md": "# Changed\n" });
  const planning = await f.run({
    status: "awaiting_plan",
    title: "Docs plan",
    team: { tasks: [task("guide", ["docs/guide.md"])] } as Run["team"],
  });
  const failed = await f.run({ status: "failed" }, { "web/a.js": "failed\n" });
  const foreign = await f.run({ repoId: "repo-2" }, { "web/a.js": "foreign\n" });
  const part = await f.run({ splitFrom: { runId: mine.id, title: mine.title } }, { "web/a.js": "part\n" });
  const runs = [mine, reviewing, planning, failed, foreign, part];

  const overlaps = await localOverlaps(f.scope(runs), mine, tasks.flatMap((entry) => entry.files), tasks);
  assert.deepEqual(overlaps, [
    { runId: reviewing.id, title: "Fix a", status: "review", paths: ["web/a.js"], taskIds: ["web"] },
    { runId: planning.id, title: "Docs plan", status: "awaiting_plan", paths: ["docs/guide.md"], taskIds: ["docs"] },
  ]);
  // A new untracked file counts as a change.
  const added = await f.run({ title: "New page" }, { "web/new.js": "new\n" });
  assert.deepEqual(
    (await localOverlaps(f.scope([mine, added]), mine, ["web/"])).map((overlap) => overlap.paths),
    [["web/new.js"]],
  );
  assert.deepEqual(await localOverlaps(f.scope(runs), mine, ["web/b.js"]), []);
});

test("a published run counts until its change is in the checked run's base, or its PR was read as merged or closed", async (t) => {
  const f = await fixture(t);
  const published = await f.run(
    { status: "published", title: "Published fix", prUrl: "https://github.com/o/r/pull/1" },
    { "web/a.js": "export const a = 2;\n" },
    { commit: true },
  );
  const mine = await f.run({}, { "web/a.js": "export const a = 3;\n" });
  const files = ["web/a.js"];
  assert.equal((await localOverlaps(f.scope([mine, published]), mine, files)).length, 1);

  // A squash merge: the base has the published content, but not the commit.
  const squashed = await f.advance({ "web/a.js": "export const a = 2;\n" });
  const rebased = await f.run({ baseSha: squashed }, {}, { base: squashed });
  assert.deepEqual(await localOverlaps(f.scope([rebased, published]), rebased, files), []);
  // A later change to the file on main does not undo the merge: the history has the content.
  const later = await f.advance({ "web/a.js": "export const a = 4;\n" });
  const newer = await f.run({}, {}, { base: later });
  assert.deepEqual(await localOverlaps(f.scope([newer, published]), newer, files), []);
  // A merge commit brings the published commit itself into the base, even
  // when the file changed again after the merge.
  await git(f.repo.path, ["merge", "--no-ff", "-X", "theirs", "-m", "merge", published.publishCommit!]);
  const afterMerge = await f.run({}, {}, { base: await f.advance({ "web/a.js": "export const a = 5;\n" }) });
  assert.deepEqual(await localOverlaps(f.scope([afterMerge, published]), afterMerge, files), []);
  // Reading the PR as merged or closed is enough.
  for (const prFeedback of [{ prState: "MERGED" }, { prState: "CLOSED" }, { merged: true }]) {
    const read = { ...published, prFeedback: { fetchedAt: "", prNumber: 1, items: [], ...prFeedback } };
    assert.deepEqual(await localOverlaps(f.scope([mine, read]), mine, files), [], JSON.stringify(prFeedback));
  }
});

test("a part waits for the parts it builds on until they are merged; a deleted part leaves the list", async (t) => {
  const f = await fixture(t);
  const first = await f.run({ title: "Part one" }, { "web/a.js": "export const a = 2;\n" });
  const second = await f.run({ title: "Part two", group: { after: [first.id, "deleted-part"] } }, { "web/b.js": "b\n" });
  assert.deepEqual(await splitOrder(f.scope([first, second]), second), [
    { id: first.id, title: "Part one", status: "review", prUrl: undefined },
  ]);
  const merged = {
    ...first,
    status: "published" as const,
    prUrl: "https://github.com/o/r/pull/2",
    prFeedback: { fetchedAt: "", prNumber: 2, items: [], prState: "MERGED" },
  };
  assert.deepEqual(await splitOrder(f.scope([merged, second]), second), []);
  // A part closed without merging is still not in the project.
  const closed = { ...merged, prFeedback: { ...merged.prFeedback, prState: "CLOSED" } };
  assert.equal((await splitOrder(f.scope([closed, second]), second)).length, 1);

  const files = [{ path: "web/b.js" }, { path: "web/a.js" }] as DiffFile[];
  const checks = await withLocale("en", () => localPublishChecks(f.scope([first, second]), second, files));
  assert.deepEqual(checks.map((check) => [check.id, check.kind]), [
    ["group-own-overlap", "confirm"],
    ["split-order", "confirm"],
  ]);
  assert.deepEqual(checks[0].details, ['"Part one" (in review): web/a.js']);
  assert.deepEqual(checks[1].details, ['"Part one": not published yet']);

  // Deleting a part drops it from the parts that build on it, and an empty record goes.
  dropSplitLinks(second, "deleted-part");
  assert.deepEqual(second.group, { after: [first.id] });
  dropSplitLinks(second, first.id);
  assert.equal("group" in second, false);
});

test("a plan scope written without a slash reads as the directory it is in the base commit", async (t) => {
  const f = await fixture(t);
  const mine = await f.run({});
  const tasks = [task("one", ["web", "README.md", "src/new", "docs/"]), task("two", ["web", "web/"])];
  assert.deepEqual(await directoryScopes(mine.worktreePath, f.baseSha, tasks), ["web"]);
  assert.deepEqual(tasks.map((entry) => entry.files), [
    ["web/", "README.md", "src/new", "docs/"],
    ["web/"],
  ]);
  // Nothing to look up, or nothing that can be: the scopes stay.
  assert.deepEqual(await directoryScopes(mine.worktreePath, "0".repeat(40), [task("x", ["web"])]), []);
});

test("a published run's files come from its pull request, and only a file whose change is merged stops counting", async (t) => {
  const f = await fixture(t);
  const published = await f.run(
    { status: "published", title: "Two files" },
    { "web/a.js": "export const a = 2;\n", "web/b.js": "export const b = 2;\n" },
    { commit: true },
  );
  // Freeing its checkout keeps what the pull request changes.
  await git(f.repo.path, ["worktree", "remove", "--force", published.worktreePath]);
  const removed = { ...published, workspaceRemovedAt: new Date().toISOString() };
  const mine = await f.run({});
  assert.deepEqual(
    (await localOverlaps(f.scope([mine, removed]), mine, ["web/"])).map((overlap) => overlap.paths),
    [["web/a.js", "web/b.js"]],
  );
  // Main took web/a.js as published (a partial cherry-pick or a squash of part of it).
  const picked = await f.advance({ "web/a.js": "export const a = 2;\n" });
  const later = await f.run({}, {}, { base: picked });
  assert.deepEqual(
    (await localOverlaps(f.scope([later, removed]), later, ["web/"])).map((overlap) => overlap.paths),
    [["web/b.js"]],
  );
  // An unpublished run whose checkout was removed can no longer reach the project.
  const gone = { ...(await f.run({ title: "Gone" }, { "web/a.js": "gone\n" })), workspaceRemovedAt: new Date().toISOString() };
  assert.deepEqual(await localOverlaps(f.scope([mine, gone]), mine, ["web/a.js"]), []);
});

test("a split never counts against itself at any depth, and an original that was split holds only what no part holds", async (t) => {
  const f = await fixture(t);
  const original = await f.run({ title: "Original" }, { "web/a.js": "a\n", "web/b.js": "b\n" });
  const part = await f.run({ title: "Part", splitFrom: { runId: original.id, title: "Original" } }, { "web/a.js": "a\n" });
  const subpart = await f.run({ title: "Subpart", splitFrom: { runId: part.id, title: "Part" } }, { "web/a.js": "a\n" });
  original.splitInto = [{ runId: part.id, title: "Part" }];
  part.splitInto = [{ runId: subpart.id, title: "Subpart" }];
  const runs = [original, part, subpart];
  assert.deepEqual(await localOverlaps(f.scope(runs), subpart, ["web/a.js"]), []);
  assert.deepEqual(await localOverlaps(f.scope(runs), original, ["web/a.js"]), []);
  // An unrelated run sees the part that holds web/a.js, and the original for the file it kept.
  const other = await f.run({});
  assert.deepEqual(
    (await localOverlaps(f.scope([...runs, other]), other, ["web/"])).map((overlap) => [overlap.title, overlap.paths]),
    [
      ["Original", ["web/b.js"]],
      ["Subpart", ["web/a.js"]],
    ],
  );
  // Once the subpart is deleted, its file is the part's, and with the part gone too, the original's.
  part.splitInto = undefined;
  assert.deepEqual(
    (await localOverlaps(f.scope([original, part, other]), other, ["web/"])).map((overlap) => [overlap.title, overlap.paths]),
    [
      ["Original", ["web/b.js"]],
      ["Part", ["web/a.js"]],
    ],
  );
  original.splitInto = undefined;
  assert.deepEqual(
    (await localOverlaps(f.scope([original, other]), other, ["web/"])).map((overlap) => [overlap.title, overlap.paths]),
    [["Original", ["web/a.js", "web/b.js"]]],
  );
});

test("a plan counts while it is to be carried out: an agent plan before its team is done, a Learn-by-hand plan while the person writes", async (t) => {
  const f = await fixture(t);
  const mine = await f.run({});
  const plan = { phase: "complete", tasks: [task("old", ["web/"])] } as unknown as Run["team"];
  // A follow-up round on a published run: its old plan scopes are not what it changes now.
  const followUp = await f.run(
    { status: "running", title: "Follow-up", team: plan, followUps: [{ id: "r1", status: "running" }] as Run["followUps"] },
    { "README.md": "# Follow-up\n" },
  );
  const byHand = await f.run({
    status: "review",
    title: "By hand",
    learnByHand: true,
    byHand: { plan: { steps: [{ id: "s1", title: "Edit", files: ["docs/guide.md"] }] } } as Run["byHand"],
  });
  const runs = [mine, followUp, byHand];
  assert.deepEqual(await localOverlaps(f.scope(runs), mine, ["web/a.js"]), []);
  assert.deepEqual(
    (await localOverlaps(f.scope(runs), mine, ["README.md", "docs/guide.md"])).map((overlap) => [overlap.title, overlap.paths]),
    [
      ["Follow-up", ["README.md"]],
      ["By hand", ["docs/guide.md"]],
    ],
  );
});

test("reading another run's checkout leaves its index alone", async (t) => {
  const f = await fixture(t);
  const other = await f.run({ title: "Other" }, { "web/a.js": "changed\n" });
  // A file with the base's content but a new time: a diff would refresh the index for it.
  const old = new Date(Date.now() - 86_400_000);
  await utimes(path.join(other.worktreePath, "web/b.js"), old, old);
  const index = (await git(other.worktreePath, ["rev-parse", "--git-path", "index"])).stdout.trim();
  const indexPath = path.resolve(other.worktreePath, index);
  const before = { bytes: await readFile(indexPath), time: (await stat(indexPath)).mtimeMs };
  const mine = await f.run({});
  assert.deepEqual(
    (await localOverlaps(f.scope([mine, other]), mine, ["web/"])).map((overlap) => overlap.paths),
    [["web/a.js"]],
  );
  assert.deepEqual(await readFile(indexPath), before.bytes);
  assert.equal((await stat(indexPath)).mtimeMs, before.time);
  // The copy it diffed against is gone.
  assert.deepEqual((await readdir(f.directory)).filter((name) => name.startsWith("group-index-")), []);
});

test("a change made in the same instant as the checkout's index is still seen", async (t) => {
  const f = await fixture(t);
  const other = await f.run({ title: "Same instant" });
  const file = path.join(other.worktreePath, "web/a.js");
  const index = path.resolve(
    other.worktreePath,
    (await git(other.worktreePath, ["rev-parse", "--git-path", "index"])).stdout.trim(),
  );
  // The file, its index entry and the index all carry one time, and the change keeps the
  // size and that time: only Git's content check of a "racily clean" entry finds it. A
  // rewrite always moves the change time, which cannot be set back, so Git is told not to
  // compare it, as when both land in one tick of the clock.
  await git(f.repo.path, ["config", "core.trustctime", "false"]);
  const then = new Date("2020-01-01T00:00:00Z");
  await utimes(file, then, then);
  await git(other.worktreePath, ["update-index", "--refresh"]);
  await utimes(index, then, then);
  await writeFile(file, "export const a = 9;\n");
  await utimes(file, then, then);
  const mine = await f.run({});
  assert.deepEqual(
    (await localOverlaps(f.scope([mine, other]), mine, ["web/a.js"])).map((overlap) => overlap.paths),
    [["web/a.js"]],
  );
});

/** A context with what approving a plan uses, over `runs`. */
function context(f: Awaited<ReturnType<typeof fixture>>, runs: Run[]) {
  return {
    store: { data: { runs, repos: [f.repo] }, directory: f.directory, save: async () => {} },
    lock: <T>(_key: string, task: () => Promise<T>) => task(),
    run: (id: string) => runs.find((run) => run.id === id)!,
    repo: () => f.repo,
    log: (run: Run, agent: string, message: string, entry?: Pick<Run["logs"][number], "kind">) =>
      run.logs.push({ time: new Date().toISOString(), agent, message, ...entry }),
    enqueue: () => {},
  } as unknown as WorkbenchContext;
}

const refused = (pattern: RegExp) => (error: unknown) =>
  error instanceof AppError && error.statusCode === 409 && pattern.test(error.message);

test("approving a plan that meets another contribution needs the digest of the overlaps the person saw", async (t) => {
  const f = await fixture(t);
  const earlier = await f.run({ title: "Earlier" }, { "web/a.js": "earlier\n" });
  const team = () => ({ config: {}, phase: "awaiting_approval", planSummary: "", tasks: [task("web", ["web/a.js"])], messages: [] }) as unknown as Run["team"];
  const plan = await f.run({ status: "awaiting_plan", team: team() });
  const ctx = context(f, [earlier, plan]);
  const { digest } = await planOverlaps(ctx, plan);
  await withLocale("en", async () => {
    await assert.rejects(approvePlan(ctx, plan.id), refused(/change files this plan covers: "Earlier"/));
    await assert.rejects(approvePlan(ctx, plan.id, { overlapDigest: "0".repeat(64) }), refused(/changed since you confirmed/));
    // A Stop during the check is not undone by the approval.
    const approving = approvePlan(ctx, plan.id, { overlapDigest: digest });
    plan.status = "cancelled";
    await assert.rejects(approving, refused(/No team plan is waiting/));
    assert.equal(plan.status, "cancelled");
    plan.status = "awaiting_plan";
    await approvePlan(ctx, plan.id, { overlapDigest: digest });
  });
  assert.equal(plan.status, "queued");
  assert.ok(plan.logs.some((entry) => entry.kind === "notice" && /Approved although "Earlier"/.test(entry.message)));

  // Learn by hand: the steps' files are checked the same way.
  const byHand = await f.run({
    status: "awaiting_plan",
    learnByHand: true,
    team: team(),
    byHand: { plan: { steps: [{ id: "s1", title: "Edit a", files: ["web/a.js"] }] } } as Run["byHand"],
  });
  const own = context(f, [earlier, byHand]);
  await withLocale("en", async () => {
    await assert.rejects(approvePlan(own, byHand.id), refused(/change files this plan covers/));
    await approvePlan(own, byHand.id, { overlapDigest: (await planOverlaps(own, byHand)).digest });
  });
  assert.equal(byHand.status, "review");
  assert.ok(byHand.byHand?.plan?.confirmedAt);
});

test("a squash-merged file stays merged however often its other files change later, and only main's own history counts", async (t) => {
  const f = await fixture(t);
  const published = await f.run(
    { status: "published", title: "Two files" },
    { "web/a.js": "export const a = 2;\n", "README.md": "# Two\n" },
    { commit: true },
  );
  await f.advance({ "web/a.js": "export const a = 2;\n", "README.md": "# Two\n" });
  await f.advance({ "web/a.js": "export const a = 5;\n" });
  let base = "";
  for (let entry = 0; entry < 3; entry++) base = await f.advance({ "README.md": `# Entry ${entry}\n` });
  const mine = await f.run({}, {}, { base });
  assert.deepEqual(await localOverlaps(f.scope([mine, published]), mine, ["web/a.js", "README.md"]), []);

  // A deletion counts as merged only when main itself deleted the file.
  const deleting = await f.run({ status: "published", title: "Deletes the guide" }, { "docs/guide.md": null }, { commit: true });
  const unmerged = await f.run({}, {}, { base });
  assert.deepEqual(
    (await localOverlaps(f.scope([unmerged, deleting]), unmerged, ["docs/"])).map((overlap) => overlap.paths),
    [["docs/guide.md"]],
  );
  await rm(path.join(f.repo.path, "docs/guide.md"));
  await git(f.repo.path, ["commit", "-am", "remove the guide"]);
  const after = await f.run({}, {}, { base: await f.advance({ "README.md": "# After\n" }) });
  assert.deepEqual(await localOverlaps(f.scope([after, deleting]), after, ["docs/"]), []);
  // Added back later: any commit may have deleted it once, so the deletion counts again.
  await writeFile(path.join(f.repo.path, "docs/guide.md"), "# Guide again\n");
  await git(f.repo.path, ["add", "docs/guide.md"]);
  await git(f.repo.path, ["commit", "-m", "add the guide back"]);
  const readded = await f.run({}, {}, { base: (await git(f.repo.path, ["rev-parse", "HEAD"])).stdout.trim() });
  assert.deepEqual(
    (await localOverlaps(f.scope([readded, deleting]), readded, ["docs/"])).map((overlap) => overlap.paths),
    [["docs/guide.md"]],
  );
});

test("a run with a pull request holds what the PR changes, its own later commits included, and no longer its plan", async (t) => {
  const f = await fixture(t);
  const mine = await f.run({});
  // A Learn-by-hand PR whose author committed one more file in its folder.
  const byHand = await f.run(
    {
      status: "published",
      title: "By hand",
      learnByHand: true,
      byHand: { plan: { steps: [{ id: "s1", title: "Plan", files: ["docs/guide.md"] }] } } as Run["byHand"],
    },
    { "web/a.js": "export const a = 2;\n" },
    { commit: true },
  );
  await writeFile(path.join(byHand.worktreePath, "web/b.js"), "export const b = 2;\n");
  await git(byHand.worktreePath, ["commit", "-am", "one more"]);
  assert.deepEqual(
    (await localOverlaps(f.scope([mine, byHand]), mine, ["web/", "docs/"])).map((overlap) => overlap.paths),
    [["web/a.js", "web/b.js"]],
  );
  // In a sync round (status review) its old plan does not come back; with its folder freed, the PR still counts.
  const syncing = { ...byHand, status: "review" as const, followUps: [{ id: "s", kind: "sync", status: "review" }] as Run["followUps"] };
  assert.deepEqual(
    (await localOverlaps(f.scope([mine, syncing]), mine, ["docs/guide.md"])),
    [],
  );
  const freed = { ...syncing, workspaceRemovedAt: new Date().toISOString() };
  assert.deepEqual(
    (await localOverlaps(f.scope([mine, freed]), mine, ["web/"])).map((overlap) => overlap.paths),
    [["web/a.js", "web/b.js"]],
  );
});

test("an untracked directory counts once, and the digest stays while a confirmed run's agents add files", async (t) => {
  const f = await fixture(t);
  const other = await f.run({ title: "Writing", status: "running", team: { phase: "developing", tasks: [task("w", ["web/"])] } as unknown as Run["team"] });
  await mkdir(path.join(other.worktreePath, "web/new"), { recursive: true });
  for (let n = 0; n < 3; n++) await writeFile(path.join(other.worktreePath, `web/new/${n}.js`), "x\n");
  const plan = await f.run({ status: "awaiting_plan", team: { phase: "awaiting_approval", tasks: [task("p", ["web/"])] } as unknown as Run["team"] });
  const ctx = context(f, [other, plan]);
  const first = await planOverlaps(ctx, plan);
  assert.deepEqual(first.overlaps.map((overlap) => overlap.paths), [["web/", "web/new/"]]);
  await writeFile(path.join(other.worktreePath, "web/b.js"), "more\n");
  const second = await planOverlaps(ctx, plan);
  assert.deepEqual(second.overlaps.map((overlap) => overlap.paths), [["web/", "web/b.js", "web/new/"]]);
  assert.equal(second.digest, first.digest);
});
