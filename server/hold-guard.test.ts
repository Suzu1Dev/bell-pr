/**
 * The group's write guard, first slice (server/hold-guard.ts,
 * docs/design/collab-write-guard.md S1): BELL PR publishes no change that
 * touches a file someone else in the group holds, first publishes and
 * follow-up rounds alike. Real requests through the request guard, real
 * git repositories, and stand-ins for every remote git and gh call, first
 * on PATH. The tests share those stand-ins, so they run one at a time, as
 * node:test runs a file's tests.
 */
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CollabHold } from "../shared/collab.js";
import type { DraftCheck } from "../shared/draft-checks.js";
import type { PrFeedbackItem } from "../shared/pr-feedback.js";
import { collabFixture, outcome, type Headers } from "../test/collab-fixture.js";
import { participantHeader } from "./coordination-routes.js";
import { readDiff } from "./git.js";
import { command, git } from "./process.js";
import type { TeamAgentRunner } from "./team.js";
import type { Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";

const prUrl = "https://github.com/test-owner/example/pull/1";
/** The tests pin zh-TW as the default (test/css-stub.mjs); these read English unless they ask. */
const english = { "x-bell-locale": "en" };
const previousPath = process.env.PATH;
/** The stand-ins and what they remember: each git and gh call, the pushed head, the base. */
let bin: string;
let calls: string;
let remoteHead: string;
let baseFile: string;

before(async () => {
  skipUnderstandingCheckInTests(true);
  bin = await mkdtemp(path.join(os.tmpdir(), "bell-hold-guard-bin-"));
  calls = path.join(bin, "remote-calls");
  remoteHead = path.join(bin, "remote-head");
  baseFile = path.join(bin, "base-sha");
  const realGit = (await command("which", ["git"])).stdout.trim();
  const sh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  // Shell scripts, not node ones: a run makes many git calls, and each
  // would start node first. Local git as it is; a push or a read of the
  // remote is only recorded, and nothing reaches the network.
  await writeFile(
    path.join(bin, "git"),
    `#!/bin/sh
last=
for arg in "$@"; do last=$arg; done
for arg in "$@"; do
  case $arg in
    push)
      echo push >> ${sh(calls)}
      printf '%s' "\${last%%:*}" > ${sh(remoteHead)}
      exit 0 ;;
    ls-remote)
      echo ls-remote >> ${sh(calls)}
      if [ -s ${sh(remoteHead)} ]; then printf '%s\\t%s\\n' "$(cat ${sh(remoteHead)})" "$last"; fi
      exit 0 ;;
    fetch|http://*|https://*|ssh://*|git://*|*@github.com:*) exit 98 ;;
  esac
done
exec ${sh(realGit)} "$@"
`,
    { mode: 0o700 },
  );
  await writeFile(
    path.join(bin, "gh"),
    `#!/bin/sh
echo "gh $*" >> ${sh(calls)}
case "$1 $2" in
  "api user") echo test-owner ;;
  "api "*/pulls/1/commits) echo ;;
  "api "*) cat ${sh(baseFile)}; echo ;;
  "repo view") echo '{"viewerPermission":"WRITE","defaultBranchRef":{"name":"main"}}' ;;
  "pr list") echo '[]' ;;
  "pr create") echo ${sh(prUrl)} ;;
  "pr view") echo OPEN ;;
  *) exit 97 ;;
esac
`,
    { mode: 0o700 },
  );
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
});

after(async () => {
  skipUnderstandingCheckInTests();
  process.env.PATH = previousPath;
  await rm(bin, { recursive: true, force: true });
});

/** The files of the repository's first commit. */
const firstFiles: Record<string, string> = {
  "README.md": "Example\n",
  "src/api/users.ts": "export const users = [];\n",
  "src/api/index.ts": "export * from './users.js';\n",
  "docs/guide.md": "Guide\n",
  "docs/old.md": "Old notes\n",
  "docsite/index.md": "Site\n",
};

/**
 * The fixture's group (Ada the admin on her phone, Ben on his laptop, Cy
 * removed) and Dee on a desk of her own, with one repository of this BELL
 * PR on a GitHub address and a run of Ben's on it. `inGroup: false` leaves
 * the run's repository out of the group, and adds another one that is in
 * it, where the holds are then taken.
 */
async function scene(
  t: TestContext,
  { runner, inGroup = true }: { runner?: TeamAgentRunner; inGroup?: boolean } = {},
) {
  await writeFile(calls, "");
  await rm(remoteHead, { force: true });
  const f = await collabFixture(t, { runner });
  const cast = await f.cast();
  const desk = await f.device("Desk D");
  const dee = await f.join(desk, await f.invite(cast.who.admin, { name: "Dee" }));
  const who = { ...cast.who, dee: { ...desk, [participantHeader]: dee.token } as Headers };
  const sources = await mkdtemp(path.join(os.tmpdir(), "bell-hold-guard-sources-"));
  t.after(() => rm(sources, { recursive: true, force: true }));

  const repository = async (name: string) => {
    const folder = path.join(sources, name);
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
    Object.assign(repo, {
      url: "https://github.com/test-owner/example",
      fullName: "test-owner/example",
      owner: "test-owner",
      name: "example",
    });
    return { folder, repo };
  };
  const addToGroup = async (repoId: string) => {
    const added = await f.post("/projects", who.admin, { repoId });
    assert.equal(added.status, 201, added.body);
    return added.json.project.id as string;
  };

  const { folder, repo } = await repository("example");
  const project = await addToGroup(inGroup ? repo.id : (await repository("other")).repo.id);
  const baseSha = (await git(folder, ["rev-parse", "HEAD"])).stdout.trim();
  await writeFile(baseFile, baseSha);
  const runId = "hold-guard-run";
  const run: Run = {
    id: runId,
    repoId: repo.id,
    title: "Change the users API",
    prompt: "Change the users API",
    status: "review",
    branch: "fix/users",
    baseBranch: "main",
    baseSha,
    worktreePath: folder,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: {
      title: "fix: change the users API",
      body: "Changes the users API.",
      commitMessage: "fix: change the users API",
    },
    reviewedFiles: [],
    reviewedFingerprints: {},
  };
  f.store.data.runs.push(run);
  await f.store.save();
  await git(folder, ["checkout", "-q", "-b", run.branch]);

  /** The run as the server now running has it. */
  const current = () => f.workbench.run(runId);
  const hold = async (asWho: Headers, scopes: string[], title = "Users API"): Promise<CollabHold> => {
    const made = await f.post(`/projects/${project}/work`, asWho, { title, scopes });
    assert.equal(made.status, 201, made.body);
    return made.json.hold;
  };
  const release = (asWho: Headers, held: CollabHold) =>
    f.post(`/projects/${project}/holds/${held.claimId}/release`, asWho, { fence: held.fence });
  const revoke = (asWho: Headers, held: CollabHold) =>
    f.post(`/projects/${project}/holds/${held.claimId}/revoke`, asWho, {});
  /** Makes the change in the run's checkout, reviews every file and approves it. */
  const ready = async (change: (cwd: string) => Promise<unknown>) => {
    await change(folder);
    await reviewAll();
    await f.workbench.approve(runId, { ...current().draft });
  };
  const reviewAll = async () => {
    for (const file of await readDiff(current()))
      await f.workbench.review(runId, file.path, true, file.fingerprint);
  };
  const preflight = async (asWho: Headers) => {
    const reply = await f.send("GET", `/api/runs/${runId}/preflight`, { ...english, ...asWho });
    assert.equal(reply.status, 200, reply.body);
    return reply.json.checks as DraftCheck[];
  };
  /**
   * Publishes as the publish dialog does: every confirm it shows ticked,
   * and the GitHub facts the stand-in gh leaves unknown, with `extra` on
   * top. A refused preflight (403) is the publish's answer.
   */
  const publish = async (asWho: Headers, extra: Record<string, unknown> = {}, more: Headers = {}) => {
    const headers = { ...english, ...asWho, ...more };
    const shown = await f.send("GET", `/api/runs/${runId}/preflight`, headers);
    if (shown.status !== 200) return shown;
    const acknowledged = (shown.json.checks as DraftCheck[])
      .filter((check) => check.kind === "confirm")
      .map((check) => check.id)
      .concat("facts-unknown");
    return f.send(
      "POST",
      `/api/runs/${runId}/publish`,
      headers,
      { fingerprint: current().approvedFingerprint, acknowledged, ...extra },
    );
  };
  const pushes = async () =>
    (await readFile(calls, "utf8")).split("\n").filter((line) => line === "push").length;
  const head = async () => (await git(folder, ["rev-parse", "HEAD"])).stdout.trim();
  const write = (file: string, text: string) => async (cwd: string) => {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), text);
  };

  return {
    ...cast,
    f,
    dee,
    desk,
    who,
    folder,
    project,
    current,
    hold,
    release,
    revoke,
    ready,
    reviewAll,
    preflight,
    publish,
    pushes,
    head,
    write,
  };
}

const heldOf = (checks: DraftCheck[]) => checks.find((check) => check.id === "held-by-other");

test("a file Ada holds stops Ben's publish with 409 heldByOther, and nothing is committed or pushed", async (t) => {
  const s = await scene(t);
  const held = await s.hold(s.who.admin, ["src/api/users.ts"]);
  await s.ready(s.write("src/api/users.ts", "export const users = ['ben'];\n"));
  const before = await s.head();

  // The dialog shows a block, item by item.
  const check = heldOf(await s.preflight(s.devices.ben));
  assert.equal(check?.kind, "block");
  assert.match(check.message, /^Someone else in the group holds files this change touches\./);
  assert.equal(check.details.length, 1);
  assert.match(check.details[0], /^src\/api\/users\.ts — held by Ada for “Users API” \(since .+\)$/);

  const reply = await s.publish(s.devices.ben);
  assert.equal(outcome(reply), "409 heldByOther");
  assert.deepEqual(reply.json.held, [
    { path: "src/api/users.ts", claimId: held.claimId, holder: "Ada", title: "Users API", since: held.since },
  ]);
  assert.match(
    reply.json.error,
    /^Someone else holds files this change touches, so nothing was published\. src\/api\/users\.ts — held by Ada for “Users API” \(since .+\)\. Ask them to release the hold, or ask a group admin to revoke it\.$/,
  );
  assert.equal(await s.head(), before);
  assert.equal(s.current().status, "approved");
  assert.equal(s.current().publishCommit, undefined);
  assert.equal(await s.pushes(), 0);
});

test("a case variant, a file below a held folder, a deleted file and a file moved out of a held folder are all refused", async (t) => {
  const s = await scene(t);
  await s.hold(s.who.admin, ["src/api/users.ts", "docs"], "Users and docs");
  await s.ready(async (cwd) => {
    // Another spelling of the held file on a case-sensitive file system.
    await s.write("SRC/API/Users.ts", "export const shout = true;\n")(cwd);
    await s.write("docs/new/deep.md", "Deep\n")(cwd);
    await rm(path.join(cwd, "docs/guide.md"));
    // Git is asked without rename detection: a delete of docs/old.md and an add.
    await mkdir(path.join(cwd, "notes"));
    await rename(path.join(cwd, "docs/old.md"), path.join(cwd, "notes/old.md"));
  });
  const reply = await s.publish(s.devices.ben);
  assert.equal(outcome(reply), "409 heldByOther");
  // On a case-insensitive file system (macOS) the write lands on
  // src/api/users.ts itself; either way it is refused.
  assert.deepEqual(
    reply.json.held.map((conflict: { path: string }) => conflict.path.toLowerCase()).sort(),
    ["docs/guide.md", "docs/new/deep.md", "docs/old.md", "src/api/users.ts"],
  );
  assert.equal(await s.pushes(), 0);
});

test("files next to a hold publish: a sibling file and a folder whose name only starts the same", async (t) => {
  const s = await scene(t);
  await s.hold(s.who.admin, ["src/api/users.ts", "docs"]);
  await s.ready(async (cwd) => {
    await s.write("src/api/index.ts", "export * from './users.js';\nexport const index = 1;\n")(cwd);
    await s.write("docsite/index.md", "Site, changed\n")(cwd);
  });
  assert.equal(heldOf(await s.preflight(s.devices.ben)), undefined);
  const reply = await s.publish(s.devices.ben);
  assert.equal(reply.status, 200, reply.body);
  assert.equal(s.current().status, "published");
  assert.equal(await s.pushes(), 1);
});

test("Ben's own hold does not stop him, known by his participant token or by his device", async (t) => {
  const s = await scene(t);
  await s.hold(s.who.member, ["src/api/users.ts"]);
  await s.ready(s.write("src/api/users.ts", "export const users = ['ben'];\n"));
  // By the device: the web app sends no participant token.
  assert.equal(heldOf(await s.preflight(s.devices.ben)), undefined);
  // A token the group does not know, or of someone removed, is refused before anything else.
  assert.equal(outcome(await s.publish(s.devices.ben, {}, { [participantHeader]: `bpc_${"x".repeat(43)}` })), "403 notJoined");
  assert.equal(outcome(await s.publish(s.who.removed)), "403 notJoined");
  // By the token.
  const reply = await s.publish(s.who.member);
  assert.equal(reply.status, 200, reply.body);
  assert.equal(s.current().status, "published");
  assert.equal(await s.pushes(), 1);
});

test("two people on one device: without a token both are you; with Ben's token, Dee's hold stops him", async (t) => {
  const s = await scene(t);
  const eve = await s.f.join(s.devices.ben, await s.f.invite(s.who.admin, { name: "Eve" }));
  await s.hold({ ...s.devices.ben, [participantHeader]: eve.token }, ["src/api/users.ts"], "Eve's users");
  await s.ready(s.write("src/api/users.ts", "export const users = ['ben'];\n"));
  assert.equal(heldOf(await s.preflight(s.devices.ben)), undefined);
  assert.equal(heldOf(await s.preflight(s.who.member))?.kind, "block");
  const refused = await s.publish(s.who.member);
  assert.equal(outcome(refused), "409 heldByOther");
  assert.equal(refused.json.held[0].holder, "Eve");
  assert.equal(await s.pushes(), 0);
  const reply = await s.publish(s.devices.ben);
  assert.equal(reply.status, 200, reply.body);
  assert.equal(await s.pushes(), 1);
});

const feedbackItem: PrFeedbackItem = {
  kind: "thread",
  author: "maintainer",
  authorAssociation: "MEMBER",
  body: "Please list Ben too.",
  path: "src/api/users.ts",
  line: 1,
  url: `${prUrl}#discussion_r1`,
  createdAt: "2026-10-10T00:00:00Z",
};

test("a follow-up round is held to the same rule: its turn stops over Ada's hold, no second push, and one once she releases it", async (t) => {
  const s = await scene(t, {
    runner: async (input) => {
      assert.equal(input.role, "followup");
      await writeFile(path.join(input.cwd, "src/api/users.ts"), "export const users = ['ben'];\n");
      return JSON.stringify({
        summary: "Listed Ben.",
        addressed: [{ url: feedbackItem.url, change: "Listed Ben." }],
        notAddressed: [],
        checks: [],
        commitMessage: "List Ben in the users",
      });
    },
  });
  await s.ready(s.write("README.md", "Example, changed\n"));
  const first = await s.publish(s.devices.ben);
  assert.equal(first.status, 200, first.body);
  assert.equal(await s.pushes(), 1);

  const held = await s.hold(s.who.admin, ["src/api/users.ts"]);
  const run = s.current();
  run.prFeedback = { fetchedAt: new Date().toISOString(), prNumber: 1, items: [feedbackItem] };
  await s.f.workbench.startFollowUp(run.id, { feedbackUrls: [feedbackItem.url] });
  for (let turn = 0; turn < 3000 && s.current().status === "running"; turn += 1)
    await new Promise((resolve) => setTimeout(resolve, 10));
  // The turn itself is stopped (S2, server/hold-guard-turns.test.ts); its
  // edit stays for review, and the person writes the commit message.
  assert.equal(s.current().status, "review");
  assert.match(s.current().followUps?.at(-1)?.error ?? "", /^Agent 改到別人佔用的檔案，所以這項工作已停止。.+或把這些檔案的改動還原，再試一次。/);
  assert.equal(await readFile(path.join(s.folder, "src/api/users.ts"), "utf8"), "export const users = ['ben'];\n");
  s.current().draft.commitMessage = "List Ben in the users";
  await s.reviewAll();
  await s.f.workbench.approve(run.id, { ...s.current().draft });
  const before = await s.head();

  const refused = await s.publish(s.devices.ben);
  assert.equal(outcome(refused), "409 heldByOther");
  assert.equal(await s.head(), before);
  assert.equal(await s.pushes(), 1);
  assert.equal(s.current().followUps?.at(-1)?.status, "review");

  assert.equal((await s.release(s.who.admin, held)).status, 200);
  const reply = await s.publish(s.devices.ben);
  assert.equal(reply.status, 200, reply.body);
  assert.equal(s.current().followUps?.at(-1)?.status, "published");
  assert.equal(await s.pushes(), 2);
});

test("the block cannot be ticked away or overridden", async (t) => {
  const s = await scene(t);
  await s.hold(s.who.admin, ["src/api/users.ts"]);
  await s.ready(s.write("src/api/users.ts", "export const users = ['ben'];\n"));
  const ticked = await s.publish(s.devices.ben, { acknowledged: ["facts-unknown", "held-by-other"] });
  assert.equal(outcome(ticked), "409 heldByOther");
  const overridden = await s.publish(s.devices.ben, {
    overrides: [{ id: "held-by-other", reason: "I talked to Ada about it." }],
  });
  assert.equal(overridden.status, 400, overridden.body);
  assert.equal(await s.pushes(), 0);
});

test("a release, then an admin's revoke, clears the way one hold at a time", async (t) => {
  const s = await scene(t);
  const ada = await s.hold(s.who.admin, ["src/api/users.ts"]);
  const dee = await s.hold(s.who.dee, ["docs"], "Docs");
  await s.ready(async (cwd) => {
    await s.write("src/api/users.ts", "export const users = ['ben'];\n")(cwd);
    await s.write("docs/guide.md", "Guide, changed\n")(cwd);
  });
  const both = await s.publish(s.devices.ben);
  assert.deepEqual(
    both.json.held.map((conflict: { holder: string }) => conflict.holder).sort(),
    ["Ada", "Dee"],
  );
  assert.equal((await s.release(s.who.admin, ada)).status, 200);
  const one = await s.publish(s.devices.ben);
  assert.equal(outcome(one), "409 heldByOther");
  assert.deepEqual(one.json.held.map((conflict: { holder: string }) => conflict.holder), ["Dee"]);
  assert.equal((await s.revoke(s.who.admin, dee)).status, 200);
  const reply = await s.publish(s.devices.ben);
  assert.equal(reply.status, 200, reply.body);
  assert.equal(await s.pushes(), 1);
});

test("a repository outside the group publishes over a hold on the same path, even while group work is stopped", async (t) => {
  const s = await scene(t, { inGroup: false });
  await s.hold(s.who.admin, ["src/api/users.ts"]);
  await s.ready(s.write("src/api/users.ts", "export const users = ['ben'];\n"));
  assert.equal(heldOf(await s.preflight(s.devices.ben)), undefined);
  s.f.lock.release();
  assert.equal(s.f.collab.status().state, "stopped");
  const reply = await s.publish(s.devices.ben);
  assert.equal(reply.status, 200, reply.body);
  assert.equal(await s.pushes(), 1);
});

test("without --group nothing is checked: the same change over the same hold publishes", async (t) => {
  const s = await scene(t);
  await s.hold(s.who.admin, ["src/api/users.ts"]);
  await s.ready(s.write("src/api/users.ts", "export const users = ['ben'];\n"));
  await s.f.store.save();
  await s.f.start(undefined, { group: false });
  const checks = await s.preflight(s.f.install);
  assert.equal(checks.some((check) => check.id === "held-by-other" || check.id === "holds-unknown"), false);
  const reply = await s.publish(s.f.install);
  assert.equal(reply.status, 200, reply.body);
  assert.equal(s.current().status, "published");
  assert.equal(await s.pushes(), 1);
});

test("while group work is stopped, a repository in the group does not publish: 503 holdsUnknown", async (t) => {
  const s = await scene(t);
  await s.ready(s.write("README.md", "Example, changed\n"));
  // The writer lock lost: group work stops (notSingleWriter).
  s.f.lock.release();
  assert.equal(s.f.collab.status().state, "stopped");
  const check = (await s.preflight(s.devices.ben)).find((each) => each.id === "holds-unknown");
  assert.equal(check?.kind, "block");
  assert.match(check.message, /^Can't check file holds because group work has stopped\./);
  const reply = await s.publish(s.devices.ben);
  assert.equal(outcome(reply), "503 holdsUnknown");
  assert.match(reply.json.error, /so nothing was published\. .*or start BELL PR without --group\.$/);
  assert.equal(s.current().status, "approved");
  assert.equal(await s.pushes(), 0);
});

test("the refusal and the dialog's block speak the request's language", async (t) => {
  const s = await scene(t);
  await s.hold(s.who.admin, ["src/api/users.ts"]);
  await s.ready(s.write("src/api/users.ts", "export const users = ['ben'];\n"));
  const zh = { "x-bell-locale": "zh-TW" };
  const check = heldOf(await s.preflight({ ...s.devices.ben, ...zh }));
  assert.match(check?.message ?? "", /^小組裡有人佔用了這次變更動到的檔案。/);
  assert.match(check?.details[0] ?? "", /^src\/api\/users\.ts：由 Ada 為「Users API」佔用（.+ 起）$/);
  const reply = await s.publish(s.devices.ben, {}, zh);
  assert.equal(outcome(reply), "409 heldByOther");
  assert.match(
    reply.json.error,
    /^這次變更動到別人佔用的檔案，所以沒有發佈。src\/api\/users\.ts：由 Ada 為「Users API」佔用（.+ 起）。請對方釋出，或請小組管理員收回這項佔用。$/,
  );
});
