import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import { draftFingerprint, draftPrompt, parseDraftProposal } from "./drafts.js";
import type { DraftContext, DraftProposal } from "../shared/drafts.js";
import { defaultContributionSettings } from "../shared/insights.js";
import type { DiffFile, Run } from "./types.js";
import type { TeamAgentRunner } from "./team.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { createApp } from "./index.js";
import { git } from "./process.js";

const context: DraftContext = {
  sources: [],
  warnings: [],
  checkedAt: "2026-10-03T00:00:00Z",
  baseSha: "base",
};
const proposal: DraftProposal = {
  title: "Update the exported value",
  body: "## Problem\n\nThe value needs updating.\n\n## Changes\n\nChange the value from 1 to 2.\n\n## Validation\n\nNo executed test evidence was supplied.\n\nDeveloped with AI assistance; human review is required.",
  policy: "linux",
  summary: "用 Linux 投稿寫作原則說明動機與驗證限制。",
  rules: [],
  checklist: ["請確認測試證據。"],
  templateSourceId: "",
};
const diff: DiffFile = {
  path: "a.ts",
  patch: "+export const value = 2;",
  fingerprint: "a".repeat(64),
  language: "TypeScript",
  additions: 1,
  deletions: 1,
  status: "modified",
  hunks: [],
};

test("draft proposals require exact authoritative quotes, preserve template headings, and never certify checks or sign-offs", () => {
  const sourceContext: DraftContext = {
    ...context,
    sources: [
      {
        id: "guide",
        kind: "contributing",
        label: "Contributing",
        content: "Use an imperative title. Provide test evidence.",
      },
      {
        id: "template",
        kind: "template",
        label: "PR template",
        content:
          "## Problem\n<!-- Describe motivation -->\n## Validation\n- [ ] Human confirmation",
      },
      {
        id: "merged",
        kind: "example",
        label: "Merged PR",
        content: "Use a very long title.",
      },
    ],
  };
  const good = {
    ...proposal,
    policy: "repository",
    templateSourceId: "template",
    rules: [
      {
        text: "標題用祈使句",
        sourceId: "guide",
        quote: "Use an imperative title.",
      },
    ],
  };
  assert.equal(
    parseDraftProposal(JSON.stringify(good), sourceContext).policy,
    "repository",
  );
  // Only whitespace may differ from the source; case and punctuation are checked literally.
  assert.equal(
    parseDraftProposal(
      JSON.stringify({
        ...good,
        rules: [{ ...good.rules[0], quote: "Use  an imperative\ntitle." }],
      }),
      sourceContext,
    ).rules[0].quote,
    "Use  an imperative\ntitle.",
  );
  for (const invalid of [
    { ...good, rules: [{ ...good.rules[0], quote: "Invented quote" }] },
    { ...good, rules: [{ ...good.rules[0], quote: "use an imperative title." }] },
    { ...good, rules: [{ ...good.rules[0], quote: "Use an imperative title!" }] },
    { ...good, rules: [{ ...good.rules[0], sourceId: "missing" }] },
    {
      ...good,
      rules: [
        {
          text: "推測偏好",
          sourceId: "merged",
          quote: "Use a very long title.",
        },
      ],
    },
    { ...good, templateSourceId: "" },
    { ...good, body: "## Problem\nMissing validation section." },
    { ...good, policy: "linux" },
    {
      ...good,
      body: good.body + "\nSigned-off-by: Somebody <somebody@example.invalid>",
    },
    { ...good, body: good.body + "\n- [x] Human confirmation" },
  ])
    assert.throws(() =>
      parseDraftProposal(JSON.stringify(invalid), sourceContext),
    );
  // A commit message suggestion cites supplied sources and never signs for the person.
  const suggestion = {
    message: "docs(value): update the exported value\n\nExplain why.",
    rationale: "Contributing 要求主旨使用祈使句。",
    sources: ["guide"],
  };
  const suggested = parseDraftProposal(
    JSON.stringify({ ...good, commitMessageSuggestion: suggestion }),
    sourceContext,
  );
  assert.deepEqual(suggested.commitMessageSuggestion, suggestion);
  assert.equal(
    "commitMessageSuggestion" in
      parseDraftProposal(
        JSON.stringify({ ...good, commitMessageSuggestion: null }),
        sourceContext,
      ),
    false,
  );
  for (const [invalid, reason] of [
    [
      {
        ...suggestion,
        message: `${suggestion.message}\n\nSigned-off-by: Somebody <somebody@example.invalid>`,
      },
      /署名/,
    ],
    [
      {
        ...suggestion,
        message: `${suggestion.message}\nCo-authored-by: Somebody <somebody@example.invalid>`,
      },
      /署名/,
    ],
    [{ ...suggestion, sources: ["merged"] }, /來源不存在/],
    [{ ...suggestion, sources: ["missing"] }, /來源不存在/],
    [{ ...suggestion, message: "" }, /格式不完整/],
  ] as const)
    assert.throws(
      () =>
        parseDraftProposal(
          JSON.stringify({ ...good, commitMessageSuggestion: invalid }),
          sourceContext,
        ),
      reason,
    );
  assert.throws(
    () =>
      parseDraftProposal(
        JSON.stringify({ ...proposal, policy: "repository" }),
        context,
      ),
    /需要可核對/,
  );
  assert.throws(
    () =>
      parseDraftProposal(JSON.stringify(proposal), {
        ...context,
        sources: [sourceContext.sources[0]],
      }),
    /已有適用/,
  );
  assert.match(
    parseDraftProposal(JSON.stringify(proposal), {
      ...context,
      warnings: ["Remote lookup unavailable"],
    }).summary,
    /暫用/,
  );
});

test("draft prompt keeps complete bounded safe diffs and distinguishes unavailable evidence from absence", () => {
  const run = {
    title: "Update",
    prompt: "Update value",
    reports: { tester: "Static analysis only." },
  };
  const prompt = draftPrompt(
    run,
    [
      diff,
      { ...diff, path: ".env", blocked: "Sensitive", patch: "secret hidden" },
    ],
    { ...context, warnings: ["Lookup failed"] },
  );
  assert.doesNotMatch(prompt, /secret hidden/);
  assert.match(prompt, /Lookup failed/);
  assert.match(prompt, /member-reported executions/);
  assert.match(prompt, /never claim there are no repository rules/);
  // Without a user-supplied issue the prompt carries none and forbids inventing one.
  assert.match(prompt, /"issue":null/);
  assert.match(prompt, /never invent issues or Fixes\/Refs links/);
  const linked = draftPrompt(
    {
      ...run,
      contributionSettings: {
        ...defaultContributionSettings,
        issueUrl: "https://github.com/acme/widgets/issues/42",
      },
    },
    [diff],
    context,
  );
  assert.match(
    linked,
    /"issue":\{"url":"https:\/\/github\.com\/acme\/widgets\/issues\/42","number":42\}/,
  );
  assert.match(linked, /Only when the supplied issue is not null/);
  // Member reports carry what the application observed next to what the member claimed; tasks saved without checks send empty lists.
  const withTeam = draftPrompt(
    {
      ...run,
      team: {
        config: {
          maxTeammates: 2,
          requirePlanApproval: false,
          provider: "codex",
          protocol: "bell-shared-tasks",
          messageDelivery: "between-turns",
        },
        phase: "complete",
        planSummary: "plan",
        messages: [],
        tasks: [
          {
            id: "alpha",
            title: "alpha",
            description: "Implement alpha",
            owner: "member-1",
            files: ["src/a.ts"],
            dependsOn: [],
            status: "complete",
            report: "自述：已執行 npm test。",
            checks: [{ command: "npm test -- a.test.ts", outcome: "exit 1" }],
            integratedFiles: ["src/a.ts"],
          },
          {
            id: "legacy",
            title: "legacy",
            description: "Saved before checks existed",
            owner: "member-2",
            files: ["src/b.ts"],
            dependsOn: [],
            status: "complete",
            report: "舊任務報告。",
          },
        ],
      },
    },
    [diff],
    context,
  );
  assert.match(
    withTeam,
    /"observedChecksNote":"application-observed command executions, exit codes only, no output captured/,
  );
  assert.match(
    withTeam,
    /"id":"alpha"[^\n]*"observedChecks":\[\{"command":"npm test -- a.test.ts","outcome":"exit 1"\}\],"integratedFiles":\["src\/a.ts"\]/,
  );
  assert.match(
    withTeam,
    /"id":"legacy"[^\n]*"observedChecks":\[\],"integratedFiles":\[\]/,
  );
  assert.throws(
    () => draftPrompt(run, [{ ...diff, patch: "字".repeat(40_000) }], context),
    /100 KB/,
  );
  assert.throws(
    () => draftPrompt(run, [{ ...diff, blocked: "Sensitive" }], context),
    /沒有可用/,
  );
});

async function fixture(runner: TeamAgentRunner) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-draft-test-"));
  const repository = path.join(directory, "repo");
  await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "a.ts"), "export const value = 1;\n");
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  let collections = 0;
  const workbench = new Workbench(store, runner, {
    collectDraftContext: async () => {
      collections++;
      return { ...context, baseSha };
    },
  });
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "draft-run",
    repoId: repo.id,
    title: "Update value",
    prompt: "Update the exported value",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: new Date().toISOString(),
    agents: [],
    logs: [],
    draft: { title: "My manual title", body: "My manual draft." },
    reviewedFiles: [],
    reviewedFingerprints: {},
    modelExecution: {
      source: "selected",
      model: "test-model",
      reasoningEffort: "low",
    },
  };
  store.data.runs.push(run);
  await writeFile(path.join(repository, "a.ts"), "export const value = 2;\n");
  return {
    directory,
    repository,
    store,
    workbench,
    run,
    collections: () => collections,
    cleanup: async () => {
      await workbench.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function automatic(workbench: Workbench, id: string) {
  return (
    workbench as unknown as {
      prepareRunDraft: (
        id: string,
        options: { automatic: boolean },
      ) => Promise<unknown>;
    }
  ).prepareRunDraft(id, { automatic: true });
}

test("manual draft preparation is isolated, deduplicated, persisted and reused without replacing the user's draft", async () => {
  let calls = 0;
  let cwd = "";
  const f = await fixture(async (input) => {
    calls++;
    cwd = input.cwd;
    assert.equal(input.role, "draft");
    assert.equal(input.readonly, true);
    assert.deepEqual(input.modelExecution, {
      source: "selected",
      model: "test-model",
      reasoningEffort: "low",
    });
    assert.deepEqual(await readdir(cwd), ["response-schema.json"]);
    return JSON.stringify(proposal);
  });
  try {
    const original = { ...f.run.draft };
    await Promise.all([
      f.workbench.prepareDraft(f.run.id),
      f.workbench.prepareDraft(f.run.id),
    ]);
    assert.equal(calls, 1);
    assert.equal(f.collections(), 1);
    assert.notEqual(cwd, f.repository);
    await assert.rejects(readdir(cwd), /ENOENT/);
    assert.deepEqual(f.run.draft, original);
    assert.equal(f.run.draftPreparation?.status, "ready");
    assert.deepEqual(f.run.draftPreparation?.proposal, proposal);
    const reopened = new Store(f.store.directory);
    await reopened.initialize();
    assert.deepEqual(
      reopened.data.runs[0].draftPreparation,
      f.run.draftPreparation,
    );
    await f.workbench.prepareDraft(f.run.id);
    assert.equal(calls, 1);
    await f.workbench.prepareDraft(f.run.id, { refresh: true });
    assert.equal(calls, 2);
    await writeFile(
      path.join(f.repository, "a.ts"),
      "export const value = 3;\n",
    );
    const files = await f.workbench.diff(f.run.id);
    assert.equal(f.run.draftPreparation?.status, "stale");
    assert.notEqual(
      f.run.draftPreparation?.fingerprint,
      draftFingerprint(f.run, files),
    );
  } finally {
    await f.cleanup();
  }
});

test("automatic proposal applies only while the original review draft and approval state remain unchanged", async () => {
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  let entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async () => {
    started!();
    await wait;
    return JSON.stringify(proposal);
  });
  try {
    const first = automatic(f.workbench, f.run.id);
    await entered;
    await f.workbench.draft(f.run.id, {
      title: "Edited while generating",
      body: "Keep this work.",
    });
    release!();
    await first;
    assert.equal(f.run.draft.title, "Edited while generating");
    assert.equal(f.run.draftPreparation?.status, "ready");
    delete f.run.draftPreparation;
    entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const second = automatic(f.workbench, f.run.id);
    await entered;
    const [file] = await f.workbench.diff(f.run.id);
    await f.workbench.review(f.run.id, file.path, true, file.fingerprint);
    await f.workbench.approve(f.run.id, { ...f.run.draft });
    release!();
    await second;
    assert.equal(f.run.status, "approved");
    assert.equal(f.run.draft.title, "Edited while generating");
    delete f.run.draftPreparation;
    await f.workbench.draft(f.run.id, { ...f.run.draft });
    await automatic(f.workbench, f.run.id);
    assert.deepEqual(f.run.draft, {
      title: proposal.title,
      body: proposal.body,
    });
  } finally {
    release?.();
    await f.cleanup();
  }
});

test("automatic proposal fills an empty commit message from the suggestion and keeps one the person wrote", async () => {
  const suggestion = {
    message: "feat(value): update the exported value\n\nExplain why.",
    rationale: "依預設寫作原則。",
    sources: [],
  };
  const f = await fixture(async () =>
    JSON.stringify({ ...proposal, commitMessageSuggestion: suggestion }),
  );
  try {
    await automatic(f.workbench, f.run.id);
    assert.deepEqual(f.run.draft, {
      title: proposal.title,
      body: proposal.body,
      commitMessage: suggestion.message,
    });
    const own = `${proposal.title}\n\nSigned-off-by: BELL Test <test@example.invalid>`;
    await f.workbench.draft(f.run.id, { ...f.run.draft, commitMessage: own });
    delete f.run.draftPreparation;
    await automatic(f.workbench, f.run.id);
    assert.equal(f.store.data.runs[0].draftPreparation?.status, "ready");
    assert.equal(f.run.draft.commitMessage, own);
  } finally {
    await f.cleanup();
  }
});

test("stale late proposals and failed generation never replace a draft or fail completed development", async () => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = false;
  const f = await fixture(async () => {
    started();
    await wait;
    if (fail) throw new Error("Draft failed");
    return JSON.stringify(proposal);
  });
  try {
    const original = { ...f.run.draft };
    const pending = automatic(f.workbench, f.run.id);
    await entered;
    await writeFile(
      path.join(f.repository, "a.ts"),
      "export const value = 3;\n",
    );
    release();
    await pending;
    assert.equal(f.run.draftPreparation?.status, "stale");
    assert.deepEqual(f.run.draft, original);
    fail = true;
    await f.workbench.prepareDraft(f.run.id, { refresh: true });
    assert.equal(f.run.status, "review");
    assert.equal(f.run.draftPreparation?.status, "failed");
    assert.ok(f.run.draftPreparation?.context);
    assert.deepEqual(f.run.draft, original);
    f.run.draftPreparation!.status = "generating";
    await f.store.save();
    const reopened = new Store(f.store.directory);
    await reopened.initialize();
    assert.equal(reopened.data.runs[0].draftPreparation?.status, "failed");
    assert.match(
      reopened.data.runs[0].draftPreparation?.error ?? "",
      /重新啟動/,
    );
    assert.equal(reopened.data.runs[0].status, "review");
    assert.deepEqual(reopened.data.runs[0].draft, original);
  } finally {
    release();
    await f.cleanup();
  }
});

test("shutdown cancels draft generation and waits for temporary workspace cleanup", async () => {
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cwd = "";
  const f = await fixture(async ({ signal, cwd: directory }) => {
    cwd = directory;
    started();
    await new Promise<void>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Cancelled")), {
        once: true,
      });
    });
    return JSON.stringify(proposal);
  });
  try {
    const pending = f.workbench.prepareDraft(f.run.id);
    await entered;
    await f.workbench.shutdown();
    await pending;
    assert.equal(f.run.status, "review");
    assert.equal(f.run.draftPreparation?.status, "failed");
    assert.match(f.run.draftPreparation?.error ?? "", /中斷/);
    await assert.rejects(readdir(cwd), /ENOENT/);
    await assert.rejects(f.workbench.prepareDraft(f.run.id), /關閉/);
  } finally {
    await f.cleanup();
  }
});

test("draft prepare HTTP API returns a proposal without applying and rejects automatic or invalid options", async () => {
  const f = await fixture(async () => JSON.stringify(proposal));
  const app = createApp(f.workbench, {
    staticDirectory: path.join(f.directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const post = (body: unknown) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}/api/runs/${f.run.id}/draft/prepare`,
        {
          method: "POST",
          headers: {
            host: "127.0.0.1:4311",
            "content-type": "application/json",
          },
        },
        (res) => {
          let value = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            value += chunk;
          });
          res.on("end", () =>
            resolve({ status: res.statusCode!, body: JSON.parse(value) }),
          );
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  try {
    assert.equal((await post({ refresh: "yes" })).status, 400);
    assert.equal((await post({ automatic: true })).status, 400);
    const result = await post({});
    assert.equal(result.status, 200);
    assert.equal(result.body.run.draft.title, "My manual title");
    assert.equal(
      result.body.run.draftPreparation.proposal.title,
      proposal.title,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await f.cleanup();
  }
});
