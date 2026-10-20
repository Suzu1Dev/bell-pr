// Follow-up commits of a published Learn-by-hand run, made and pushed with
// the person's own Git from the run's folder (plan README §18.9): BELL takes
// them over at the next feedback read and before a PR sync, and only when
// they are on the PR branch. Unpushed commits, a branch that moved on
// without them, a dirty folder and rewritten history leave everything as it
// is (a notice on the feedback read, a refusal before a sync). Agent runs
// behave as before. A local bare repository stands in for GitHub (fake git
// and gh); fake codex and claude come first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { byHandClean } from "../shared/by-hand.js";
import { changeFingerprint } from "../shared/understanding.js";
import { fakeGitHub } from "../test/fake-github.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { adoptRemoteCommits } from "./pr-branch.js";
import { git } from "./process.js";
import { publishChecks } from "./publish.js";
import { Store } from "./store.js";
import { AppError, type Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  skipUnderstandingCheckInTests(true);
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-takeover-bin-"));
  for (const name of ["codex", "claude"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  skipUnderstandingCheckInTests();
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const refused = (message: RegExp) => (error: unknown) =>
  error instanceof AppError && error.statusCode === 409 && message.test(error.message);
const en = <T>(fn: () => Promise<T>) => withLocale("en", fn);
const branch = "fix/lbh0001";
const prUrl = "https://github.com/test-owner/example/pull/1";
const pushFirst = /^Push your commits first; BELL PR takes them over once they are on the pull request's branch\./;
const commitFirst = /^Commit or discard your changes in the run's folder first\./;
const pullFirst = /^The pull request's branch has commits the run's folder doesn't have yet\./;
const rewritten = /rewrote history that BELL PR pushed/;
const remoteMoved = /^The PR branch fix\/lbh0001 on GitHub has commits from outside BELL PR/;

/** What the fake gh answers to the feedback read: an open PR with no feedback yet. */
const feedback = {
  data: {
    repository: {
      pullRequest: {
        url: prUrl,
        state: "OPEN",
        merged: false,
        reviewDecision: null,
        labels: { totalCount: 0, nodes: [] },
        reviews: { totalCount: 0, nodes: [] },
        comments: { totalCount: 0, nodes: [] },
        reviewThreads: { totalCount: 0, nodes: [] },
        commits: { nodes: [] },
      },
    },
  },
};

/** A run published as a Draft PR through the fake GitHub; a Learn-by-hand run unless `agent`. */
async function published(t: TestContext, { agent = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-takeover-"));
  const github = await fakeGitHub(directory, {
    files: { "src/retry.ts": "export const attempts = 1;\n", "README.md": "# Example\n" },
  });
  // The fake gh answers the PR feedback query too; everything else goes to fakeGitHub's gh.
  const feedbackBin = path.join(directory, "feedback-bin");
  await mkdir(feedbackBin);
  await writeFile(
    path.join(feedbackBin, "gh"),
    `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.some((arg) => arg.startsWith('query=query BellPrFeedback'))) {
  console.log(${JSON.stringify(JSON.stringify(feedback))});
  process.exit(0);
}
process.exit(spawnSync(${JSON.stringify(path.join(directory, "fake-bin", "gh"))}, args, { stdio: 'inherit' }).status ?? 1);
`,
    { mode: 0o700 },
  );
  process.env.PATH = `${feedbackBin}${path.delimiter}${process.env.PATH}`;
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  t.after(async () => {
    await workbench.shutdown();
    github.restore();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(github.url);
  const baseSha = (await git(repo.path, ["rev-parse", "HEAD"])).stdout.trim();
  const worktreePath = path.join(store.directory, "worktrees", "takeover-run");
  await git(repo.path, ["worktree", "add", "-q", "-b", branch, worktreePath, baseSha]);
  await git(worktreePath, ["config", "user.name", "BELL Test"]);
  await git(worktreePath, ["config", "user.email", "test@example.invalid"]);
  const run: Run = {
    id: "takeover-run",
    repoId: repo.id,
    title: "Retry twice",
    prompt: "Retry a GET twice after a 503.",
    status: "review",
    branch,
    baseBranch: "main",
    baseSha,
    worktreePath,
    createdAt: new Date().toISOString(),
    locale: "en",
    ...(agent ? {} : { learnByHand: true as const }),
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "" },
    ],
    logs: [],
    draft: { title: "Retry a GET twice", body: "Retries a GET twice after a 503." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {},
    team: {
      config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase: "developing",
      planSummary: "",
      tasks: [],
      messages: [],
    },
    ...(agent
      ? {}
      : {
          byHand: {
            plan: { steps: [{ id: "s1", title: "Retry the GET" }], savedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() },
            events: [{ at: new Date().toISOString(), kind: "explain", source: "premise" }],
          },
        }),
  };
  store.data.runs.push(run);
  const write = (file: string, content: string) => writeFile(path.join(worktreePath, file), content);
  await write("src/retry.ts", "export const attempts = 2;\n");
  if (!agent) await en(async () => workbench.byHand.ready(run.id, { changeFingerprint: changeFingerprint(await readDiff(run)), review: false }));
  for (const file of await readDiff(run)) await workbench.review(run.id, file.path, true, file.fingerprint);
  await en(() => workbench.approve(run.id, { ...run.draft }));
  const checks = await publishChecks(run, await readDiff(run), store.directory, "en", { repo });
  assert.deepEqual(checks.filter((check) => check.kind === "block").map((check) => check.id), []);
  const acknowledged = checks.filter((check) => check.kind === "confirm").map((check) => check.id);
  await en(() => workbench.publish(run.id, run.approvedFingerprint!, acknowledged));
  assert.equal(run.status, "published");
  assert.equal(run.prUrl, prUrl);
  /** The person commits in the run's folder with their own Git, and pushes when asked to. */
  const commit = async (content: string, message: string, push = true) => {
    await write("src/retry.ts", content);
    await git(worktreePath, ["commit", "-q", "-am", message]);
    if (push) await git(worktreePath, ["push", "-q", github.url, `HEAD:refs/heads/${branch}`]);
    return (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  };
  const head = async () => (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  return { directory, github, store, workbench, repo, run, write, commit, head };
}

type Published = Awaited<ReturnType<typeof published>>;

/**
 * Runs `script` (sh) once, as BELL's next fetch starts: GitHub's branch
 * moving, or the person saving or committing in the run's folder, while
 * BELL looks. `$GIT` is the fake GitHub's git; `$BARE` its repository.
 */
async function onNextFetch(t: TestContext, f: Published, script: string) {
  const bin = await mkdtemp(path.join(f.directory, "on-fetch-"));
  const marker = path.join(bin, "done");
  await writeFile(
    path.join(bin, "git"),
    [
      "#!/bin/sh",
      `GIT=${JSON.stringify(path.join(f.directory, "fake-bin", "git"))}`,
      `BARE=${JSON.stringify(f.github.bare)}`,
      'for arg in "$@"; do',
      `  if [ "$arg" = fetch ] && [ ! -e ${JSON.stringify(marker)} ]; then`,
      `    : > ${JSON.stringify(marker)}`,
      `    ${script}`,
      "    break",
      "  fi",
      "done",
      'exec "$GIT" "$@"',
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous}`;
  t.after(() => {
    process.env.PATH = previous;
  });
}

/** A commit made from `files` on `parent` in the run's folder, which stays where it was; on GitHub only under `refs/heads/side`. */
async function sideCommit(f: Published, parent: string, files: Record<string, string>, message: string) {
  const worktree = f.run.worktreePath;
  const before = await f.head();
  await git(worktree, ["checkout", "-q", "--detach", parent]);
  for (const [file, content] of Object.entries(files)) await f.write(file, content);
  await git(worktree, ["add", "--", ...Object.keys(files)]);
  await git(worktree, ["commit", "-q", "-m", message]);
  const commit = await f.head();
  await git(worktree, ["checkout", "-q", branch]);
  assert.equal(await f.head(), before);
  await git(worktree, ["push", "-q", "--force", f.github.url, `${commit}:refs/heads/side`]);
  return commit;
}

test("commits pushed from the run's folder are taken over at the feedback read, and a sync then works", async (t) => {
  const f = await published(t);
  const pushedByBell = f.run.publishCommit!;
  const events = structuredClone(f.run.byHand?.events);
  const mine = await f.commit("export const attempts = 3;\n", "Retry three times");
  const read = await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.ok(read.prFeedback?.fetchedAt);
  const round = f.run.followUps!.at(-1)!;
  assert.deepEqual(
    { kind: round.kind, adopted: round.adopted, status: round.status, parent: round.parentCommit, commit: round.commit },
    { kind: "sync", adopted: true, status: "published", parent: pushedByBell, commit: mine },
  );
  assert.equal(round.report, "Took over 1 commit you pushed from the run's folder to the pull request's branch.");
  assert.equal(f.run.publishCommit, mine);
  assert.equal(await f.head(), mine);
  // The log says it in Learn-by-hand words, never "reviewed with the next round".
  assert.ok(f.run.logs.some((entry) => entry.message === round.report));
  assert.ok(!f.run.logs.some((entry) => /reviewed with the next round/.test(entry.message)));
  // The takeover changes neither the claim's history nor the help record.
  assert.deepEqual(byHandClean(f.run), { clean: true });
  assert.deepEqual(f.run.byHand?.events, events);
  // A second read has nothing more to take over.
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.followUps!.length, 1);
  // The PR sync now starts from the person's pushed commit.
  const upstream = await f.github.upstreamCommit({ "README.md": "# Example, upstream\n" });
  const synced = await en(() => f.workbench.syncRun(f.run.id));
  assert.equal(synced.updated, true);
  assert.equal(f.run.followUps!.at(-1)!.parentCommit, mine);
  assert.equal(f.run.followUps!.at(-1)!.mergeParent, upstream);
  assert.deepEqual(byHandClean(f.run), { clean: true });
});

test("a sync takes over pushed commits first, too", async (t) => {
  const f = await published(t);
  const mine = await f.commit("export const attempts = 3;\n", "Retry three times");
  await f.github.upstreamCommit({ "README.md": "# Example, upstream\n" });
  assert.equal((await en(() => f.workbench.syncRun(f.run.id))).updated, true);
  assert.equal(f.run.followUps![0].adopted, true);
  assert.equal(f.run.followUps![0].commit, mine);
  assert.equal(f.run.followUps![1].parentCommit, mine);
});

test("commits not pushed yet stay where they are: a notice on the feedback read, a refusal before a sync", async (t) => {
  const f = await published(t);
  const pushedByBell = f.run.publishCommit!;
  const mine = await f.commit("export const attempts = 3;\n", "Retry three times", false);
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.ok(f.run.prFeedback?.fetchedAt);
  assert.equal(f.run.publishCommit, pushedByBell);
  assert.equal(await f.head(), mine);
  assert.equal(f.run.followUps, undefined);
  assert.match(f.run.logs.at(-2)?.message ?? "", pushFirst);
  assert.equal(f.run.logs.at(-2)?.kind, "notice");
  await assert.rejects(en(() => f.workbench.syncRun(f.run.id)), refused(pushFirst));
  assert.equal(await f.head(), mine);
  // Pushed, it is taken over.
  await git(f.run.worktreePath, ["push", "-q", f.github.url, `HEAD:refs/heads/${branch}`]);
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.publishCommit, mine);
});

test("a dirty folder is left alone with its own notice and refusal", async (t) => {
  const f = await published(t);
  const pushedByBell = f.run.publishCommit!;
  const mine = await f.commit("export const attempts = 3;\n", "Retry three times");
  await f.write("src/retry.ts", "export const attempts = 4;\n");
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.publishCommit, pushedByBell);
  assert.equal(await f.head(), mine);
  assert.match(f.run.logs.at(-2)?.message ?? "", commitFirst);
  await assert.rejects(en(() => f.workbench.syncRun(f.run.id)), refused(commitFirst));
});

test("a branch that moved on without the folder's commits asks for a pull first", async (t) => {
  const f = await published(t);
  const pushedByBell = f.run.publishCommit!;
  const mine = await f.commit("export const attempts = 3;\n", "Retry three times");
  await f.github.pushToBranch(branch, { "NOTES.md": "A maintainer's note.\n" });
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.publishCommit, pushedByBell);
  assert.equal(await f.head(), mine);
  assert.match(f.run.logs.at(-2)?.message ?? "", pullFirst);
  await assert.rejects(en(() => f.workbench.syncRun(f.run.id)), refused(pullFirst));
});

test("history rewritten with a force push is refused and moves nothing", async (t) => {
  const f = await published(t);
  const pushedByBell = f.run.publishCommit!;
  await git(f.run.worktreePath, ["reset", "-q", "--hard", f.run.baseSha]);
  await f.write("src/retry.ts", "export const attempts = 5;\n");
  await git(f.run.worktreePath, ["commit", "-q", "-am", "Start again"]);
  await git(f.run.worktreePath, ["push", "-q", "--force", f.github.url, `HEAD:refs/heads/${branch}`]);
  const rewrittenHead = await f.head();
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.publishCommit, pushedByBell);
  assert.equal(await f.head(), rewrittenHead);
  assert.match(f.run.logs.at(-2)?.message ?? "", rewritten);
  await assert.rejects(en(() => f.workbench.syncRun(f.run.id)), refused(rewritten));
  assert.equal(f.run.followUps, undefined);
});

test("a fetch that fails on the way moves nothing: a notice on the feedback read, the refusal before a sync", async (t) => {
  const f = await published(t);
  const pushedByBell = f.run.publishCommit!;
  const mine = await f.commit("export const attempts = 3;\n", "Retry three times");
  // GitHub answers ls-remote, then the network drops during the fetch.
  const flaky = path.join(f.directory, "flaky-bin");
  await mkdir(flaky);
  await writeFile(
    path.join(flaky, "git"),
    `#!/bin/sh\nfor arg in "$@"; do [ "$arg" = fetch ] && { echo "fatal: unable to access the repository" >&2; exit 128; }; done\nexec ${JSON.stringify(path.join(f.directory, "fake-bin", "git"))} "$@"\n`,
    { mode: 0o700 },
  );
  const previous = process.env.PATH;
  process.env.PATH = `${flaky}${path.delimiter}${previous}`;
  t.after(() => {
    process.env.PATH = previous;
  });
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.ok(f.run.prFeedback?.fetchedAt);
  assert.equal(f.run.logs.at(-2)?.kind, "notice");
  assert.match(f.run.logs.at(-2)?.message ?? "", /unable to access the repository/);
  await assert.rejects(en(() => f.workbench.syncRun(f.run.id)), (error) => error instanceof AppError && /unable to access/.test(error.message));
  assert.equal(f.run.publishCommit, pushedByBell);
  assert.equal(await f.head(), mine);
  assert.equal(f.run.followUps, undefined);
  // Back online, it is taken over.
  process.env.PATH = previous;
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.publishCommit, mine);
});

test("a run whose folder was removed reads its feedback as before, with no takeover and no notice", async (t) => {
  const f = await published(t);
  await git(f.repo.path, ["worktree", "remove", "--force", f.run.worktreePath]);
  f.run.workspaceRemovedAt = new Date().toISOString();
  const logged = f.run.logs.length;
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.ok(f.run.prFeedback?.fetchedAt);
  // Only the feedback read's own line.
  assert.equal(f.run.logs.length, logged + 1);
  assert.equal(f.run.followUps, undefined);
});

test("an agent run's checkout is never taken over: the feedback read and the sync behave as before", async (t) => {
  const f = await published(t, { agent: true });
  const pushedByBell = f.run.publishCommit!;
  await f.commit("export const attempts = 3;\n", "Retry three times");
  const logged = f.run.logs.length;
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.publishCommit, pushedByBell);
  // Only the feedback read's own line.
  assert.equal(f.run.logs.length, logged + 1);
  await assert.rejects(
    en(() => f.workbench.syncRun(f.run.id)),
    refused(/^The working directory differs from the pushed PR/),
  );
  assert.equal(f.run.followUps, undefined);
});

test("a force push while BELL looks, which keeps BELL's push but drops the person's commits, moves nothing", async (t) => {
  const f = await published(t);
  const pushedByBell = f.run.publishCommit!;
  const mine = await f.commit("export const attempts = 3;\n", "Retry three times");
  // Between BELL's look (the branch is the folder's HEAD) and its fetch, the branch is forced to
  // a commit on BELL's push that the person's commit isn't in.
  const forced = await sideCommit(f, pushedByBell, { "NOTES.md": "Rewritten on GitHub.\n" }, "Rewritten on GitHub");
  const force = `"$GIT" --git-dir="$BARE" update-ref refs/heads/${branch} ${forced}`;
  await onNextFetch(t, f, force);
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.ok(f.run.prFeedback?.fetchedAt);
  assert.equal(await f.head(), mine);
  assert.equal(f.run.publishCommit, pushedByBell);
  assert.equal(f.run.followUps, undefined);
  // What the branch holds now decides the notice: it has a commit the folder lacks.
  assert.match(f.run.logs.at(-2)?.message ?? "", pullFirst);
  // The same race before a sync is refused, and nothing moves either.
  await git(f.run.worktreePath, ["push", "-q", "--force", f.github.url, `${mine}:refs/heads/${branch}`]);
  await onNextFetch(t, f, force);
  await assert.rejects(en(() => f.workbench.syncRun(f.run.id)), refused(pullFirst));
  assert.equal(await f.head(), mine);
  assert.equal(f.run.publishCommit, pushedByBell);
  assert.equal(f.run.followUps, undefined);
  assert.deepEqual(byHandClean(f.run), { clean: true });
});

test("a change saved or a commit made in the folder while BELL takes over stays where the person left it", async (t) => {
  const f = await published(t);
  const readme = path.join(f.run.worktreePath, "README.md");
  const mine = await f.commit("export const attempts = 3;\n", "Retry three times");
  // The person saves a file while BELL reads GitHub's branch: the commits are taken over, the edit stays.
  await onNextFetch(t, f, `printf '# Example, edited\\n' > ${JSON.stringify(readme)}`);
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.publishCommit, mine);
  assert.equal(f.run.followUps?.at(-1)?.adopted, true);
  assert.equal(await f.head(), mine);
  assert.equal(await readFile(readme, "utf8"), "# Example, edited\n");
  await git(f.run.worktreePath, ["checkout", "--", "README.md"]);
  // The person commits while BELL reads the branch: the pushed commit is taken over, the new one stays.
  const pushed = await f.commit("export const attempts = 4;\n", "Retry four times");
  await onNextFetch(t, f, `printf 'A note.\\n' > NOTES.md && "$GIT" add NOTES.md && "$GIT" commit -q -m "Add a note"`);
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.publishCommit, pushed);
  const local = await f.head();
  assert.notEqual(local, pushed);
  assert.equal((await git(f.run.worktreePath, ["rev-parse", `${local}^`])).stdout.trim(), pushed);
  // It waits for a push, as any commit not on the branch yet.
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.match(f.run.logs.at(-2)?.message ?? "", pushFirst);
  assert.equal(await f.head(), local);
});

test("a commit pushed on top of the person's while BELL looks moves the folder without dropping a saved change", async (t) => {
  const f = await published(t);
  const readme = path.join(f.run.worktreePath, "README.md");
  const mine = await f.commit("export const attempts = 3;\n", "Retry three times");
  const onTop = await sideCommit(f, mine, { "NOTES.md": "A maintainer's note.\n" }, "Add a maintainer's note");
  await onNextFetch(
    t,
    f,
    `"$GIT" --git-dir="$BARE" update-ref refs/heads/${branch} ${onTop} && printf '# Example, edited\\n' > ${JSON.stringify(readme)}`,
  );
  await en(() => f.workbench.fetchPrFeedback(f.run.id));
  assert.equal(f.run.publishCommit, onTop);
  assert.equal(await f.head(), onTop);
  assert.equal(await readFile(path.join(f.run.worktreePath, "NOTES.md"), "utf8"), "A maintainer's note.\n");
  assert.equal(await readFile(readme, "utf8"), "# Example, edited\n");
});

test("adoptRemoteCommits without expectedHead takes over as before; with it, only a head that still holds it", async (t) => {
  const f = await published(t, { agent: true });
  const ctx = (f.workbench as unknown as { context: WorkbenchContext }).context;
  const pushedByBell = f.run.publishCommit!;
  // A force push that keeps BELL's push: an agent run's sync still takes it over.
  const forced = await sideCommit(f, pushedByBell, { "NOTES.md": "Rewritten on GitHub.\n" }, "Rewritten on GitHub");
  await git(f.run.worktreePath, ["push", "-q", "--force", f.github.url, `${forced}:refs/heads/${branch}`]);
  const elsewhere = await sideCommit(f, pushedByBell, { "OTHER.md": "Somewhere else.\n" }, "Somewhere else");
  await assert.rejects(en(() => adoptRemoteCommits(ctx, f.run, { expectedHead: elsewhere })), refused(remoteMoved));
  assert.equal(f.run.publishCommit, pushedByBell);
  assert.equal(await f.head(), pushedByBell);
  assert.equal(f.run.followUps, undefined);
  assert.equal(await en(() => adoptRemoteCommits(ctx, f.run)), true);
  assert.equal(f.run.publishCommit, forced);
  assert.equal(await f.head(), forced);
  assert.equal(f.run.followUps?.at(-1)?.adopted, true);
});
