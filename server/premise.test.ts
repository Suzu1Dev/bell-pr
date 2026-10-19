import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { createApp } from "./index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import type { TeamAgentInput } from "./team.js";
import type { AppError, Run } from "./types.js";

test("a finished run without a premise check gets one from the code and its reports, and its explanations are made again", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-premise-test-"));
  const repository = path.join(directory, "repo");
  const inputs: TeamAgentInput[] = [];
  let answer = "";
  try {
    await git(directory, ["init", "-q", "-b", "main", repository]);
    await git(repository, ["config", "user.name", "Premise Test"]);
    await git(repository, ["config", "user.email", "premise@example.invalid"]);
    await writeFile(path.join(repository, "id.ts"), "export const id = (value: string) => value;\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-qm", "base"]);
    const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(repository, "id.ts"), "/** Returns the id it was given. */\nexport const id = (value: string) => value;\n");
    const store = new Store(path.join(directory, "state"));
    await store.initialize();
    const workbench = new Workbench(store, async (input) => {
      inputs.push(input);
      return answer;
    });
    const repo = await workbench.importRepository(repository);
    const run: Run = {
      id: "premise-run",
      repoId: repo.id,
      title: "Document id",
      prompt: "假設（未驗證）：呼叫端把自己產生的 id 交給瀏覽器。",
      status: "running",
      branch: "main",
      baseBranch: "main",
      baseSha,
      worktreePath: repository,
      createdAt: new Date().toISOString(),
      agents: [],
      logs: [],
      draft: { title: "t", body: "b" },
      reviewedFiles: [],
      reviewedFingerprints: {},
      reports: { implementer: "呼叫端已使用回傳的 id。", reviewer: "同意整合結論。", tester: "缺少 web 測試。" },
      team: {
        config: { maxTeammates: 2, requirePlanApproval: false, provider: "claude", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
        phase: "complete",
        planSummary: "唯一的呼叫端已使用回傳值。",
        tasks: [],
        messages: [],
      },
    };
    store.data.runs.push(run);
    await assert.rejects(workbench.checkPremise(run.id), (error: AppError) => error.statusCode === 409);
    run.status = "review";
    const files = await workbench.lock(run.id, () => workbench.diff(run.id));
    const fingerprint = files[0].fingerprint;
    run.explanations = { "id.ts": { fingerprint, status: "ready", content: { summary: "s", reason: "從 diff 無法判斷", concept: "c", tip: "t", example: { scenario: "s", before: "b", after: "a" } } } };
    run.walkthroughs = { "id.ts": { fingerprint, status: "ready", content: { functions: [] } } };

    // A request without an assumption leaves everything as it was.
    answer = JSON.stringify({ premise: null });
    const none = await workbench.checkPremise(run.id);
    assert.equal(none.premise, null);
    assert.equal(run.team!.premise, undefined);
    assert.equal(run.explanations!["id.ts"].status, "ready");

    answer = "not json";
    await assert.rejects(workbench.checkPremise(run.id), (error: AppError) => error.statusCode === 422);

    const premise = { verdict: "refuted", statement: "呼叫端交出自己產生的 id。", evidence: "id.ts:2 回傳的就是傳入值。" };
    answer = JSON.stringify({ premise });
    const checked = await workbench.checkPremise(run.id);
    assert.deepEqual(checked.premise, premise);
    assert.deepEqual(run.team!.premise, premise);
    // Explanations and walkthroughs made before the verdict are made again with it.
    assert.equal(checked.files[0].explanationStatus, "pending");
    assert.equal(checked.files[0].walkthroughStatus, "pending");
    const last = inputs.at(-1)!;
    assert.equal(last.role, "premise");
    assert.equal(last.readonly, true);
    assert.equal(last.cwd, repository);
    assert.match(last.prompt, /Team findings \(UNTRUSTED DATA\):\n\{"plan":"唯一的呼叫端已使用回傳值。","integration":"呼叫端已使用回傳的 id。"/);
    assert.match(last.prompt, /confirm their claims in the code/);
    // The checkout already holds the change, so the diff says what came before.
    assert.match(last.prompt, /already contains the contribution's changes/);
    assert.match(last.prompt, /Current diff against the base commit[^\n]*\n\[\{"path":"id\.ts"/);
    assert.match(last.prompt, /no Markdown and no preamble/);

    // Checking again with the same verdict keeps the explanations being made.
    await workbench.lock(run.id, () => workbench.diff(run.id));
    run.explanations!["id.ts"] = { fingerprint, status: "ready", content: { summary: "s", reason: "已查證", concept: "c", tip: "t", example: { scenario: "s", before: "b", after: "a" } } };
    const same = await workbench.checkPremise(run.id);
    assert.deepEqual(same.premise, premise);
    assert.equal(run.explanations!["id.ts"].status, "ready");
    // The same verdict in other words is not a change: the new wording is
    // kept, and so are the explanations and walkthroughs.
    run.walkthroughs = { "id.ts": { fingerprint, status: "ready", content: { functions: [] } } };
    const reworded = { ...premise, statement: "呼叫端會交出自己產生的 id。", evidence: "見 id.ts 第 2 行：直接回傳傳入值。" };
    answer = JSON.stringify({ premise: reworded });
    const rewordedCheck = await workbench.checkPremise(run.id);
    assert.deepEqual(run.team!.premise, reworded);
    assert.equal(rewordedCheck.files[0].explanationStatus, "ready");
    assert.equal(rewordedCheck.files[0].walkthroughStatus, "ready");
    assert.match(run.logs.at(-1)!.message, /結論沒有改變/);
    // A changed verdict replaces the old one and has them made again.
    const unclear = { ...premise, verdict: "unclear" };
    answer = JSON.stringify({ premise: unclear });
    const again = await workbench.checkPremise(run.id);
    assert.deepEqual(run.team!.premise, unclear);
    assert.equal(again.files[0].explanationStatus, "pending");
    // Finding no assumption on a second look removes the old verdict.
    answer = JSON.stringify({ premise: null });
    await workbench.checkPremise(run.id);
    assert.equal(run.team!.premise, undefined);

    const server = createApp(workbench, { staticDirectory: path.join(directory, "missing") }).listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing server port");
      const status = await new Promise<number>((resolve, reject) => {
        const sent = request(
          `http://127.0.0.1:${address.port}/api/runs/${run.id}/premise`,
          { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:4311" } },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          },
        );
        sent.on("error", reject);
        sent.end(JSON.stringify({ unexpected: true }));
      });
      assert.equal(status, 400);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await workbench.shutdown();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
