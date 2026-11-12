/**
 * End-to-end integration tests for multi-person collaboration in BELL PR:
 * the Group page board & store (`src/collab/store.ts`, `src/collab/GroupPage.tsx`,
 * `/api/collab/*`) working together with the write-guard stack (`dependsOn`,
 * `changing`, `collab.json` hold baselines, S1 publish/preflight guard, S2
 * agent turn & plan approval guard, S3 sandbox policy wiring, S4 upstream
 * change & overlap detection, and `/holds/restore` + `/holds/recheck` recovery).
 *
 * Covers both positive and negative collaboration contracts:
 * (a) Two members developing non-overlapping paths run agent write turns in
 *     parallel and both pass turn checks, preflight, and publish.
 * (b) Conflicting file edits are hard-blocked at plan approval, agent write
 *     turns, preflight, and publish; runs recover non-conflicting edits via
 *     `POST /api/runs/:id/holds/restore` or resume via
 *     `POST /api/runs/:id/holds/recheck` once released or revoked by an admin.
 * (c) `dependsOn` refuses claiming while prerequisites are still held or ended
 *     without `done: true` (plain release or revoke), and allows claiming once
 *     released with `done: true` (including while a `done` write is in flight).
 * (d) Group board (`feed` + `createGroupStore`), `check`, and `work` responses
 *     accurately reflect `dependsOn`, `changing`, active holds, and `collab.json`
 *     hold baselines without leaking private hold titles or holder names into
 *     agent prompts or logs.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createElement } from "react";
import type {
  CollabBoard,
  CollabCheckResponse,
  CollabHold,
  CollabWorkResponse,
} from "../shared/collab.js";
import type { DraftCheck } from "../shared/draft-checks.js";
import type { ContributionSettings } from "../shared/insights.js";
import type { HoldRecheckResponse, HoldRestoreResponse } from "../shared/types.js";
import { cannotTake, HoldAnswer, type Answer } from "../src/collab/GroupPage.js";
import { createGroupStore } from "../src/collab/store.js";
import { renderEn } from "../src/test-utils/render.js";
import { collabFixture, outcome, type Headers } from "../test/collab-fixture.js";
import type { CollabSide } from "./collab-host.js";
import { participantHeader } from "./coordination-routes.js";
import { readDiff } from "./git.js";
import { command, git } from "./process.js";
import type { TeamAgentInput, TeamAgentRunner } from "./team.js";
import type { Run } from "./types.js";
import { skipUnderstandingCheckInTests } from "./understanding.js";

const english: Headers = { "x-bell-locale": "en" };

const agentsReady = async () => ({
  codex: true,
  codexAuthenticated: true,
  github: true,
  claude: false,
  claudeAuthenticated: false,
});

const seedFiles: Record<string, string> = {
  "README.md": "# shop\n",
  "src/api/users.ts": "export const users: string[] = [];\n",
  "src/api/index.ts": "export * from './users.js';\n",
  "src/web/App.tsx": "export const App = () => 'shop';\n",
  "docs/guide.md": "Guide v1\n",
};

const contributionSettings = (requirePlanApproval: boolean): ContributionSettings => ({
  direction: "feature",
  targetUser: "Developers collaborating on shop",
  outcome: "Feature shipped cleanly",
  constraints: "Respect active holds",
  acceptance: "Checks pass",
  maxTeammates: 2,
  requirePlanApproval,
});

const planJson = (tasks: { id: string; files: string[] }[]) =>
  JSON.stringify({
    summary: "Split work into focused tasks.",
    tasks: tasks.map((task) => ({
      title: task.id,
      description: `Implement ${task.id}`,
      dependsOn: [],
      ...task,
    })),
  });

const sessionReply = (reply = "Updated requested files.") =>
  JSON.stringify({
    reply,
    questions: [],
    notRun: [],
    setup: [],
    setupResults: [],
    limitations: "",
    validation: "",
  });

async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await delay(15);
  }
}

async function writeCheckoutFile(cwd: string, rel: string, content: string) {
  const target = path.join(cwd, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

/**
 * Pure `/bin/sh` local stand-in for `git` and `gh` backed by a real local bare
 * repository, avoiding Node subprocess startup overhead under `node --test`.
 */
async function createFastShellGitHub(directory: string) {
  const owner = "test-owner";
  const name = "shop";
  const bare = path.join(directory, "remote.git");
  const scratch = path.join(directory, "upstream");
  const bin = path.join(directory, "fake-bin");
  const prSeqFile = path.join(directory, "pr-seq");
  await mkdir(bin, { recursive: true });
  await writeFile(prSeqFile, "0");

  const realGit = (await command("which", ["git"])).stdout.trim();
  await git(directory, ["init", "-q", "--bare", "-b", "main", bare]);
  await git(directory, ["clone", "-q", bare, scratch]);
  await git(scratch, ["config", "user.name", "Upstream"]);
  await git(scratch, ["config", "user.email", "upstream@example.invalid"]);
  await git(scratch, ["config", "commit.gpgsign", "false"]);
  await git(scratch, ["checkout", "-q", "-b", "main"]);

  const commitUpstream = async (files: Record<string, string>, message: string) => {
    for (const [rel, content] of Object.entries(files)) {
      await writeCheckoutFile(scratch, rel, content);
    }
    await git(scratch, ["add", "-A"]);
    await git(scratch, ["commit", "-q", "-m", message]);
    const sha = (await git(scratch, ["rev-parse", "HEAD"])).stdout.trim();
    await git(scratch, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
    return sha;
  };
  await commitUpstream(seedFiles, "initial");

  const shQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(
    path.join(bin, "git"),
    `#!/bin/sh
need_map=0
for arg in "$@"; do
  case "$arg" in
    *https://github.com/*|protocol.*|credential.helper=*)
      need_map=1
      break
      ;;
  esac
done
if [ "$need_map" = "0" ]; then
  exec ${shQuote(realGit)} "$@"
fi
skip=0
n=$#
i=0
while [ "$i" -lt "$n" ]; do
  arg=$1
  shift
  i=$((i + 1))
  if [ "$skip" = "1" ]; then
    skip=0
    continue
  fi
  if [ "$arg" = "-c" ]; then
    case "$1" in
      protocol.allow=*|protocol.*.allow=*|credential.helper=*)
        skip=1
        continue
        ;;
    esac
  fi
  case "$arg" in
    https://github.com/${owner}/${name}|https://github.com/${owner}/${name}.git)
      arg=${shQuote(bare)}
      ;;
  esac
  set -- "$@" "$arg"
done
exec ${shQuote(realGit)} "$@"
`,
    { mode: 0o700 },
  );

  await writeFile(
    path.join(bin, "gh"),
    `#!/bin/sh
all="$*"
case "$all" in
  *"query BellDoor"*)
    echo '{"data":{"viewer":{"login":"${owner}"},"repository":{"viewerPermission":"WRITE","pullRequests":{"nodes":[]}}}}'
    exit 0
    ;;
  *"query BellIssueCheck"*)
    echo '{"data":{"viewer":{"login":"${owner}"},"repository":{"issue":null}}}'
    exit 0
    ;;
  *"query BellPacing"*)
    echo '{"data":{"repository":{"viewerPermission":"WRITE"},"open":{"issueCount":0},"merged":{"issueCount":0},"waiting":{"issueCount":0,"nodes":[]}}}'
    exit 0
    ;;
  *"query BellViewer"*)
    echo '{"data":{"viewer":{"login":"${owner}"}}}'
    exit 0
    ;;
esac
if [ "$1" = "api" ]; then
  for arg in "$@"; do
    case "$arg" in
      user)
        echo "${owner}"
        exit 0
        ;;
      repos/${owner}/${name}|repos/test-owner/shop)
        echo '{"full_name":"${owner}/${name}","private":false,"owner":{"login":"${owner}","type":"Organization"},"has_pull_requests":true,"pull_request_creation_policy":"all","archived":false,"disabled":false}'
        exit 0
        ;;
      repos/${owner}/.github*)
        echo 'gh: Not Found (HTTP 404)' >&2
        exit 1
        ;;
      */git/ref/heads/*)
        branch=\${arg##*/git/ref/heads/}
        exec ${shQuote(realGit)} --git-dir=${shQuote(bare)} rev-parse "refs/heads/$branch"
        ;;
      */pulls/*/commits)
        echo ""
        exit 0
        ;;
    esac
  done
fi
case "$1 $2" in
  "repo view")
    echo '{"viewerPermission":"WRITE","defaultBranchRef":{"name":"main"}}'
    exit 0
    ;;
  "pr list")
    echo '[]'
    exit 0
    ;;
  "pr create")
    seq=$(cat ${shQuote(prSeqFile)})
    seq=$((seq + 1))
    printf '%s' "$seq" > ${shQuote(prSeqFile)}
    echo "https://github.com/${owner}/${name}/pull/$seq"
    exit 0
    ;;
  "pr view")
    echo "OPEN"
    exit 0
    ;;
esac
exit 97
`,
    { mode: 0o700 },
  );

  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;

  return {
    url: `https://github.com/${owner}/${name}`,
    bare,
    upstreamCommit: async (files: Record<string, string>, message = "upstream change") => {
      await git(scratch, ["fetch", "-q", "origin"]);
      await git(scratch, ["checkout", "-q", "-B", "main", "origin/main"]);
      return commitUpstream(files, message);
    },
    head: async (branch: string) => {
      try {
        return (
          await git(bare, ["--git-dir", bare, "rev-parse", `refs/heads/${branch}`])
        ).stdout.trim();
      } catch {
        return "";
      }
    },
    restore: () => {
      process.env.PATH = previousPath;
    },
  };
}

async function integrationScene(
  t: TestContext,
  agents: (input: TeamAgentInput) => Promise<string> = async () => sessionReply(),
) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bell-collab-int-"));
  const github = await createFastShellGitHub(tempRoot);

  // Close live GroupPage stores BEFORE `collabFixture` stops `http.Server` (FIFO `t.after`).
  const pageCleanups: (() => void)[] = [];
  t.after(() => {
    while (pageCleanups.length > 0) pageCleanups.pop()?.();
  });

  const turns: TeamAgentInput[] = [];
  const runner: TeamAgentRunner = async (input) => {
    turns.push(input);
    return agents(input);
  };

  const f = await collabFixture(t, { runner });
  f.workbench.status = agentsReady;
  t.after(async () => {
    github.restore();
    await rm(tempRoot, { recursive: true, force: true });
  });

  const cast = await f.cast();
  const desk = await f.device("Desk D");
  const deeInvite = await f.invite(cast.who.admin, { name: "Dee" });
  const dee = await f.join(desk, deeInvite);
  const who = {
    ...cast.who,
    dee: { ...desk, [participantHeader]: dee.token } as Headers,
  };

  const repo = await f.workbench.importRepository(github.url);
  await git(repo.path, ["config", "user.name", "BELL Test"]);
  await git(repo.path, ["config", "user.email", "test@example.invalid"]);
  await git(repo.path, ["config", "commit.gpgsign", "false"]);

  const added = await f.post("/projects", who.admin, { repoId: repo.id });
  assert.equal(added.status, 201, added.body);
  const project = added.json.project.id as string;

  let runSeq = 0;
  const createReviewRun = async (
    owners: string[],
    {
      title = `Task ${runSeq + 1}`,
      branch = `feat/task-${runSeq + 1}`,
    }: { title?: string; branch?: string } = {},
  ) => {
    runSeq += 1;
    const id = `int-run-${runSeq}`;
    const baseSha = (await git(repo.path, ["rev-parse", "refs/heads/main"])).stdout.trim();
    const worktreePath = path.join(tempRoot, `wt-${id}`);
    await git(repo.path, ["branch", "--", branch, baseSha]);
    await git(repo.path, ["worktree", "add", worktreePath, branch]);
    await git(worktreePath, ["config", "user.name", "BELL Test"]);
    await git(worktreePath, ["config", "user.email", "test@example.invalid"]);
    await git(worktreePath, ["config", "commit.gpgsign", "false"]);
    const run: Run = {
      id,
      repoId: repo.id,
      title,
      prompt: `Implement ${title}`,
      status: "review",
      branch,
      baseBranch: "main",
      baseSha,
      worktreePath,
      owners,
      createdAt: new Date().toISOString(),
      locale: "en",
      agents: [],
      logs: [],
      draft: {
        title: `feat: ${title.toLowerCase()}`,
        body: "## Summary\n Focused update.\n\n## Validation\nTested locally.",
        commitMessage: `feat: ${title.toLowerCase()}`,
      },
      reviewedFiles: [],
      reviewedFingerprints: {},
    };
    f.store.data.runs.push(run);
    await f.store.save();
    return run;
  };

  const sendSessionTurn = async (runId: string, asWho: Headers, content: string) => {
    const beforeCount = f.workbench.run(runId).session?.messages.length ?? 0;
    const started = await f.send(
      "POST",
      `/api/runs/${runId}/session/messages`,
      { ...english, ...asWho },
      { content },
    );
    assert.equal(started.status, 200, started.body);
    await waitUntil(() => {
      const current = f.workbench.run(runId);
      const explanationsSettled = Object.values(current.explanations ?? {}).every(
        (item) => item.status !== "pending",
      );
      return (
        !current.session?.running &&
        current.draftPreparation?.status !== "generating" &&
        explanationsSettled &&
        (current.session?.messages.length ?? 0) >= beforeCount + 2
      );
    }, `session turn on ${runId}`);
    return f.workbench.run(runId).session!.messages.at(-1)!;
  };

  const reviewAndApprove = async (runId: string) => {
    const current = f.workbench.run(runId);
    for (const file of await readDiff(current))
      await f.workbench.review(runId, file.path, true, file.fingerprint);
    await f.workbench.approve(runId, { ...f.workbench.run(runId).draft });
  };

  const preflight = async (runId: string, asWho: Headers) => {
    const reply = await f.send("GET", `/api/runs/${runId}/preflight`, { ...english, ...asWho });
    assert.equal(reply.status, 200, reply.body);
    return reply.json.checks as DraftCheck[];
  };

  const publish = async (
    runId: string,
    asWho: Headers,
    extraAck: string[] = [],
  ) => {
    const headers = { ...english, ...asWho };
    const shown = await f.send("GET", `/api/runs/${runId}/preflight`, headers);
    if (shown.status !== 200) return shown;
    const checks = shown.json.checks as DraftCheck[];
    const acknowledged = [
      ...new Set([
        ...checks.filter((check) => check.kind === "confirm").map((check) => check.id),
        ...extraAck,
      ]),
    ];
    return f.send("POST", `/api/runs/${runId}/publish`, headers, {
      fingerprint: f.workbench.run(runId).approvedFingerprint,
      acknowledged,
    });
  };

  const readSideFile = async (): Promise<CollabSide> =>
    JSON.parse(await readFile(f.paths.collab, "utf8")) as CollabSide;

  const board = async (asWho: Headers = who.admin): Promise<CollabBoard> => {
    const reply = await f.send("GET", `/api/collab/projects/${project}/feed?wait=0`, asWho);
    assert.equal(reply.status, 200, reply.body);
    return reply.json.board as CollabBoard;
  };

  /**
   * Opens a real `createGroupStore()` (`src/collab/store.ts`) wired to this
   * live server as a self-code participant on `deviceHeaders`.
   */
  const openPageStore = async (asParticipant: Headers, deviceHeaders: Headers) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = String(input);
      const merged: Headers = { connection: "close", ...deviceHeaders };
      new Headers(init?.headers).forEach((value, key) => {
        merged[key] = value;
      });
      const parsedBody =
        typeof init?.body === "string" && init.body.length > 0
          ? (JSON.parse(init.body) as unknown)
          : undefined;
      const reply = await f.send(
        init?.method ?? "GET",
        rawUrl,
        merged,
        parsedBody,
        init?.signal ?? undefined,
      );
      return new Response(reply.status === 204 ? null : reply.body, {
        status: reply.status,
        headers: {
          "Content-Type": String(reply.headers["content-type"] ?? "application/json"),
        },
      });
    }) as typeof fetch;
    const store = createGroupStore();
    pageCleanups.push(() => {
      store.close();
      globalThis.fetch = realFetch;
    });
    const selfCode = await f.post("/invites", asParticipant, { self: true });
    assert.equal(selfCode.status, 201, selfCode.body);
    await store.join(selfCode.json.code as string);
    await waitUntil(() => store.get().held !== undefined, "GroupPage store initial board");
    return { store };
  };

  return {
    ...cast,
    f,
    github,
    dee,
    desk,
    who,
    turns,
    repo,
    project,
    createReviewRun,
    sendSessionTurn,
    reviewAndApprove,
    preflight,
    publish,
    readSideFile,
    board,
    openPageStore,
  };
}

before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

test("parallel non-overlapping holds: two members run write turns concurrently, GroupPage store & check/work reflect live state without leaking private titles, and both publish cleanly", async (t) => {
  let bothEntered = () => {};
  let arrived = 0;
  let overlapped = true;
  const barrier = new Promise<void>((resolve) => {
    bothEntered = resolve;
  });

  const s = await integrationScene(t, async (input) => {
    if (input.role === "session") {
      arrived += 1;
      if (arrived >= 2) bothEntered();
      await Promise.race([barrier, delay(5_000, undefined, { ref: false })]);
      if (arrived < 2) overlapped = false;
      if (input.prompt.includes("EDIT_USERS_API")) {
        await writeCheckoutFile(
          input.cwd,
          "src/api/users.ts",
          "export const users = ['alice'];\n",
        );
      } else if (input.prompt.includes("EDIT_WEB_SHELL")) {
        await writeCheckoutFile(
          input.cwd,
          "src/web/App.tsx",
          "export const App = () => 'shop-v2';\n",
        );
      }
      return sessionReply();
    }
    return "Reviewed.";
  });

  // Live GroupPage store connected as Ada, following the live `/feed` long-poll.
  const { store: adaPage } = await s.openPageStore(s.who.admin, s.devices.ada);
  assert.equal(adaPage.get().link, "live");
  assert.deepEqual(adaPage.get().held, []);

  const adaSecretTitle = "PRIVATE-ADA-API-PAGINATION";
  const benSecretTitle = "PRIVATE-BEN-WEB-SHELL";

  // Ada takes `src/api`; Ben checks `src/web` via `/check` and sees nothing in the way.
  const adaWork = await adaPage.call<CollabWorkResponse>(`/projects/${s.project}/work`, {
    method: "POST",
    body: JSON.stringify({ title: adaSecretTitle, scopes: ["src/api"] }),
  });
  assert.equal(adaWork.hold.title, adaSecretTitle);
  assert.deepEqual(adaWork.changing, []);

  const benCheckFree = await s.f.post(`/projects/${s.project}/check`, s.who.member, {
    scopes: ["src/web"],
  });
  assert.equal(benCheckFree.status, 200, benCheckFree.body);
  const freeCheck = benCheckFree.json as CollabCheckResponse;
  assert.deepEqual([freeCheck.invalid, freeCheck.meets, freeCheck.changing], [[], [], []]);

  // GroupPage's HoldAnswer & cannotTake contract on the free check response.
  const freeAnswer: Answer = { asOf: freeCheck.asOf, invalid: freeCheck.invalid, holds: [] };
  assert.equal(cannotTake(benSecretTitle, freeAnswer), false);
  assert.match(
    renderEn(createElement(HoldAnswer, { answer: freeAnswer })),
    /No one holds these paths, as far as BELL PR checked/,
  );

  // Ben takes `src/web`; Ada's live GroupPage store receives both holds in order without reload.
  const benWorkReply = await s.f.post(`/projects/${s.project}/work`, s.who.member, {
    title: benSecretTitle,
    scopes: ["src/web"],
  });
  assert.equal(benWorkReply.status, 201, benWorkReply.body);
  const benHold = (benWorkReply.json as CollabWorkResponse).hold;

  await waitUntil(() => (adaPage.get().held?.length ?? 0) === 2, "live feed delivers both holds");
  assert.deepEqual(
    adaPage.get().held?.map((item) => ({
      claimId: item.claimId,
      holder: item.holder,
      scopes: item.scopes,
    })),
    [
      { claimId: adaWork.hold.claimId, holder: s.ada.id, scopes: ["src/api"] },
      { claimId: benHold.claimId, holder: s.ben.id, scopes: ["src/web"] },
    ],
  );
  assert.ok(adaPage.get().present.includes(s.ada.id));

  // `collab.json` records `holds` baselines for both active claims.
  const sideDuringHolds = await s.readSideFile();
  assert.equal(Object.keys(sideDuringHolds.holds ?? {}).length, 2);

  // Ada and Ben run collaborative agent write turns simultaneously on non-overlapping files.
  const adaRun = await s.createReviewRun([s.ada.id], {
    title: "Paginate users endpoint",
    branch: "feat/users-api",
  });
  const benRun = await s.createReviewRun([s.ben.id], {
    title: "Update shop header",
    branch: "feat/web-header",
  });

  const [adaTurn, benTurn] = await Promise.all([
    s.sendSessionTurn(adaRun.id, s.who.admin, "EDIT_USERS_API"),
    s.sendSessionTurn(benRun.id, s.who.member, "EDIT_WEB_SHELL"),
  ]);
  assert.ok(overlapped, "the two write turns did not run at the same time");
  assert.equal(adaTurn.failed, undefined, adaTurn.content);
  assert.equal(benTurn.failed, undefined, benTurn.content);
  assert.equal(s.f.workbench.run(adaRun.id).heldPaths, undefined);
  assert.equal(s.f.workbench.run(benRun.id).heldPaths, undefined);

  // Privacy contract: NO agent prompt (session, draft, or explanations) receives private titles or holder names;
  // session prompts carry held paths only.
  const sessionTurns = s.turns.filter((turn) => turn.role === "session");
  assert.equal(sessionTurns.length, 2);
  for (const turn of s.turns) {
    assert.equal(turn.prompt.includes(adaSecretTitle), false);
    assert.equal(turn.prompt.includes(benSecretTitle), false);
    assert.equal(turn.prompt.includes("Ada"), false);
    assert.equal(turn.prompt.includes("Ben"), false);
  }
  for (const turn of sessionTurns) {
    assert.match(turn.prompt, /\["src\/(api|web)"\]/);
  }

  // While both runs are unfinished in `review`, Dee's `/check` sees both `meets` and `changing`,
  // whereas Ada's `/check` on `src/api` omits her own run from `changing`.
  const deeCheck = await s.f.post(`/projects/${s.project}/check`, s.who.dee, {
    scopes: ["src/api", "src/web"],
  });
  assert.equal(deeCheck.status, 200, deeCheck.body);
  const deeCheckBody = deeCheck.json as CollabCheckResponse;
  assert.deepEqual(
    deeCheckBody.meets.map((m) => ({ scope: m.scope, holder: m.holder, title: m.title })),
    [
      { scope: "src/api", holder: "Ada", title: adaSecretTitle },
      { scope: "src/web", holder: "Ben", title: benSecretTitle },
    ],
  );
  assert.deepEqual(
    deeCheckBody.changing
      .map((item) => ({ runId: item.runId, owners: item.owners, paths: item.paths }))
      .sort((a, b) => a.runId.localeCompare(b.runId)),
    [
      { runId: adaRun.id, owners: ["Ada"], paths: ["src/api/users.ts"] },
      { runId: benRun.id, owners: ["Ben"], paths: ["src/web/App.tsx"] },
    ],
  );

  const adaSelfCheck = await s.f.post(`/projects/${s.project}/check`, s.who.admin, {
    scopes: ["src/api"],
  });
  assert.deepEqual((adaSelfCheck.json as CollabCheckResponse).changing, []);

  // GroupPage's HoldAnswer & cannotTake block Dee when `meets` is non-empty.
  const blockedAnswer: Answer = {
    asOf: deeCheckBody.asOf,
    invalid: [],
    holds: deeCheckBody.meets.map((m) => ({
      name: m.holder,
      mine: false,
      title: m.title,
      paths: [m.scope],
    })),
  };
  assert.equal(cannotTake("Dee task", blockedAnswer), true);
  assert.match(renderEn(createElement(HoldAnswer, { answer: blockedAnswer })), /Ada/);

  // Both Ada and Ben pass preflight (no `held-by-other` check) and publish their PRs.
  await s.reviewAndApprove(adaRun.id);
  await s.reviewAndApprove(benRun.id);

  const adaChecks = await s.preflight(adaRun.id, s.who.admin);
  const benChecks = await s.preflight(benRun.id, s.who.member);
  assert.equal(adaChecks.some((c) => c.id === "held-by-other"), false);
  assert.equal(benChecks.some((c) => c.id === "held-by-other"), false);

  const adaPub = await s.publish(adaRun.id, s.who.admin);
  const benPub = await s.publish(benRun.id, s.who.member);
  assert.equal(adaPub.status, 200, adaPub.body);
  assert.equal(benPub.status, 200, benPub.body);
  assert.ok(await s.github.head("feat/users-api"));
  assert.ok(await s.github.head("feat/web-header"));

  // Releasing both holds updates the live GroupPage store to empty and cleans `collab.json` holds.
  await adaPage.call(
    `/projects/${s.project}/holds/${encodeURIComponent(adaWork.hold.claimId)}/release`,
    {
      method: "POST",
      body: JSON.stringify({ fence: adaWork.hold.fence }),
    },
  );
  const benRel = await s.f.post(
    `/projects/${s.project}/holds/${benHold.claimId}/release`,
    s.who.member,
    {
      fence: benHold.fence,
    },
  );
  assert.equal(benRel.status, 200, benRel.body);

  await waitUntil(() => adaPage.get().held?.length === 0, "live feed clears released holds");
  adaPage.close();
  assert.equal((await s.readSideFile()).holds, undefined);
  await s.f.nothingLeaked();
});

test("conflicting edits: plan approval, turns, and publish are hard-blocked, then recover via /holds/restore (keeping non-conflicting files) or /holds/recheck after release and admin revoke", async (t) => {
  const s = await integrationScene(t, async (input) => {
    if (input.role === "lead") {
      return planJson([{ id: "api-task", files: ["src/api/users.ts"] }]);
    }
    if (input.role === "session") {
      if (input.prompt.includes("BOTH_FREE_AND_HELD")) {
        await writeCheckoutFile(
          input.cwd,
          "src/web/App.tsx",
          "export const App = () => 'kept-free-edit';\n",
        );
        await writeCheckoutFile(
          input.cwd,
          "src/api/users.ts",
          "export const users = ['conflicting'];\n",
        );
      } else if (input.prompt.includes("TOUCH_API_ONLY")) {
        await writeCheckoutFile(
          input.cwd,
          "src/api/users.ts",
          "export const users = ['dee-after-release'];\n",
        );
      } else if (input.prompt.includes("TOUCH_DOCS_ONLY")) {
        await writeCheckoutFile(input.cwd, "docs/guide.md", "Guide updated by Dee\n");
      } else if (input.prompt.includes("VERIFY_PRIVACY_FOLLOWUP")) {
        await writeCheckoutFile(
          input.cwd,
          "src/web/App.tsx",
          "export const App = () => 'kept-free-edit';\n",
        );
      }
      return sessionReply();
    }
    return "Reviewed.";
  });

  const adaPrivateTitle = "CONFIDENTIAL-ADA-AUTH-REWRITE";
  const adaHoldReply = await s.f.post(`/projects/${s.project}/work`, s.who.admin, {
    title: adaPrivateTitle,
    scopes: ["src/api"],
  });
  assert.equal(adaHoldReply.status, 201, adaHoldReply.body);
  const adaHold = (adaHoldReply.json as CollabWorkResponse).hold;

  // 1. Plan approval over Ada's hold does not auto-start and refuses approval with 409 `heldByOther`.
  const startedPlanRun = await s.f.send(
    "POST",
    "/api/runs",
    { ...english, ...s.who.member },
    {
      repoId: s.repo.id,
      prompt: "Update users endpoint list",
      settings: contributionSettings(false),
    },
  );
  assert.equal(startedPlanRun.status, 202, startedPlanRun.body);
  const planRunId = startedPlanRun.json.run.id as string;
  await waitUntil(() => s.f.workbench.run(planRunId).status === "awaiting_plan", "plan ready");
  const approveBlocked = await s.f.send(
    "POST",
    `/api/runs/${planRunId}/plan/approve`,
    { ...english, ...s.who.member },
    {},
  );
  assert.equal(outcome(approveBlocked), "409 heldByOther");

  // 2. Ben's turn modifies both `src/web/App.tsx` (free) and `src/api/users.ts` (held by Ada):
  //    stopped at turn end, `heldPaths` records paths only, publish is blocked (409 `heldByOther`),
  //    `recheck` refuses while held, and `restore` reverts only `src/api/users.ts` so Ben publishes `src/web/App.tsx`.
  const benRun = await s.createReviewRun([s.ben.id], {
    title: "Mixed web and api edit",
    branch: "feat/mixed-edit",
  });
  const stoppedTurn = await s.sendSessionTurn(benRun.id, s.who.member, "BOTH_FREE_AND_HELD");
  assert.equal(stoppedTurn.failed, true);
  assert.deepEqual(stoppedTurn.heldPaths, ["src/api/users.ts"]);

  const benDetail = await s.f.send("GET", `/api/runs/${benRun.id}`, {
    ...english,
    ...s.who.member,
  });
  assert.equal(benDetail.status, 200, benDetail.body);
  assert.deepEqual(benDetail.json.run.heldPaths, ["src/api/users.ts"]);
  assert.equal(JSON.stringify(benDetail.json.run.heldPaths).includes("Ada"), false);
  assert.equal(JSON.stringify(benDetail.json.run.heldPaths).includes(adaPrivateTitle), false);

  // Subsequent session prompt after a held stop receives only `src/api/users.ts`, never holder or title.
  const sessionTurnsBefore = s.turns.filter((turn) => turn.role === "session").length;
  await s.sendSessionTurn(benRun.id, s.who.member, "VERIFY_PRIVACY_FOLLOWUP");
  const followupPrompt =
    s.turns.filter((turn) => turn.role === "session")[sessionTurnsBefore]?.prompt ?? "";
  assert.ok(followupPrompt.includes("src/api/users.ts"));
  for (const turn of s.turns) {
    assert.equal(turn.prompt.includes(adaPrivateTitle), false);
    assert.equal(turn.prompt.includes("Ada"), false);
  }

  // Preflight surfaces `held-by-other` (`block`), and publish refuses 409 `heldByOther` even if acknowledged.
  await s.reviewAndApprove(benRun.id);
  const blockedChecks = await s.preflight(benRun.id, s.who.member);
  const heldBlock = blockedChecks.find((check) => check.id === "held-by-other");
  assert.equal(heldBlock?.kind, "block");
  const blockedPub = await s.publish(benRun.id, s.who.member, ["held-by-other"]);
  assert.equal(outcome(blockedPub), "409 heldByOther");
  assert.equal(await s.github.head("feat/mixed-edit"), "");

  // Recheck while Ada still holds `src/api` returns 409 `heldByOther` without altering files.
  const earlyRecheck = await s.f.send(
    "POST",
    `/api/runs/${benRun.id}/holds/recheck`,
    { ...english, ...s.who.member },
    {},
  );
  assert.equal(outcome(earlyRecheck), "409 heldByOther");

  // Restore puts `src/api/users.ts` back to `baseSha`, preserves `src/web/App.tsx`, clears `heldPaths`, and publishes.
  const restored = await s.f.send(
    "POST",
    `/api/runs/${benRun.id}/holds/restore`,
    { ...english, ...s.who.member },
    {},
  );
  assert.equal(restored.status, 200, restored.body);
  const restoredBody = restored.json as HoldRestoreResponse;
  assert.deepEqual(restoredBody.restored, ["src/api/users.ts"]);
  assert.equal(restoredBody.run.heldPaths, undefined);
  assert.equal(
    await readFile(path.join(benRun.worktreePath, "src/api/users.ts"), "utf8"),
    seedFiles["src/api/users.ts"],
  );
  assert.equal(
    await readFile(path.join(benRun.worktreePath, "src/web/App.tsx"), "utf8"),
    "export const App = () => 'kept-free-edit';\n",
  );

  await s.reviewAndApprove(benRun.id);
  const benPubAfterRestore = await s.publish(benRun.id, s.who.member);
  assert.equal(benPubAfterRestore.status, 200, benPubAfterRestore.body);
  assert.ok(await s.github.head("feat/mixed-edit"));

  // 3. Recovery via `/holds/recheck` once the holder releases, and once an admin revokes.
  const deeApiRun = await s.createReviewRun([s.dee.id], {
    title: "Users filter update",
    branch: "feat/dee-api",
  });
  const deeStoppedOnApi = await s.sendSessionTurn(deeApiRun.id, s.who.dee, "TOUCH_API_ONLY");
  assert.equal(deeStoppedOnApi.failed, true);
  assert.deepEqual(s.f.workbench.run(deeApiRun.id).heldPaths, ["src/api/users.ts"]);

  // Ada releases `src/api`; Dee's `/holds/recheck` clears `heldPaths` while keeping Dee's edit, and publish succeeds.
  const adaReleased = await s.f.post(
    `/projects/${s.project}/holds/${adaHold.claimId}/release`,
    s.who.admin,
    { fence: adaHold.fence },
  );
  assert.equal(adaReleased.status, 200, adaReleased.body);

  const deeRechecked = await s.f.send(
    "POST",
    `/api/runs/${deeApiRun.id}/holds/recheck`,
    { ...english, ...s.who.dee },
    {},
  );
  assert.equal(deeRechecked.status, 200, deeRechecked.body);
  assert.equal((deeRechecked.json as HoldRecheckResponse).run.heldPaths, undefined);
  await s.reviewAndApprove(deeApiRun.id);
  const deePub = await s.publish(deeApiRun.id, s.who.dee);
  assert.equal(deePub.status, 200, deePub.body);

  // Admin revoke path: Ben holds `docs/guide.md`, Dee hits it, Ada revokes Ben's hold, Dee rechecks cleanly.
  const benDocsWork = await s.f.post(`/projects/${s.project}/work`, s.who.member, {
    title: "PRIVATE-BEN-DOCS-HOLD",
    scopes: ["docs/guide.md"],
  });
  assert.equal(benDocsWork.status, 201, benDocsWork.body);
  const benDocsHold = (benDocsWork.json as CollabWorkResponse).hold;

  const deeDocsRun = await s.createReviewRun([s.dee.id], {
    title: "Guide update",
    branch: "feat/dee-docs",
  });
  const deeStoppedOnDocs = await s.sendSessionTurn(deeDocsRun.id, s.who.dee, "TOUCH_DOCS_ONLY");
  assert.equal(deeStoppedOnDocs.failed, true);
  assert.deepEqual(s.f.workbench.run(deeDocsRun.id).heldPaths, ["docs/guide.md"]);

  const adminRevoked = await s.f.post(
    `/projects/${s.project}/holds/${benDocsHold.claimId}/revoke`,
    s.who.admin,
    {},
  );
  assert.equal(adminRevoked.status, 200, adminRevoked.body);
  assert.equal((await s.readSideFile()).holds, undefined);

  const deeDocsRechecked = await s.f.send(
    "POST",
    `/api/runs/${deeDocsRun.id}/holds/recheck`,
    { ...english, ...s.who.dee },
    {},
  );
  assert.equal(deeDocsRechecked.status, 200, deeDocsRechecked.body);
  assert.equal((deeDocsRechecked.json as HoldRecheckResponse).run.heldPaths, undefined);
  await s.f.nothingLeaked();
});

test("dependsOn & hold baselines: unfinished or non-done prerequisites block claiming, done release (including in-flight) unblocks and appears on GroupPage store, and upstream changes under active holds surface at preflight", async (t) => {
  const s = await integrationScene(t);
  const { store: benPage } = await s.openPageStore(s.who.member, s.devices.ben);

  // 1. Ben takes prerequisite task 1 (`src/api`) and releases WITHOUT `done`:
  //    Dee's dependent work is refused while held (`held: true`) AND permanently refused after non-done release (`held: false`).
  const firstWork = await s.f.post(`/projects/${s.project}/work`, s.who.member, {
    title: "API v1 attempt",
    scopes: ["src/api"],
  });
  assert.equal(firstWork.status, 201, firstWork.body);
  const firstHold = (firstWork.json as CollabWorkResponse).hold;

  const blockedWhileHeld = await s.f.post(
    `/projects/${s.project}/work`,
    { ...english, ...s.who.dee },
    {
      title: "Web consumer",
      scopes: ["src/web"],
      dependsOn: [firstHold.taskId],
    },
  );
  assert.equal(outcome(blockedWhileHeld), "409 dependencyPending");
  assert.deepEqual(blockedWhileHeld.json.pending, [
    { taskId: firstHold.taskId, title: "API v1 attempt", held: true },
  ]);

  const releasedNotDone = await s.f.post(
    `/projects/${s.project}/holds/${firstHold.claimId}/release`,
    s.who.member,
    { fence: firstHold.fence },
  );
  assert.equal(releasedNotDone.status, 200, releasedNotDone.body);

  const blockedAfterAbandoned = await s.f.post(
    `/projects/${s.project}/work`,
    { ...english, ...s.who.dee },
    {
      title: "Web consumer",
      scopes: ["src/web"],
      dependsOn: [firstHold.taskId],
    },
  );
  assert.equal(outcome(blockedAfterAbandoned), "409 dependencyPending");
  assert.deepEqual(blockedAfterAbandoned.json.pending, [
    { taskId: firstHold.taskId, title: "API v1 attempt", held: false },
  ]);

  // 2. A revoked prerequisite is also `held: false` and blocks dependent work.
  const revokedPrereqWork = await s.f.post(`/projects/${s.project}/work`, s.who.member, {
    title: "Stuck API task",
    scopes: ["src/api"],
  });
  const revokedPrereq = (revokedPrereqWork.json as CollabWorkResponse).hold;
  const revoked = await s.f.post(
    `/projects/${s.project}/holds/${revokedPrereq.claimId}/revoke`,
    s.who.admin,
    {},
  );
  assert.equal(revoked.status, 200, revoked.body);

  const blockedAfterRevoke = await s.f.post(
    `/projects/${s.project}/work`,
    { ...english, ...s.who.dee },
    {
      title: "Web consumer",
      scopes: ["src/web"],
      dependsOn: [revokedPrereq.taskId],
    },
  );
  assert.equal(outcome(blockedAfterRevoke), "409 dependencyPending");
  assert.deepEqual(blockedAfterRevoke.json.pending, [
    { taskId: revokedPrereq.taskId, title: "Stuck API task", held: false },
  ]);

  // 3. Ben takes `API v2` and releases with `done: true` while Dee concurrently submits `dependsOn: [apiV2.taskId]`:
  //    inOrder turn-taking lets Dee's claim wait for the `done` write and succeed with `dependsOn` populated on the board & store.
  const apiV2Work = await s.f.post(`/projects/${s.project}/work`, s.who.member, {
    title: "API v2 schema",
    scopes: ["src/api"],
  });
  assert.equal(apiV2Work.status, 201, apiV2Work.body);
  const apiV2Hold = (apiV2Work.json as CollabWorkResponse).hold;

  const saveSide = s.f.collab.saveSide;
  let releaseWriteEntered = false;
  let allowReleaseWrite = () => {};
  const gate = new Promise<void>((resolve) => {
    allowReleaseWrite = resolve;
  });
  const saveMock = t.mock.method(
    s.f.collab,
    "saveSide",
    async (change: Parameters<typeof saveSide>[0]) => {
      if (!releaseWriteEntered) {
        releaseWriteEntered = true;
        await gate;
      }
      return saveSide(change);
    },
  );

  const doneReleasePromise = s.f.post(
    `/projects/${s.project}/holds/${apiV2Hold.claimId}/release`,
    s.who.member,
    { fence: apiV2Hold.fence, done: true },
  );
  await waitUntil(() => releaseWriteEntered, "done release saveSide entered");

  const deeClaimPromise = s.f.post(
    `/projects/${s.project}/work`,
    { ...english, ...s.who.dee },
    {
      title: "Web v2 integration",
      scopes: ["src/web"],
      dependsOn: [apiV2Hold.taskId],
    },
  );
  await delay(30);
  allowReleaseWrite();

  const [doneRelease, deeClaim] = await Promise.all([doneReleasePromise, deeClaimPromise]);
  saveMock.mock.restore();
  assert.equal(doneRelease.status, 200, doneRelease.body);
  assert.equal(deeClaim.status, 201, deeClaim.body);
  const deeHold: CollabHold = (deeClaim.json as CollabWorkResponse).hold;
  assert.deepEqual(deeHold.dependsOn, [{ taskId: apiV2Hold.taskId, title: "API v2 schema" }]);

  // Live GroupPage store receives Dee's hold with `dependsOn` intact, and `collab.json` holds tracks only Dee's active claim.
  await waitUntil(
    () => benPage.get().held?.some((item) => item.claimId === deeHold.claimId) === true,
    "GroupPage store receives dependent hold",
  );
  assert.deepEqual(benPage.get().held?.[0]?.dependsOn, [
    { taskId: apiV2Hold.taskId, title: "API v2 schema" },
  ]);
  const sideAfterDependentClaim = await s.readSideFile();
  assert.deepEqual(Object.keys(sideAfterDependentClaim.holds ?? {}), [
    `${s.project}/${deeHold.taskId}`,
  ]);

  // 4. Upstream commit landing on `main` under Dee's active hold (`src/web/App.tsx`) is detected at sync & preflight.
  const deeRun = await s.createReviewRun([s.dee.id], {
    title: "Web v2 consumer",
    branch: "feat/dee-web-v2",
  });
  await writeCheckoutFile(deeRun.worktreePath, "README.md", "# shop v2\n");
  await s.reviewAndApprove(deeRun.id);

  await s.github.upstreamCommit(
    { "src/web/App.tsx": "export const App = () => 'upstream-hotfix';\n" },
    "hotfix web outside BELL PR",
  );
  await git(s.repo.path, ["fetch", "-q", "origin", "main:refs/remotes/origin/main"]);
  await git(s.repo.path, ["update-ref", "refs/heads/main", "refs/remotes/origin/main"]);

  const deeChecks = await s.preflight(deeRun.id, s.who.dee);
  const upstreamCheck = deeChecks.find((check) => check.id === "held-changed-upstream");
  assert.equal(upstreamCheck?.kind, "confirm");

  const finalRelease = await s.f.post(
    `/projects/${s.project}/holds/${deeHold.claimId}/release`,
    s.who.dee,
    { fence: deeHold.fence, done: true },
  );
  assert.equal(finalRelease.status, 200, finalRelease.body);
  benPage.close();
  assert.equal((await s.readSideFile()).holds, undefined);
  await s.f.nothingLeaked();
});

test("second paired device redeeming { self: true } invite succeeds on createRun, syncRun, preflight, and publish over own held paths via x-bell-participant", async (t) => {
  let leadCalls = 0;
  const s = await integrationScene(t, async (input) => {
    if (input.role === "lead") {
      return leadCalls++ === 0
        ? planJson([{ id: "web-task", files: ["src/web/App.tsx"] }])
        : "Integrated web-task.";
    }
    if (input.role === "reviewer" || input.role === "tester") {
      return "Reviewed: no problems.";
    }
    if (input.taskId) {
      await writeCheckoutFile(
        input.cwd,
        "src/web/App.tsx",
        "export const App = () => 'ben-second-device';\n",
      );
      return JSON.stringify({ report: "Updated web shell on second device", messages: [] });
    }
    return sessionReply();
  });

  // Ben holds `src/web` and `docs/guide.md` from his first device.
  const holdReply = await s.f.post(`/projects/${s.project}/work`, s.who.member, {
    title: "Ben multi-device hold",
    scopes: ["src/web", "docs/guide.md"],
  });
  assert.equal(holdReply.status, 201, holdReply.body);
  const benHold = (holdReply.json as CollabWorkResponse).hold;

  // Ben pairs a second device (`laptop2`, distinct `deviceId`) and redeems a `{ self: true }` invite.
  const laptop2 = await s.f.device("Ben Laptop 2");
  const selfInvite = await s.f.invite(s.who.member, { self: true });
  const joinedOnSecond = await s.f.join(laptop2, selfInvite);
  assert.equal(joinedOnSecond.id, s.ben.id);
  const benOnSecond: Headers = { ...laptop2, [participantHeader]: joinedOnSecond.token };

  // `collab.json` still records Ben's first deviceId, so `laptop2` without `x-bell-participant` is NOT recognized as Ben.
  const unauthenticatedDeviceRun = await s.f.send(
    "POST",
    "/api/runs",
    { ...english, ...laptop2 },
    {
      repoId: s.repo.id,
      prompt: "Update web shell without participant header",
      settings: contributionSettings(false),
    },
  );
  assert.equal(unauthenticatedDeviceRun.status, 202, unauthenticatedDeviceRun.body);
  const unauthRunId = unauthenticatedDeviceRun.json.run.id as string;
  assert.equal(unauthenticatedDeviceRun.json.run.owners, undefined);
  await waitUntil(() => s.f.workbench.run(unauthRunId).status === "awaiting_plan", "unauth run held at plan");
  await s.f.send("POST", `/api/runs/${unauthRunId}/cancel`, { ...english, ...laptop2 }, {});

  // With `x-bell-participant`, `createRun` on `laptop2` records `owners: [s.ben.id]`, auto-approves over Ben's hold, and finishes in `review`.
  leadCalls = 0;
  const created = await s.f.send(
    "POST",
    "/api/runs",
    { ...english, ...benOnSecond },
    {
      repoId: s.repo.id,
      prompt: "Update web shell from second paired device",
      title: "Second device web update",
      settings: contributionSettings(false),
    },
  );
  assert.equal(created.status, 202, created.body);
  const runId = created.json.run.id as string;
  assert.deepEqual(created.json.run.owners, [s.ben.id]);
  await waitUntil(() => {
    const current = s.f.workbench.run(runId);
    const explanationsSettled = Object.values(current.explanations ?? {}).every(
      (item) => item.status !== "pending",
    );
    return (
      ["review", "failed"].includes(current.status) &&
      current.draftPreparation?.status !== "generating" &&
      explanationsSettled
    );
  }, "second device run reaches review and settles");
  const runRecord = s.f.workbench.run(runId);
  assert.equal(runRecord.status, "review", runRecord.error);
  assert.equal(runRecord.heldPaths, undefined);

  // Upstream touches `docs/guide.md` (also held by Ben); `syncRun` on `laptop2` with `x-bell-participant` syncs cleanly and reports `heldChanges`.
  const upstreamSha = await s.github.upstreamCommit(
    { "docs/guide.md": "Guide v2 upstream\n" },
    "upstream docs update under Ben hold",
  );
  const synced = await s.f.send("POST", `/api/runs/${runId}/sync`, { ...english, ...benOnSecond }, {});
  assert.equal(synced.status, 200, synced.body);
  assert.equal(synced.json.updated, true);
  assert.deepEqual(synced.json.conflicts, []);
  assert.deepEqual(synced.json.heldChanges, [
    { path: "docs/guide.md", commits: [upstreamSha.slice(0, 7)] },
  ]);

  // Prepare clean draft, review, and approve.
  const syncedRun = s.f.workbench.run(runId);
  syncedRun.draft = {
    title: "feat: second device web update",
    body: "## Summary\nUpdated web shell.\n\n## Validation\nTested locally.",
    commitMessage: "feat: second device web update",
    publishBranch: "feat/second-device-web",
  };
  await s.f.store.save();
  await s.reviewAndApprove(runId);

  // Without `x-bell-participant`, `laptop2` is blocked on preflight and publish by Ben's own hold.
  const checksWithoutToken = await s.preflight(runId, laptop2);
  assert.equal(checksWithoutToken.some((c) => c.id === "held-by-other" && c.kind === "block"), true);
  const pubWithoutToken = await s.publish(runId, laptop2, ["held-by-other"]);
  assert.equal(outcome(pubWithoutToken), "409 heldByOther");

  // With `x-bell-participant`, `laptop2` passes preflight (no `held-by-other`, surfaces `held-changed-upstream`) and publishes cleanly.
  const checksWithToken = await s.preflight(runId, benOnSecond);
  assert.equal(checksWithToken.some((c) => c.id === "held-by-other"), false);
  assert.equal(
    checksWithToken.some((c) => c.id === "held-changed-upstream" && c.kind === "confirm"),
    true,
  );
  const pubWithToken = await s.publish(runId, benOnSecond);
  assert.equal(pubWithToken.status, 200, pubWithToken.body);
  assert.ok(await s.github.head("feat/second-device-web"));

  const released = await s.f.post(
    `/projects/${s.project}/holds/${benHold.claimId}/release`,
    benOnSecond,
    { fence: benHold.fence, done: true },
  );
  assert.equal(released.status, 200, released.body);
  await s.f.nothingLeaked();
});
