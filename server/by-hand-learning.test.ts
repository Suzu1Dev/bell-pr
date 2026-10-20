// The learning record of a Learn-by-hand run (DESIGN v1.2 F13): the
// learning page lists it for its record even without explanations or notes
// (which come only on request), with its plain counts; an agent run with
// neither stays out, as before. The complete export (Pro, unchanged gate)
// gains a "Learn by hand" section.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { buildLearningExport } from "../shared/learning-export.js";
import { assertNoHan } from "../src/test-utils/render.js";
import { createApp } from "./index.js";
import { fixedLicense } from "./license.js";
import { Store } from "./store.js";
import type { Repository, Run } from "./types.js";
import { Workbench } from "./workbench.js";

const repo: Repository = {
  id: "repo-lbh",
  name: "widgets",
  owner: "acme",
  fullName: "acme/widgets",
  path: "/nonexistent/repo-lbh",
  defaultBranch: "main",
  url: "https://github.com/acme/widgets",
};

function run(id: string, extra: Partial<Run> = {}): Run {
  return {
    id,
    repoId: repo.id,
    title: "Retry failed requests",
    prompt: "Retry temporary failures.",
    status: "review",
    branch: "fix/lbh",
    baseBranch: "main",
    baseSha: "",
    worktreePath: `/nonexistent/worktrees/${id}`,
    createdAt: "2026-10-20T00:00:00.000Z",
    locale: "en",
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "complete", detail: "" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "" },
    ],
    logs: [],
    draft: { title: "Retry failed requests", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    ...extra,
  };
}

const byHand: Run["byHand"] = {
  events: [
    { at: "2026-10-20T00:01:00.000Z", kind: "explain", source: "premise" },
    { at: "2026-10-20T00:05:00.000Z", kind: "answer", source: "hint", rung: 1 },
    { at: "2026-10-20T00:06:00.000Z", kind: "answer", source: "ask" },
  ],
  tests: [{ at: "2026-10-20T00:10:00.000Z", command: "npm test", changeFingerprint: "f1", outcome: "failed", ms: 10, prediction: "fail" }],
  thread: [{ id: "e1", at: "2026-10-20T00:05:00.000Z", kind: "hint", rung: 1, text: "Look at src/retry.ts:4.", removed: 1 }],
  removedTotal: 1,
};

async function serve(t: TestContext, runs: Run[]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-learning-"));
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  store.data.repos.push(repo);
  store.data.runs.push(...runs);
  const workbench = new Workbench(store);
  const app = createApp(workbench, { staticDirectory: path.join(directory, "missing"), license: fixedLicense("free") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  return () =>
    new Promise<{ status: number; body: { runs: Record<string, unknown>[] } }>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${port}/api/learning`, { headers: { Host: "127.0.0.1:4311" } }, (response) => {
        let received = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (received += chunk));
        response.on("end", () => resolve({ status: response.statusCode!, body: JSON.parse(received) }));
      });
      req.on("error", reject);
      req.end();
    });
}

test("the learning page lists a Learn-by-hand run for its record, and still skips an empty agent run", async (t) => {
  const get = await serve(t, [run("lbh", { learnByHand: true, byHand }), run("agent")]);
  const page = await get();
  assert.equal(page.status, 200);
  assert.deepEqual(page.body.runs.map((entry) => entry.id), ["lbh"]);
  const [entry] = page.body.runs as { learnByHand?: boolean; byHandSummary?: { helps: object; hintRequests: number; removedAnswers: number } }[];
  assert.equal(entry.learnByHand, true);
  assert.deepEqual(entry.byHandSummary?.helps, { explain: 1, answer: 2 });
  assert.equal(entry.byHandSummary?.hintRequests, 1);
  assert.equal(entry.byHandSummary?.removedAnswers, 1);
});

test("the complete export gains a Learn by hand section, with the claim only for a clean run", () => {
  const clean = buildLearningExport(run("lbh", { learnByHand: true, byHand }), repo, "en");
  const section = clean.slice(clean.indexOf("## Learn by hand"));
  assert.match(
    section,
    /^## Learn by hand\n\nBELL PR's agents had no write access and gave you no code for this change\.\n\n- Help from the guide: explanations 1, answers 2\n- Your first prediction after each change was right 1 of 1 times; Not sure 0\n- BELL PR removed code from 1 answers before you saw them\n\nBELL PR can't see other tools you used, such as editor autocomplete\. This record is for you; it isn't proof of who wrote the code\./,
  );
  assertNoHan(clean);
  const unclean = buildLearningExport(run("lbh", { learnByHand: true, byHand: { ...byHand, agentWrites: 1 } }), repo, "en");
  assert.ok(unclean.includes("BELL PR saw agent edits in this run, so it makes no Learn-by-hand claim for it."));
  assert.ok(!unclean.includes("had no write access"));
  const fitted = buildLearningExport(
    run("lbh", {
      learnByHand: true,
      byHand: { ...byHand, helpLock: { kinds: ["explain", "answer"], at: "2026-10-20T00:00:00.000Z", rulesCheckedAt: "2026-10-19T00:00:00.000Z", rules: [] } },
    }),
    repo,
    "zh-TW",
  );
  assert.ok(fitted.includes("## 親手學"));
  assert.ok(fitted.includes("開始時就配合了專案的規範：嚮導只提供解說和回答。"));
  assert.ok(!buildLearningExport(run("agent"), repo, "en").includes("## Learn by hand"));
});
