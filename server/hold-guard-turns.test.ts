/**
 * The group's write guard, second slice (server/hold-guard.ts,
 * docs/design/collab-write-guard.md S2): a run's agents keep off files
 * someone else in the group holds. A run saves who started it; each write
 * turn is told the held paths and stopped when the run's changes meet one;
 * a teammate's change that meets one is not added; a plan that covers one
 * is not approved. Real requests, real git repositories, agents stood in
 * for by `runner`, and a git and gh first on PATH that reach no network.
 */
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CollabHold } from "../shared/collab.js";
import type { ContributionSettings } from "../shared/insights.js";
import { collabFixture, outcome, type Headers } from "../test/collab-fixture.js";
import { participantHeader } from "./coordination-routes.js";
import { sm, withLocale } from "./i18n/index.js";
import { readDiff } from "./git.js";
import { command, git } from "./process.js";
import type { TeamAgentInput, TeamAgentRunner } from "./team.js";
import type { Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";

/** The tests pin zh-TW as the default (test/css-stub.mjs); these read English unless they ask. */
const english = { "x-bell-locale": "en" };
const previousPath = process.env.PATH;
let bin: string;

before(async () => {
  skipUnderstandingCheckInTests(true);
  bin = await mkdtemp(path.join(os.tmpdir(), "bell-hold-turns-bin-"));
  const realGit = (await command("which", ["git"])).stdout.trim();
  const sh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  // Shell scripts, not node ones: a run makes many git calls. Local git as
  // it is; anything that would reach a remote fails, and so does gh.
  await writeFile(
    path.join(bin, "git"),
    `#!/bin/sh
for arg in "$@"; do
  case $arg in
    push|fetch|ls-remote|http://*|https://*|ssh://*|git://*|*@github.com:*) exit 98 ;;
  esac
done
exec ${sh(realGit)} "$@"
`,
    { mode: 0o700 },
  );
  await writeFile(path.join(bin, "gh"), "#!/bin/sh\nexit 97\n", { mode: 0o700 });
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
});

after(async () => {
  skipUnderstandingCheckInTests();
  process.env.PATH = previousPath;
  await rm(bin, { recursive: true, force: true });
});

const settings = (requirePlanApproval: boolean): ContributionSettings => ({
  direction: "feature",
  targetUser: "People who use the API",
  outcome: "Users are listed",
  constraints: "Keep the API",
  acceptance: "Existing tests pass",
  maxTeammates: 2,
  requirePlanApproval,
});
const plan = (tasks: { id: string; files: string[] }[]) =>
  JSON.stringify({
    summary: "Change the users API in two independent parts.",
    tasks: tasks.map((task) => ({ title: task.id, description: `Implement ${task.id}`, dependsOn: [], ...task })),
  });
const report = (text: string) => JSON.stringify({ report: text, messages: [] });
const agentsReady = async () => ({
  codex: true,
  codexAuthenticated: true,
  github: false,
  claude: false,
  claudeAuthenticated: false,
});

async function waitUntil(predicate: () => boolean, what: string) {
  const end = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await delay(10);
  }
}

const firstFiles: Record<string, string> = {
  "README.md": "Example\n",
  "src/api/users.ts": "export const users = [];\n",
  "src/api/index.ts": "export * from './users.js';\n",
  "docs/guide.md": "Guide\n",
};

/**
 * The fixture's group (Ada the admin, Ben a member, each on a device of
 * their own) with one local repository in it. `agents` answers each agent
 * turn; every turn it is asked is kept in `turns`.
 */
async function scene(t: TestContext, agents: (input: TeamAgentInput) => Promise<string>) {
  const turns: TeamAgentInput[] = [];
  const runner: TeamAgentRunner = async (input) => {
    turns.push(input);
    return agents(input);
  };
  const f = await collabFixture(t, { runner });
  f.workbench.status = agentsReady;
  const cast = await f.cast();
  const sources = await mkdtemp(path.join(os.tmpdir(), "bell-hold-turns-sources-"));
  t.after(() => rm(sources, { recursive: true, force: true }));
  const folder = path.join(sources, "example");
  await mkdir(folder);
  await git(folder, ["init", "-q", "-b", "main"]);
  await git(folder, ["config", "user.name", "BELL Test"]);
  await git(folder, ["config", "user.email", "test@example.invalid"]);
  await git(folder, ["config", "commit.gpgsign", "false"]);
  for (const [file, text] of Object.entries(firstFiles)) {
    await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await writeFile(path.join(folder, file), text);
  }
  await git(folder, ["add", "--", "."]);
  await git(folder, ["commit", "-q", "-m", "initial"]);
  const repo = await f.workbench.importRepository(folder);
  const added = await f.post("/projects", cast.who.admin, { repoId: repo.id });
  assert.equal(added.status, 201, added.body);
  const project = added.json.project.id as string;

  const hold = async (asWho: Headers, scopes: string[], title = "Users API"): Promise<CollabHold> => {
    const made = await f.post(`/projects/${project}/work`, asWho, { title, scopes });
    assert.equal(made.status, 201, made.body);
    return made.json.hold;
  };
  const release = async (asWho: Headers, held: CollabHold) => {
    const released = await f.post(`/projects/${project}/holds/${held.claimId}/release`, asWho, { fence: held.fence });
    assert.equal(released.status, 200, released.body);
  };
  /** Starts a run as the web app does. */
  const start = (asWho: Headers, requirePlanApproval = true) =>
    f.send("POST", "/api/runs", { ...english, ...asWho }, {
      repoId: repo.id,
      prompt: "List Ben in the users API",
      settings: settings(requirePlanApproval),
    });
  const run = (id: string) => f.workbench.run(id);
  /** A run in review on its own branch of the repository, as the agents left it. */
  const inReview = async (owners?: string[]) => {
    const baseSha = (await git(folder, ["rev-parse", "HEAD"])).stdout.trim();
    const made: Run = {
      id: "hold-turns-run",
      repoId: repo.id,
      title: "Change the users API",
      prompt: "Change the users API",
      status: "review",
      branch: "fix/users",
      baseBranch: "main",
      baseSha,
      worktreePath: folder,
      createdAt: new Date().toISOString(),
      locale: "en",
      agents: [],
      logs: [],
      draft: { title: "fix: change the users API", body: "Changes the users API." },
      reviewedFiles: [],
      reviewedFingerprints: {},
      ...(owners ? { owners } : {}),
    };
    f.store.data.runs.push(made);
    await f.store.save();
    await git(folder, ["checkout", "-q", "-b", made.branch]);
    return made.id;
  };
  /** One collaborative editing turn on a run in review; the agent's message that ends it. */
  const session = async (id: string, content: string) => {
    const before = run(id).session?.messages.length ?? 0;
    await f.workbench.startSession(id, content);
    await waitUntil(
      () => !run(id).session?.running && (run(id).session?.messages.length ?? 0) >= before + 2,
      "the session turn",
    );
    return run(id).session!.messages.at(-1)!;
  };
  const read = (file: string) => readFile(path.join(folder, file), "utf8");
  return { ...cast, f, turns, hold, release, start, run, inReview, session, read };
}

/** Writes `file` in the turn's checkout. */
const write = async (cwd: string, file: string, text: string) => {
  await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
  await writeFile(path.join(cwd, file), text);
};
const notices = (run: Run) => run.logs.filter((entry) => entry.kind === "notice").map((entry) => entry.message);

test("a run saves who starts it: the participant token, else the people who joined from the device; nobody there, or no group, saves none", async (t) => {
  const s = await scene(t, async (input) => (input.role === "lead" ? plan([{ id: "alpha", files: ["README.md"] }]) : report("Done")));
  const owners = async (asWho: Headers) => {
    const reply = await s.start(asWho);
    assert.equal(reply.status, 202, reply.body);
    return reply.json.run as Run;
  };
  const byToken = await owners(s.who.member);
  const byDevice = await owners(s.devices.ben);
  const nobody = await owners(s.devices.none);
  const atHost = await owners(s.who.install);
  assert.deepEqual(byToken.owners, [s.ben.id]);
  assert.deepEqual(byDevice.owners, [s.ben.id]);
  assert.equal(nobody.owners, undefined);
  assert.equal(atHost.owners, undefined);
  // A token the group does not know, or of someone removed, starts nothing.
  const before = s.f.store.data.runs.length;
  assert.equal(outcome(await s.start({ ...s.devices.ben, [participantHeader]: `bpc_${"x".repeat(43)}` })), "403 notJoined");
  assert.equal(outcome(await s.start(s.who.removed)), "403 notJoined");
  assert.equal(s.f.store.data.runs.length, before);

  // Saved with the run, and read back after a restart, with group work or without.
  for (const id of [byToken.id, byDevice.id, nobody.id, atHost.id])
    await waitUntil(() => s.run(id).status === "awaiting_plan", "the plan");
  await s.f.start();
  assert.deepEqual(s.run(byToken.id).owners, [s.ben.id]);
  assert.equal(s.run(nobody.id).owners, undefined);
  await s.f.start(undefined, { group: false });
  s.f.workbench.status = agentsReady;
  assert.deepEqual(s.run(byDevice.id).owners, [s.ben.id]);
  const without = await owners(s.devices.ben);
  assert.equal(without.owners, undefined);
});

test("a plan over Ada's hold does not start on its own, cannot be approved while she holds it, and goes ahead once she releases it", async (t) => {
  let leadTurns = 0;
  const s = await scene(t, async (input) => {
    if (input.role === "lead")
      return leadTurns++ === 0
        ? plan([
            // A folder with a trailing slash, as leads write them.
            { id: "alpha", files: ["src/api/"] },
            { id: "beta", files: ["docs/guide.md"] },
          ])
        : "Integrated both parts.";
    if (input.role === "reviewer" || input.role === "tester") return "Reviewed: no problems.";
    if (input.taskId) {
      await write(input.cwd, input.taskId === "alpha" ? "src/api/users.ts" : "docs/guide.md", `${input.taskId}\n`);
      return report(`${input.taskId} done`);
    }
    return "Not used";
  });
  const ada = await s.hold(s.who.admin, ["src/api/users.ts"]);
  // Ben's own hold over the other task's file does not count.
  await s.hold(s.who.member, ["docs"], "Ben's docs");
  const started = await s.start(s.who.member, false);
  assert.equal(started.status, 202, started.body);
  const id = started.json.run.id as string;
  await waitUntil(() => s.run(id).status === "awaiting_plan", "the plan");
  assert.equal(s.run(id).team?.phase, "awaiting_approval");
  assert.equal(s.run(id).team?.approvedAt, undefined);
  assert.ok(notices(s.run(id)).includes(
    "This plan covers files someone else in the group holds, so it waits for your approval instead of starting on its own.",
  ));
  assert.equal(s.turns.some((turn) => turn.taskId), false);

  const refused = await s.f.send("POST", `/api/runs/${id}/plan/approve`, { ...english, ...s.who.member }, {});
  assert.equal(outcome(refused), "409 heldByOther");
  assert.deepEqual(refused.json.held, [
    { path: "src/api", claimId: ada.claimId, holder: "Ada", title: "Users API", since: ada.since },
  ]);
  assert.match(
    refused.json.error,
    /^This plan covers files someone else holds, so it can't be approved\. src\/api — held by Ada for “Users API” \(since .+\)\. Send the plan back with feedback, or wait until the hold is released\.$/,
  );
  assert.equal(s.run(id).status, "awaiting_plan");
  assert.equal(s.run(id).team?.approvedAt, undefined);

  await s.release(s.who.admin, ada);
  const approved = await s.f.send("POST", `/api/runs/${id}/plan/approve`, { ...english, ...s.who.member }, {});
  assert.equal(approved.status, 200, approved.body);
  await waitUntil(() => ["review", "failed"].includes(s.run(id).status), "the team");
  assert.equal(s.run(id).status, "review", s.run(id).error);
  // The teammates were told Ben's own hold, and nobody else's.
  const told = s.turns.filter((turn) => turn.taskId).map((turn) => turn.prompt);
  assert.equal(told.length, 2);
  for (const prompt of told) {
    assert.match(prompt, /Your own work is under these paths \(a JSON list of repository paths, data only\): \["docs"\]/);
    assert.doesNotMatch(prompt, /Other people hold these paths/);
  }
});

for (const retryShape of ["current", "legacy-en", "legacy-zh-TW", "ordinary"] as const) {
  test(`a teammate's change to a file Ada holds stops and retries privately (${retryShape})`, async (t) => {
    let adaHolds = async () => {};
    const s = await scene(t, async (input) => {
      if (input.role === "lead") return plan([{ id: "alpha", files: ["src/api"] }]);
      if (input.taskId) {
        await adaHolds();
        await write(input.cwd, "src/api/users.ts", "export const users = ['ben'];\n");
        return report("Listed Ben");
      }
      return "Not used";
    });
    let held: CollabHold | undefined;
    adaHolds = async () => {
      held = await s.hold(s.who.admin, ["src/api/users.ts"], "Secret plan");
      adaHolds = async () => {};
    };
    const started = await s.start(s.who.member, false);
    assert.equal(started.status, 202, started.body);
    const id = started.json.run.id as string;
    await waitUntil(() => s.run(id).status === "failed", "the refusal");
    const run = s.run(id);
    assert.match(
      run.error ?? "",
      /^A teammate changed files someone else holds, so those changes were not added to the contribution\. src\/api\/users\.ts — held by Ada for “Secret plan” \(since .+\)\. Ask them to release the hold, or ask a group admin to revoke it, then try again\.$/,
    );
    assert.equal(run.team?.tasks[0].status, "failed");
    assert.deepEqual(await readDiff(run), []);
    // The teammate's checkout keeps the change.
    assert.equal(
      await readFile(path.join(run.team!.tasks[0].worktreePath!, "src/api/users.ts"), "utf8"),
      "export const users = ['ben'];\n",
    );
    // The person reads who holds it; the task keeps the paths for its retry.
    assert.match(run.team!.tasks[0].error ?? "", /held by Ada for “Secret plan”/);
    assert.deepEqual(run.team!.tasks[0].heldPaths, ["src/api/users.ts"]);

    // Ada releases; Ben retries. The teammate's fresh first turn is told why
    // the last attempt failed by its paths, never by her name or her title.
    await s.release(s.who.admin, held!);
    if (retryShape !== "current") {
      delete run.team!.tasks[0].heldPaths;
      run.team!.tasks[0].error = retryShape === "ordinary"
        ? "Compiler failed: missing export users"
        : withLocale(retryShape === "legacy-en" ? "en" : "zh-TW", () =>
            sm().run.local.taskHeldByOther({ items: ["src/api/users.ts — Ada: Secret plan"] }),
          );
      await s.f.store.save();
      await s.f.start();
      assert.equal(s.run(id).team!.tasks[0].heldPaths, undefined);
      assert.equal(s.run(id).team!.tasks[0].error, run.team!.tasks[0].error);
    }
    const before = s.turns.length;
    const retried = await s.f.send("POST", `/api/runs/${id}/team/retry`, { ...english, ...s.who.member }, {});
    assert.equal(retried.status, 200, retried.body);
    await waitUntil(() => s.turns.slice(before).some((turn) => turn.taskId), "the retried teammate turn");
    const retry = s.turns.slice(before).find((turn) => turn.taskId)!.prompt;
    assert.ok(
      retry.startsWith(
        retryShape === "current"
          ? "Previous attempt failed: BELL did not add the changes because they touched files other people hold: src/api/users.ts\n"
          : retryShape === "ordinary"
            ? "Previous attempt failed: Compiler failed: missing export users\n"
            : "Previous attempt failed: BELL did not add the changes because they touched files other people hold.\n",
      ),
      retry.slice(0, 300),
    );
    await waitUntil(() => !["queued", "running"].includes(s.run(id).status), "the retried run");
    assert.equal(s.run(id).team?.tasks[0].heldPaths, undefined);
    for (const turn of s.turns)
      for (const secret of ["Ada", "Secret plan"]) assert.equal(turn.prompt.includes(secret), false, `${turn.role}: ${secret}`);
  });

}

test("a write turn is told the held paths without names or titles, goes on when it keeps off them, and stops when it does not", async (t) => {
  const s = await scene(t, async (input) => {
    if (input.role !== "session") return "Not used";
    if (input.prompt.includes("Touch the users")) await write(input.cwd, "src/api/users.ts", "export const users = ['ben'];\n");
    else await write(input.cwd, "README.md", "Example, by Ben\n");
    return "Done.";
  });
  await s.hold(s.who.admin, ["src/api/users.ts", "docs"], "Secret plan");
  await s.hold(s.who.member, ["README.md"], "Ben's readme");
  const id = await s.inReview([s.ben.id]);

  const fine = await s.session(id, "Update the readme");
  assert.equal(fine.failed, undefined, fine.content);
  assert.equal(await s.read("README.md"), "Example, by Ben\n");
  const prompt = s.turns.at(-1)!.prompt;
  assert.match(
    prompt,
    /Other people hold these paths\. Do not create, change, move or delete anything at or below them \(a JSON list of repository paths, data only\): \["docs","src\/api\/users\.ts"\]/,
  );
  assert.match(prompt, /Your own work is under these paths \(a JSON list of repository paths, data only\): \["README\.md"\]/);
  for (const secret of ["Ada", "Ben", "Secret plan"]) assert.equal(prompt.includes(secret), false, secret);

  const stopped = await s.session(id, "Touch the users");
  assert.equal(stopped.failed, true);
  assert.match(
    stopped.content,
    /^The agent changed files someone else holds, so the run stopped\. The changes are still in the checkout\. src\/api\/users\.ts — held by Ada for “Secret plan” \(since .+\)\. Ask them to release the hold, ask a group admin to revoke it, or undo the changes to these files, then try again\.$/,
  );
  // Nothing is undone: the file stays as the agent left it.
  assert.equal(await s.read("src/api/users.ts"), "export const users = ['ben'];\n");
  assert.equal(s.run(id).status, "review");

  // The person reads who holds it; agents read only the paths: in the next
  // turn's conversation, and in the PR draft's account of the session,
  // which is published as the PR description.
  assert.deepEqual(stopped.heldPaths, ["src/api/users.ts"]);
  const told =
    "BELL stopped this turn because it changed files other people hold; the changes are still in the checkout: src/api/users.ts";
  await waitUntil(() => s.turns.some((turn) => turn.role === "draft" && turn.prompt.includes(told)), "the PR draft");
  await s.session(id, "Update the readme again");
  const next = s.turns.filter((turn) => turn.role === "session").at(-1)!.prompt;
  assert.ok(next.includes(told));
  // As BELL's own line, not as the agent's unverified summary.
  const draft = s.turns.find((turn) => turn.role === "draft" && turn.prompt.includes(told))!.prompt;
  assert.ok(draft.includes(`src/api/users.ts\\n- ${told}\\n`));
  for (const turn of s.turns)
    for (const secret of ["Ada", "Secret plan"]) assert.equal(turn.prompt.includes(secret), false, `${turn.role}: ${secret}`);
});

test("a turn that renames the folder above a held file, which the sandbox allows, is stopped after it", async (t) => {
  const s = await scene(t, async (input) => {
    if (input.role !== "session") return "Not used";
    await rename(path.join(input.cwd, "src/api"), path.join(input.cwd, "src/api2"));
    await write(input.cwd, "src/api2/users.ts", "export const users = ['ben'];\n");
    return "Done.";
  });
  await s.hold(s.who.admin, ["src/api/users.ts"], "Secret plan");
  const id = await s.inReview([s.ben.id]);
  const stopped = await s.session(id, "Move the API");
  assert.equal(stopped.failed, true, stopped.content);
  assert.deepEqual(stopped.heldPaths, ["src/api/users.ts"]);
});

test("a run nobody owns respects every hold, its starter's own too", async (t) => {
  const s = await scene(t, async (input) => {
    if (input.role !== "session") return "Not used";
    await write(input.cwd, "README.md", "Example, by Ben\n");
    return "Done.";
  });
  await s.hold(s.who.member, ["README.md"], "Ben's readme");
  const id = await s.inReview();
  const stopped = await s.session(id, "Update the readme");
  assert.equal(stopped.failed, true);
  assert.match(stopped.content, /README\.md — held by Ben for “Ben's readme”/);
  assert.match(s.turns.at(-1)!.prompt, /Other people hold these paths.*\["README\.md"\]/);
});

test("while group work is stopped, a write turn does not start: 503 holdsUnknown, and the agent is never asked", async (t) => {
  const s = await scene(t, async () => "Done.");
  const id = await s.inReview([s.ben.id]);
  // The writer lock lost: group work stops (notSingleWriter).
  s.f.lock.release();
  assert.equal(s.f.collab.status().state, "stopped");
  const stopped = await s.session(id, "Update the readme");
  assert.equal(stopped.failed, true);
  assert.equal(
    stopped.content,
    "Can't check file holds because group work has stopped, so the agents can't change files. Fix group work on the host and restart BELL PR, or start BELL PR without --group.",
  );
  assert.equal(s.turns.some((turn) => turn.role === "session"), false);
});

test("without --group nothing changes: no held paths in the prompt, and a turn writes a file Ada held", async (t) => {
  const s = await scene(t, async (input) => {
    if (input.role !== "session") return "Not used";
    await write(input.cwd, "src/api/users.ts", "export const users = ['ben'];\n");
    return "Done.";
  });
  await s.hold(s.who.admin, ["src/api/users.ts"]);
  const id = await s.inReview();
  await s.f.start(undefined, { group: false });
  s.f.workbench.status = agentsReady;
  const fine = await s.session(id, "Touch the users");
  assert.equal(fine.failed, undefined, fine.content);
  assert.equal(await s.read("src/api/users.ts"), "export const users = ['ben'];\n");
  const prompt = s.turns.at(-1)!.prompt;
  assert.doesNotMatch(prompt, /hold these paths|Your own work is under/);
});

test("a reason that ends in a full stop is joined to the kept-edits sentences once, conflict resolution's too", () => {
  for (const locale of ["en", "zh-TW"] as const)
    withLocale(locale, () => {
      for (const reason of ["Try again.", "請再試一次。"])
        for (const text of [
          sm().session.editsKept({ reason }),
          sm().run.followUp.keptEdits({ reason }),
          sm().run.sync.failed({ reason }),
        ])
          assert.doesNotMatch(text, /[.。]{2}|[.。][；;]/u, `${locale}: ${text}`);
    });
});
