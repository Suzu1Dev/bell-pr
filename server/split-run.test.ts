// Splitting a contribution into separate ones: each new contribution is a run
// of its own with a real branch and worktree, the original stays as it was,
// and a split that fails halfway leaves nothing behind. Fake codex, claude
// and gh come first on PATH, so the PR drafts the split starts cannot reach a
// real agent.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TeamTask } from "../shared/team.js";
import { readDiff } from "./git.js";
import { git } from "./process.js";
import { withLocale } from "./i18n/index.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { Workbench } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-split-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const groups = {
  a: ["web/a.js", "tests/a.test.js"],
  b: ["web/b.js", "tests/b.test.js"],
  c: ["web/c.js", "tests/c.test.js"],
};

const task = (id: string, owner: string, files: string[]): TeamTask => ({
  id,
  title: `Fix ${id}`,
  description: `What fix ${id} changes.`,
  owner,
  files,
  dependsOn: [],
  status: "complete",
  integratedFiles: files,
  report: `Report of ${id}.`,
});

/**
 * A repository, BELL PR's copy of it and a run in review whose worktree holds
 * three separate fixes: a modified source and test (a), two new files (b), and
 * a deleted source with a modified test (c).
 */
async function fixture(t: TestContext, dependencies: ConstructorParameters<typeof Workbench>[2] = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-split-"));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "web"), { recursive: true });
  await mkdir(path.join(repository, "tests"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  for (const [file, text] of [
    ["web/a.js", "export const a = 1;\n"],
    ["tests/a.test.js", "// a\n"],
    ["web/c.js", "export const c = 1;\n"],
    ["tests/c.test.js", "// c\n"],
    ["README.md", "# Project\n"],
  ])
    await writeFile(path.join(repository, file), text);
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);

  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store, undefined, dependencies);
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const baseSha = (await git(repo.path, ["rev-parse", "HEAD"])).stdout.trim();
  const id = "source-run-0001";
  const worktreePath = path.join(store.directory, "worktrees", id);
  await mkdir(path.dirname(worktreePath), { recursive: true });
  await git(repo.path, ["worktree", "add", "-b", "fix/source01", worktreePath, baseSha]);
  await writeFile(path.join(worktreePath, "web/a.js"), "export const a = 2;\n");
  await writeFile(path.join(worktreePath, "tests/a.test.js"), "// a changed\n");
  await writeFile(path.join(worktreePath, "web/b.js"), "export const b = 1;\n");
  await writeFile(path.join(worktreePath, "tests/b.test.js"), "// b\n");
  await rm(path.join(worktreePath, "web/c.js"));
  await writeFile(path.join(worktreePath, "tests/c.test.js"), "// c changed\n");

  const run: Run = {
    id,
    repoId: repo.id,
    title: "Three fixes",
    prompt: "Fix a, b and c.",
    status: "review",
    branch: "fix/source01",
    baseBranch: "main",
    baseSha,
    worktreePath,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    locale: "en",
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "complete", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "complete", detail: "" },
      { id: "member-1", name: "One", role: "Developer", status: "complete", detail: "" },
      { id: "member-2", name: "Two", role: "Developer", status: "complete", detail: "" },
      { id: "member-3", name: "Three", role: "Developer", status: "complete", detail: "" },
    ],
    logs: [],
    draft: { title: "Three fixes", body: "Fixes a, b and c." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: { lead: "Lead report.", a: "Report of a.", b: "Report of b.", c: "Report of c." },
    team: {
      config: { maxTeammates: 3, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase: "complete",
      planSummary: "Three fixes.",
      tasks: [task("a", "member-1", groups.a), task("b", "member-2", groups.b), task("c", "member-3", groups.c)],
      messages: [],
    },
  };
  store.data.runs.push(run);
  const files = await readDiff(run);
  // The person reviewed web/a.js as it is, and tests/b.test.js as it was before an edit.
  run.reviewedFingerprints = {
    "web/a.js": files.find((file) => file.path === "web/a.js")!.fingerprint,
    "tests/b.test.js": "an-older-fingerprint",
  };
  run.reviewedFiles = Object.keys(run.reviewedFingerprints);
  return { directory, store, workbench, repo, run, files };
}

const en = <T>(work: () => Promise<T>) => withLocale("en", work);
const refused = (status: number, pattern: RegExp) => (error: unknown) =>
  error instanceof AppError && error.statusCode === status && pattern.test(error.message);

/** The paths and content fingerprints of a run's diff, by path. */
async function fingerprints(run: Pick<Run, "worktreePath" | "baseSha" | "locale">) {
  return new Map((await readDiff(run)).map((file) => [file.path, file.fingerprint]));
}

const three = [
  { title: "Fix a", paths: groups.a },
  { title: "Fix b", paths: groups.b },
  { title: "Fix c", paths: groups.c },
];

test("a split makes one contribution per group on the same base, with exactly its files, and leaves the original as it was", async (t) => {
  const f = await fixture(t);
  const before = await fingerprints(f.run);
  assert.equal(before.size, 6);

  const { run, created } = await en(() => f.workbench.split(f.run.id, { contributions: three }));

  assert.equal(created.length, 3);
  for (const [index, contribution] of created.entries()) {
    const expected = Object.values(groups)[index];
    assert.equal(contribution.status, "review");
    assert.equal(contribution.baseSha, f.run.baseSha);
    assert.equal(contribution.baseBranch, "main");
    assert.match(contribution.branch, /^fix\/[0-9a-f]{8}$/);
    assert.notEqual(contribution.branch, f.run.branch);
    assert.deepEqual(contribution.splitFrom, { runId: f.run.id, title: "Three fixes" });
    assert.equal(contribution.title, three[index].title);
    // A real worktree whose diff is exactly these files, with the original's content.
    assert.ok((await stat(contribution.worktreePath)).isDirectory());
    const copied = await fingerprints(contribution);
    assert.deepEqual([...copied.keys()].sort(), [...expected].sort());
    for (const [file, fingerprint] of copied) assert.equal(fingerprint, before.get(file), file);
  }

  // The original keeps every file and only records the split.
  assert.equal(run, f.run);
  assert.deepEqual(await fingerprints(f.run), before);
  assert.deepEqual(run.splitInto, created.map((made) => ({ runId: made.id, title: made.title })));
  assert.equal(run.status, "review");
  assert.equal(run.draft.body, "Fixes a, b and c.");
  // They are listed in the order the person gave, ahead of the original.
  assert.deepEqual(f.store.data.runs.slice(0, 4).map((made) => made.id), [...created.map((made) => made.id), f.run.id]);
});

test("a contribution carries the tasks, reports and review marks of its files, and nothing that belongs to the whole change", async (t) => {
  const f = await fixture(t);
  const { created } = await en(() => f.workbench.split(f.run.id, { contributions: three }));
  const [a, b] = created;

  assert.deepEqual(a.team?.tasks.map((item) => item.id), ["a"]);
  assert.deepEqual(a.team?.tasks[0].integratedFiles, groups.a);
  assert.deepEqual(Object.keys(a.reports ?? {}), ["a"]);
  assert.deepEqual(a.agents.map((agent) => [agent.id, agent.status]), [
    ["lead", "complete"],
    ["reviewer", "waiting"],
    ["tester", "waiting"],
    ["member-1", "complete"],
  ]);
  assert.match(a.prompt, /^Fix a\n\nWhat fix a changes\.$/);
  // The review mark of a file whose content is unchanged moves with it; a stale one does not.
  assert.deepEqual(Object.keys(a.reviewedFingerprints), ["web/a.js"]);
  assert.deepEqual(a.reviewedFiles, ["web/a.js"]);
  assert.deepEqual(b.reviewedFingerprints, {});
  for (const made of created) {
    assert.deepEqual(made.draft, { title: made.title, body: "" });
    assert.equal(made.approvedFingerprint, undefined);
    assert.equal(made.understanding, undefined);
    assert.equal(made.reports?.lead, undefined);
    assert.equal(made.prUrl, undefined);
    assert.equal(made.logs.length, 1);
  }
});

test("each new contribution starts preparing its PR draft", { timeout: 20_000 }, async (t) => {
  const asked = new Set<string>();
  let allAsked!: () => void;
  const everyDraftAsked = new Promise<void>((resolve) => (allAsked = resolve));
  const f = await fixture(t, {
    // Reading the project's rules is the first thing a draft does; it stands in for the whole draft.
    collectDraftContext: async (_repo, run) => {
      asked.add(run.worktreePath);
      if (asked.size === 3) allAsked();
      throw new Error("no draft in tests");
    },
  });
  const { created } = await en(() => f.workbench.split(f.run.id, { contributions: three }));
  await everyDraftAsked;
  assert.deepEqual([...asked].sort(), created.map((made) => made.worktreePath).sort());
});

test("files can be left out, and a held-back file can only be left out", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.run.worktreePath, ".env"), "TOKEN=abc\n");
  const two = (paths: string[]) => [
    { title: "Fix a", paths: groups.a },
    { title: "Fix b", paths },
  ];
  await assert.rejects(
    en(() => f.workbench.split(f.run.id, { contributions: two([".env"]) })),
    refused(422, /"\.env" is held back from review/),
  );
  assert.equal(f.store.data.runs.length, 1);

  const { created } = await en(() => f.workbench.split(f.run.id, { contributions: two(groups.b) }));
  assert.deepEqual(
    [...(await fingerprints(created[1])).keys()].sort(),
    [...groups.b].sort(),
  );
  // What was left out (c and the held-back file) exists only in the original.
  assert.equal((await fingerprints(created[0])).has("web/c.js"), false);
});

test("a split refuses what cannot be split, and changes nothing", async (t) => {
  const f = await fixture(t);
  const attempt = (contributions: { title: string; paths: string[] }[]) =>
    en(() => f.workbench.split(f.run.id, { contributions }));
  const pair = [
    { title: "Fix a", paths: groups.a },
    { title: "Fix b", paths: groups.b },
  ];

  await assert.rejects(
    attempt([pair[0], { title: "Fix b", paths: ["nope.js"] }]),
    refused(422, /"nope\.js" is not a changed file of this contribution/),
  );
  await assert.rejects(
    attempt([pair[0], { title: "Fix b", paths: ["web/a.js"] }]),
    refused(422, /"web\/a\.js" is in more than one contribution/),
  );
  await assert.rejects(
    en(() => f.workbench.split("no-such-run", { contributions: pair })),
    (error: unknown) => error instanceof AppError && error.statusCode === 404,
  );

  for (const [change, undo, status, pattern] of [
    [() => (f.run.learnByHand = true), () => delete f.run.learnByHand, 409, /Learn by hand/],
    [() => (f.run.status = "published"), () => (f.run.status = "review"), 409, /Wait for the run/],
    [() => (f.run.prUrl = "https://github.com/o/r/pull/1"), () => delete f.run.prUrl, 409, /already published/],
    [() => (f.run.publishedBranch = "fix/x"), () => delete f.run.publishedBranch, 409, /already published/],
    [() => (f.run.workspaceRemovedAt = new Date().toISOString()), () => delete f.run.workspaceRemovedAt, 410, /./],
  ] as const) {
    change();
    await assert.rejects(attempt(pair), refused(status, pattern));
    undo();
  }

  // Nothing was made: no run, no worktree, no branch, and the original is untouched.
  assert.equal(f.store.data.runs.length, 1);
  assert.equal(f.run.splitInto, undefined);
  assert.deepEqual(await readdir(path.join(f.store.directory, "worktrees")), ["source-run-0001"]);
  const branches = (await git(f.repo.path, ["branch", "--list", "fix/*"])).stdout;
  assert.deepEqual(branches.split("\n").map((line) => line.replace(/^[*+ ]+/, "")).filter(Boolean), ["fix/source01"]);
});

test("a contribution that was split cannot be split again, but its parts can", async (t) => {
  const f = await fixture(t);
  const { created } = await en(() => f.workbench.split(f.run.id, { contributions: three }));
  await assert.rejects(
    en(() => f.workbench.split(f.run.id, { contributions: three.slice(0, 2) })),
    refused(409, /already split into 3/),
  );
  const [a] = created;
  const again = await en(() =>
    f.workbench.split(a.id, {
      contributions: [
        { title: "Source of a", paths: ["web/a.js"] },
        { title: "Test of a", paths: ["tests/a.test.js"] },
      ],
    }),
  );
  assert.deepEqual(again.created.map((made) => made.splitFrom?.runId), [a.id, a.id]);
});

test("a split that fails halfway removes what it made and leaves the original alone", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const before = await fingerprints(f.run);
  // A git that fails the second `git worktree add`, as a full disk or a locked repository would.
  // git() puts its own -c settings first, so the pair is looked for anywhere in the arguments.
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const bin = await mkdtemp(path.join(os.tmpdir(), "bell-split-git-"));
  const counter = path.join(bin, "count");
  await writeFile(
    path.join(bin, "git"),
    `#!/bin/sh
for arg in "$@"; do
  if [ "$previous" = "worktree" ] && [ "$arg" = "add" ]; then
    n=$(cat '${counter}' 2>/dev/null || echo 0); n=$((n + 1)); echo $n > '${counter}'
    if [ "$n" = "2" ]; then echo "disk full" >&2; exit 1; fi
  fi
  previous="$arg"
done
exec '${realGit}' "$@"
`,
    { mode: 0o755 },
  );
  const path_ = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${path_}`;
  t.after(async () => {
    process.env.PATH = path_;
    await rm(bin, { recursive: true, force: true });
  });

  await assert.rejects(en(() => f.workbench.split(f.run.id, { contributions: three })), /disk full/);

  process.env.PATH = path_;
  assert.equal(f.store.data.runs.length, 1);
  assert.equal(f.run.splitInto, undefined);
  assert.deepEqual(await fingerprints(f.run), before);
  assert.deepEqual(await readdir(path.join(f.store.directory, "worktrees")), ["source-run-0001"]);
  const branches = (await git(f.repo.path, ["branch", "--list", "fix/*"])).stdout;
  assert.deepEqual(branches.split("\n").map((line) => line.replace(/^[*+ ]+/, "")).filter(Boolean), ["fix/source01"]);
});

test("the links a split records survive a restart, and a value this build cannot read is left out without losing the run", async (t) => {
  const f = await fixture(t);
  const { created } = await en(() => f.workbench.split(f.run.id, { contributions: three }));
  // Finish the background work before the files are read.
  await f.workbench.shutdown();
  const reload = async () => {
    const store = new Store(f.store.directory);
    await store.initialize();
    return store;
  };
  const loaded = await reload();
  assert.deepEqual(
    loaded.data.runs.find((run) => run.id === f.run.id)?.splitInto,
    created.map((made) => ({ runId: made.id, title: made.title })),
  );
  assert.deepEqual(loaded.data.runs.find((run) => run.id === created[0].id)?.splitFrom, {
    runId: f.run.id,
    title: "Three fixes",
  });

  // A later build may write something this build cannot read: the field goes, the run stays.
  const stateFile = path.join(f.store.directory, "state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.runs.find((run: { id: string }) => run.id === f.run.id).splitInto = "not a list";
  await writeFile(stateFile, JSON.stringify(state));
  const damaged = await reload();
  const original = damaged.data.runs.find((run) => run.id === f.run.id);
  assert.equal(original?.title, "Three fixes");
  assert.equal(original?.splitInto, undefined);
  assert.equal(damaged.recovery, undefined);
});

/** The branches BELL made for contributions, as `git branch` lists them without its markers. */
async function contributionBranches(repoPath: string) {
  const listed = (await git(repoPath, ["branch", "--list", "fix/*"])).stdout;
  return listed.split("\n").map((line) => line.replace(/^[*+ ]+/, "")).filter(Boolean);
}

test("a run saved without a plan splits too: the contributions have files and no plan", async (t) => {
  const f = await fixture(t);
  // `team` is optional on a run, and nothing about a split needs it.
  delete f.run.team;
  const before = await fingerprints(f.run);
  const { created } = await en(() => f.workbench.split(f.run.id, { contributions: three }));

  assert.equal(created.length, 3);
  for (const [index, made] of created.entries()) {
    assert.equal(made.team, undefined);
    assert.equal(made.status, "review");
    assert.deepEqual(made.agents.map((agent) => agent.id), ["lead", "reviewer", "tester"]);
    const copied = await fingerprints(made);
    assert.deepEqual([...copied.keys()].sort(), [...Object.values(groups)[index]].sort());
    for (const [file, fingerprint] of copied) assert.equal(fingerprint, before.get(file), file);
  }
  assert.equal(f.run.splitInto?.length, 3);
});

test("a contribution that fails after its checkout exists leaves no checkout or branch behind", async (t) => {
  const f = await fixture(t);
  // A function cannot be cloned, so building the first contribution's record fails after the
  // branch, the worktree and the files were made. (Saved runs hold plain data; this only forces the failure.)
  Object.assign(f.run, { modelExecution: { provider: "codex", unclonable() {} } });
  const before = await fingerprints(f.run);

  await assert.rejects(en(() => f.workbench.split(f.run.id, { contributions: three })), /clone/i);

  assert.equal(f.store.data.runs.length, 1);
  assert.equal(f.run.splitInto, undefined);
  assert.deepEqual(await fingerprints(f.run), before);
  assert.deepEqual(await readdir(path.join(f.store.directory, "worktrees")), ["source-run-0001"]);
  assert.deepEqual(await contributionBranches(f.repo.path), ["fix/source01"]);
});

test("a split waits until a sync's conflict markers are resolved, so no part carries them past the conflict check", async (t) => {
  const f = await fixture(t);
  // A sync onto a newer target branch left markers in web/a.js.
  await writeFile(
    path.join(f.run.worktreePath, "web/a.js"),
    "<<<<<<< ours\nexport const a = 2;\n=======\nexport const a = 3;\n>>>>>>> main\n",
  );
  const at = new Date().toISOString();
  const sha = f.run.baseSha;
  f.run.sync = { at, from: sha, to: sha, snapshot: sha, conflicts: ["web/a.js"] };

  await assert.rejects(
    en(() => f.workbench.split(f.run.id, { contributions: three })),
    refused(409, /merge conflict markers: .*web\/a\.js/),
  );
  assert.equal(f.store.data.runs.length, 1);
  assert.equal(f.run.splitInto, undefined);
  assert.deepEqual(await readdir(path.join(f.store.directory, "worktrees")), ["source-run-0001"]);
  assert.deepEqual(await contributionBranches(f.repo.path), ["fix/source01"]);

  // Once the person resolves the conflict, the split goes ahead.
  await writeFile(path.join(f.run.worktreePath, "web/a.js"), "export const a = 3;\n");
  const { created } = await en(() => f.workbench.split(f.run.id, { contributions: three }));
  assert.equal(created.length, 3);
});

test("an explanation the original is still writing is asked for again in the part, not left waiting on the original's job", async (t) => {
  const f = await fixture(t);
  const fingerprint = f.files.find((file) => file.path === "web/a.js")!.fingerprint;
  // The original's explanation job is writing web/a.js; it only ever writes to the original.
  f.run.explanations = { "web/a.js": { fingerprint, status: "generating" } };
  const { created } = await en(() => f.workbench.split(f.run.id, { contributions: three }));
  const [a] = created;

  assert.equal(a.explanations?.["web/a.js"]?.status, "pending");
  assert.equal(f.run.explanations["web/a.js"].status, "generating");
  // Asking for the part's explanations starts its own job (the fake agent fails it), so the
  // file no longer looks as if it were being written.
  const { files } = await en(() => f.workbench.explanations(a.id));
  assert.equal(files.find((file) => file.path === "web/a.js")?.explanationStatus, "failed");
});

test("a checkout that fails after git made its branch leaves no branch behind", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  // A git whose `git worktree add` does its work and then fails, as one stopped by the
  // timeout or a full disk would after the branch exists.
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const bin = await mkdtemp(path.join(os.tmpdir(), "bell-split-git-"));
  await writeFile(
    path.join(bin, "git"),
    `#!/bin/sh
for arg in "$@"; do
  if [ "$previous" = "worktree" ] && [ "$arg" = "add" ]; then
    '${realGit}' "$@"; echo "checkout stopped" >&2; exit 1
  fi
  previous="$arg"
done
exec '${realGit}' "$@"
`,
    { mode: 0o755 },
  );
  const path_ = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${path_}`;
  t.after(async () => {
    process.env.PATH = path_;
    await rm(bin, { recursive: true, force: true });
  });

  await assert.rejects(en(() => f.workbench.split(f.run.id, { contributions: three })), /checkout stopped/);

  process.env.PATH = path_;
  assert.equal(f.store.data.runs.length, 1);
  assert.deepEqual(await readdir(path.join(f.store.directory, "worktrees")), ["source-run-0001"]);
  assert.deepEqual(await contributionBranches(f.repo.path), ["fix/source01"]);
});
