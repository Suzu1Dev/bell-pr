import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import {
  applyAiDisclosure,
  draftFingerprint,
  draftJsonSchema,
  draftPrompt,
  parseDraftProposal,
  runDraftSchema,
  setAlwaysDiscloseAiSource,
} from "./drafts.js";
import {
  aiDisclosureLine,
  validBranchName,
  withAiDisclosure,
  withoutAiDisclosure,
  type DraftContext,
  type DraftProposal,
  type DraftSource,
  type RunDraft,
} from "../shared/drafts.js";
import { lenientRead } from "./persisted-schema.js";
import {
  brevityRule,
  draftPreflight,
  draftProseWords,
  draftTaskItems,
  draftWordBudget,
  findDraftPlaceholders,
  issueRule,
  markdownProse,
  referencesIssue,
  sameDraftProse,
  setDraftTaskItem,
} from "../shared/draft-checks.js";
import { defaultContributionSettings } from "../shared/insights.js";
import type { DiffFile, Run } from "./types.js";
import type { TeamAgentRunner } from "./team.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { createApp } from "./index.js";
import { git } from "./process.js";
import { assertNoHan } from "../src/test-utils/render.js";
import { withLocale } from "./i18n/index.js";
import { respondIn } from "./prompt-language.js";
import { after, before } from "node:test";
import { skipUnderstandingCheckInTests } from "./understanding.js";

// This file tests other behaviour; server/understanding.test.ts covers the gate.
before(() => skipUnderstandingCheckInTests(true));
after(() => skipUnderstandingCheckInTests());

const context: DraftContext = {
  sources: [],
  warnings: [],
  checkedAt: "2026-10-03T00:00:00Z",
  baseSha: "base",
};
const proposal: DraftProposal = {
  title: "Update the exported value",
  body: "## Problem\n\nThe value needs updating.\n\n## Changes\n\nChange the value from 1 to 2.\n\n## Validation\n\nNo executed test evidence was supplied.",
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
    // GitHub renders ordered task items as checkboxes too.
    { ...good, body: good.body + "\n1. [x] Human confirmation" },
    { ...good, body: good.body + "\n2) [X] Human confirmation" },
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

/** The shape of the opencode PR template and the body BELL published as example-org/example-repo#1. */
const opencodeTemplate =
  "### Issue for this PR\n\nCloses #\n\n### Type of change\n\n- [ ] Bug fix\n- [ ] Documentation\n\n### What does this PR do?\n\nPlease provide a description of the issue.\n\n### How did you verify your code works?\n\n### Checklist\n\n- [ ] I have tested my changes locally\n- [ ] I have not included unrelated changes in this PR\n";
const opencodeSources: DraftSource[] = [
  {
    id: "base:CONTRIBUTING.md",
    kind: "contributing",
    label: "CONTRIBUTING.md",
    content:
      "## Pull Request Expectations\n\n**All PRs must reference an existing issue.** Before opening a PR, open an issue.\n\n### No AI-Generated Walls of Text\n\n- Explain what changed and why in your own words\n",
  },
  {
    id: "base:.github/pull_request_template.md",
    kind: "template",
    label: ".github/pull_request_template.md",
    content: opencodeTemplate,
  },
];
const leakedBody = [
  "### Issue for this PR",
  "",
  "_TODO: No issue is linked yet. Open one and link it here before submitting._",
  "",
  "### Type of change",
  "",
  "- [ ] Bug fix",
  "- [ ] Documentation",
  "",
  "### What does this PR do?",
  "",
  "Fixes the startup instructions in the package README.",
  "",
  "### How did you verify your code works?",
  "",
  "Still to run with Bun 1.3+ in a clean clone (results go here):",
  "- `bun install && bun run dev --help`: _TODO_",
  "",
  "### Checklist",
  "",
  "- [ ] I have tested my changes locally",
  "- [ ] I have not included unrelated changes in this PR",
].join("\n");

test("placeholders meant for the person are found in prose only, including underscored TODO markers", () => {
  assert.deepEqual(
    findDraftPlaceholders(leakedBody).map((item) => item.line),
    [3, 16, 17],
  );
  assert.deepEqual(
    findDraftPlaceholders("### Issue for this PR\n\nCloses #\n\nFixes #12").map(
      (item) => item.line,
    ),
    [3],
  );
  // Quoted code, fenced blocks and HTML comments are material, not open items.
  assert.deepEqual(
    findDraftPlaceholders(
      "Removes the stale `TODO` note and the TODOs list.\n```\n// TODO: later\n````\n<!-- TODO:\nmore -->\nDone.",
    ),
    [],
  );
  // Only marker shapes are open slots; prose about TODO comments or files is not.
  for (const text of [
    "_TODO: add the output_",
    "*TBD*",
    "TODO: run the tests",
    "- TBD",
    "Exit code: TBD",
    "(TODO)",
    "Fixes # (issue)",
    "> **Resolves** #[number]",
    "Issue: #___",
    "Closes #XXX",
  ])
    assert.equal(findDraftPlaceholders(text).length, 1, text);
  for (const text of [
    "Resolves the FIXME in parse.ts.",
    "Moves the roadmap into TODO.md and renames TODO_LIST.",
    "- [ ] I have removed any TODO comments from my changes",
    "## TODO",
    "See (TODO.md).",
    "Fixes #12 (partially)",
    "Fix: # of retries reduced",
    "- Fix #include guard",
  ])
    assert.deepEqual(findDraftPlaceholders(text), [], text);
  // "<!--" quoted in code does not hide the rest; fences in nested lists stay code.
  assert.equal(
    findDraftPlaceholders("Strips `<!--` comments.\n_TODO_").length,
    1,
  );
  assert.deepEqual(
    markdownProse("  - Run:\n    ```sh\n    # TODO later\n    ```\nDone"),
    ["  - Run:", "", "", "", "Done"],
  );
});

test("task items keep their heading, ignore code, and are ticked one line at a time", () => {
  const body = `${leakedBody}\n\n\`\`\`md\n- [ ] not a real item\n\`\`\``;
  const items = draftTaskItems(body);
  assert.deepEqual(
    items.map((item) => [item.heading, item.text, item.checked]),
    [
      ["Type of change", "Bug fix", false],
      ["Type of change", "Documentation", false],
      ["Checklist", "I have tested my changes locally", false],
      ["Checklist", "I have not included unrelated changes in this PR", false],
    ],
  );
  const documentation = items[1];
  const ticked = setDraftTaskItem(body, documentation.line, true);
  assert.equal(ticked.split("\n")[documentation.line - 1], "- [x] Documentation");
  assert.deepEqual(
    draftTaskItems(ticked).filter((item) => item.checked).map((item) => item.text),
    ["Documentation"],
  );
  assert.equal(setDraftTaskItem(ticked, documentation.line, false), body);
  // A line that is not a task item is left alone.
  assert.equal(setDraftTaskItem(body, 1, true), body);
});

test("issue and brevity rules are quoted from contributing and template sources only", () => {
  assert.equal(
    issueRule(opencodeSources)?.quote,
    "All PRs must reference an existing issue. Before opening a PR, open an issue.",
  );
  assert.equal(
    issueRule([opencodeSources[1]])?.quote,
    "Closes #",
  );
  assert.equal(brevityRule(opencodeSources)?.quote, "No AI-Generated Walls of Text");
  assert.equal(draftWordBudget(opencodeSources), 150);
  assert.equal(draftWordBudget([]), 300);
  const readme: DraftSource = {
    id: "base:README.md",
    kind: "documentation",
    label: "README.md",
    content: "Every PR must reference an issue. Write in your own words.",
  };
  assert.equal(issueRule([readme]), undefined);
  assert.equal(brevityRule([readme]), undefined);
  const contributing = (content: string): DraftSource[] => [
    { id: "c", kind: "contributing", label: "CONTRIBUTING.md", content },
  ];
  for (const rule of [
    "Every pull request must be linked to an issue.",
    "Each PR must reference an issue.",
    "Every PR needs a linked issue.",
    "PRs without a linked issue will be closed.",
  ])
    assert.ok(issueRule(contributing(rule)), rule);
  assert.equal(
    issueRule(
      contributing(
        "All PRs should have a clear description of the issue they solve.",
      ),
    ),
    undefined,
  );
  assert.equal(
    issueRule([
      { ...opencodeSources[1], content: "## Related\n\nFixes # (issue)\n" },
    ])?.quote,
    "Fixes # (issue)",
  );
  assert.ok(referencesIssue("Closes #12"));
  assert.ok(referencesIssue("Refs acme/widgets#7"));
  assert.ok(referencesIssue("See https://github.com/acme/widgets/issues/7"));
  assert.ok(!referencesIssue("Closes #\n`#12` in code"));
  assert.equal(draftProseWords("## Heading words\n\n- [ ] task words\n\nThree prose words."), 3);
  assert.equal(draftProseWords("修正說明"), 4);
});

test("preflight blocks unfinished text and asks the person to confirm empty boxes, a missing issue and unrevised model text", () => {
  const checks = draftPreflight(
    {
      body: leakedBody,
      sources: opencodeSources,
      proposalBody: leakedBody,
    },
    "zh-TW",
  );
  assert.deepEqual(
    checks.map((check) => [check.id, check.kind]),
    [
      ["placeholder", "block"],
      ["unchecked", "confirm"],
      ["issue", "confirm"],
      ["brevity", "confirm"],
    ],
  );
  assert.match(checks[0].details[0], /第 3 行/);
  assert.deepEqual(checks[1].details, [
    "Type of change：2 項都未勾",
    "Checklist：2 項都未勾",
  ]);
  const finished = leakedBody
    .replace(/_TODO: No issue.*_/, "Closes #42")
    .replace(/Still to run[\s\S]*?_TODO_/, "Not run yet: `bun run dev --help`.")
    .replace("- [ ] Documentation", "- [x] Documentation")
    .replace("- [ ] I have not", "- [x] I have not");
  // Ticking one box per group, linking the issue and rewriting leaves nothing to confirm.
  assert.deepEqual(
    draftPreflight({
      body: finished,
      sources: opencodeSources,
      proposalBody: leakedBody,
    }),
    [],
  );
  // Ticking boxes in BELL is not a rewrite: the unrevised-text confirmation stays.
  const shortProposal = opencodeTemplate
    .replace("Closes #", "No issue is linked yet.")
    .replace("Please provide a description of the issue.", "Fixes the README.");
  const ticked = setDraftTaskItem(
    shortProposal,
    draftTaskItems(shortProposal)[1].line,
    true,
  );
  assert.ok(sameDraftProse(ticked, shortProposal));
  assert.ok(!sameDraftProse(`${ticked}\nMore.`, shortProposal));
  // Nor is turning the AI-disclosure line on, on either side.
  assert.ok(sameDraftProse(withAiDisclosure(ticked), shortProposal));
  assert.ok(sameDraftProse(ticked, withAiDisclosure(shortProposal)));
  assert.ok(!sameDraftProse(withAiDisclosure(`${ticked}\nMore.`), shortProposal));
  assert.deepEqual(
    draftPreflight({
      body: ticked,
      sources: opencodeSources,
      proposalBody: shortProposal,
    }).map((check) => check.id),
    ["unchecked", "issue", "brevity"],
  );
  // BELL's disclosure line leaves the suggestion unrevised.
  const brevity = (body: string) =>
    draftPreflight({ body, sources: opencodeSources, proposalBody: shortProposal })
      .find((check) => check.id === "brevity")?.message;
  assert.ok(brevity(ticked));
  assert.equal(brevity(withAiDisclosure(ticked)), brevity(ticked));
  // Without collected sources only the text itself is checked.
  assert.deepEqual(
    draftPreflight({ body: "A finished description." }),
    [],
  );
});

test("preflight messages default to English, keep their ids and quote the rules without Han", () => {
  const checks = draftPreflight({
    body: leakedBody,
    sources: opencodeSources,
    proposalBody: leakedBody,
  });
  assert.deepEqual(
    checks.map((check) => check.id),
    ["placeholder", "unchecked", "issue", "brevity"],
  );
  for (const check of checks)
    for (const text of [check.message, ...check.details]) assertNoHan(text);
  assert.match(checks[0].message, /^The PR description still has 3 unfinished spots\./);
  assert.equal(
    checks[0].details[0],
    'Line 3: "_TODO: No issue is linked yet. Open one and link it here before submitting._"',
  );
  assert.deepEqual(checks[1].details, [
    "Type of change: all 2 items are unticked",
    "Checklist: all 2 items are unticked",
  ]);
  assert.match(checks[2].message, /does not reference one\.$/);
  assert.deepEqual(checks[2].details, [
    'CONTRIBUTING.md: "All PRs must reference an existing issue. Before opening a PR, open an issue."',
  ]);
  assert.match(checks[3].message, /still BELL PR's suggested text, unrevised/);
  assert.deepEqual(checks[3].details, [
    'CONTRIBUTING.md: "No AI-Generated Walls of Text"',
  ]);
  // One unticked box under no heading, and a body over the word budget.
  const long = draftPreflight({
    body: `- [ ] Tested\n\n${"word ".repeat(200)}`,
    sources: opencodeSources,
  });
  assert.deepEqual(long.find((check) => check.id === "unchecked")?.details, [
    "(no heading): its 1 item is unticked",
  ]);
  assert.match(
    long.find((check) => check.id === "brevity")?.message ?? "",
    /^This description is about 200 words, more than the 150 BELL PR suggests/,
  );
  // The same checks in zh-TW differ only in their text.
  const zh = draftPreflight(
    { body: leakedBody, sources: opencodeSources, proposalBody: leakedBody },
    "zh-TW",
  );
  assert.deepEqual(
    zh.map(({ id, kind }) => [id, kind]),
    checks.map(({ id, kind }) => [id, kind]),
  );
  assert.equal(zh[0].details[0], "第 3 行：「_TODO: No issue is linked yet. Open one and link it here before submitting._」");
  assert.deepEqual(
    draftPreflight({ body: "- [ ] Tested", sources: opencodeSources }, "zh-TW")
      .find((check) => check.id === "unchecked")?.details,
    ["（無標題）：1 項都未勾"],
  );
});

test("GitHub branch names follow a conservative Git subset", () => {
  for (const name of ["readme-startup", "bellpr-c4bc3a23", "feat/smart-retry", "v1.2_fix"])
    assert.ok(validBranchName(name), name);
  for (const name of ["", "HEAD", "-x", "a..b", "x.lock", "x.", "feat/", "/x", "a//b", "bad name", "a~b", "a:b", "x.lock/y", "分支"])
    assert.ok(!validBranchName(name), name);
});

test("draft proposals that put the person's to-dos into the published body are rejected", () => {
  for (const body of [
    `${proposal.body}\n\n_TODO: add the output_`,
    `Closes #\n\n${proposal.body}`,
    `${proposal.body}\n\nResults go here.`,
  ])
    assert.throws(
      () => parseDraftProposal(JSON.stringify({ ...proposal, body }), context),
      /待辦事項/,
    );
  assert.equal(
    parseDraftProposal(
      JSON.stringify({ ...proposal, body: `${proposal.body}\n\nRemoves the stale \`TODO\` note.` }),
      context,
    ).policy,
    "linux",
  );
  // A template item about TODO comments, kept verbatim as the prompt asks, is not a slot.
  const template = "## Checklist\n\n- [ ] I have removed any TODO comments from my changes\n";
  assert.equal(
    parseDraftProposal(
      JSON.stringify({
        ...proposal,
        policy: "repository",
        templateSourceId: "template",
        body: `${template}\nUpdates the value.`,
      }),
      {
        ...context,
        sources: [
          { id: "template", kind: "template", label: "PR template", content: template },
        ],
      },
    ).policy,
    "repository",
  );
  // The output schema states the same 24-item limits the parser enforces.
  const properties = draftJsonSchema.properties as Record<string, { maxItems?: number }>;
  assert.equal(properties.rules.maxItems, 24);
  assert.equal(properties.checklist.maxItems, 24);
});

test("in English, draft rejections and the provisional-policy note carry no Han", () => {
  const withLines = (body: string) =>
    withLocale("en", () =>
      parseDraftProposal(JSON.stringify({ ...proposal, body }), context),
    );
  assert.throws(() => withLines(`${proposal.body}\n\n_TODO: add the output_`), {
    message:
      "The PR draft put to-dos or unfilled template fields into the description that is sent to GitHub (line 13). Generate it again.",
  });
  assert.throws(
    () => withLines(`Closes #\n\n${proposal.body}\n\nResults go here.\n\nTBD: owner`),
    /\(lines 1, 15, 17\)/,
  );
  assert.throws(
    () => withLocale("en", () => parseDraftProposal("{}", context)),
    { message: "The PR draft suggestion came back incomplete. Generate it again." },
  );
  const provisional = withLocale("en", () =>
    parseDraftProposal(JSON.stringify(proposal), {
      ...context,
      warnings: ["Lookup was sampled."],
    }),
  );
  assert.match(
    provisional.summary,
    /^Looking up the project's sources was limited or incomplete, so the Linux contribution writing principles are used for now\./,
  );
  assertNoHan(provisional.summary.split("\n")[0]);
});

test("draft prompt writes the person's fields in the locale's language and keeps the PR text English", () => {
  const prompt = () =>
    draftPrompt(
      { title: "Update", prompt: "Update value", reports: {}, branch: "bellpr-abc12345" },
      [diff],
      context,
    );
  const english = withLocale("en", prompt);
  const chinese = withLocale("zh-TW", prompt);
  assert.ok(
    english.includes(
      `for those fields: ${respondIn("en")}`,
    ),
  );
  assert.doesNotMatch(english, /Traditional Chinese/);
  assert.ok(chinese.includes(`for those fields: ${respondIn("zh-TW")}`));
  assert.match(chinese, /Traditional Chinese/);
  for (const text of [english, chinese]) {
    // The PR title and body follow the project, not the UI language.
    assert.match(
      text,
      /Use English for PR title\/body unless explicit project instructions require another language\./,
    );
    assert.match(text, /summary, the rules text, checklist and the commit message rationale are read by the person/);
    assert.match(text, /Do not mention AI assistance/);
    assert.match(text, /requires disclosing AI assistance, add a checklist item/);
  }
  // Only the language directive differs.
  assert.equal(
    english.replace(respondIn("en"), ""),
    chinese.replace(respondIn("zh-TW"), ""),
  );
});

test("draft prompt routes the person's to-dos to the checklist and passes the branch and word budget", () => {
  const prompt = draftPrompt(
    { title: "Update", prompt: "Update value", reports: {}, branch: "bellpr-abc12345" },
    [diff],
    context,
  );
  assert.match(prompt, /published to GitHub verbatim/);
  // The PR text never mentions AI help; a project rule that requires it becomes a checklist item.
  assert.match(prompt, /Do not mention AI assistance/);
  assert.match(prompt, /requires disclosing AI assistance, add a checklist item/);
  assert.doesNotMatch(prompt, /Developed with AI assistance|Include truthful AI assistance disclosure/);
  assert.match(prompt, /goes ONLY into checklist/);
  assert.match(prompt, /"headBranch":"bellpr-abc12345"/);
  assert.match(prompt, /"bodyWordBudget":300/);
  assert.match(prompt, /"brevityRule":null/);
  const branded = draftPrompt(
    {
      title: "Update",
      prompt: "Update value",
      reports: {},
      branch: "bellpr-abc12345",
      draft: { title: "t", body: "b", publishBranch: "readme-startup" },
    },
    [diff],
    { ...context, sources: opencodeSources },
  );
  assert.match(branded, /"headBranch":"readme-startup"/);
  assert.match(branded, /"bodyWordBudget":150/);
  assert.match(
    branded,
    /"brevityRule":\{"sourceId":"base:CONTRIBUTING.md","quote":"No AI-Generated Walls of Text"\}/,
  );
  assert.match(branded, /Sources of kind automation/);
});

test("only what GitHub renders as code or a comment is skipped, so odd indents cannot hide unfinished text", () => {
  // Each body would hide the later TODO and empty issue line with a line-based scanner.
  for (const [name, body, lines] of [
    ["top-level indented fence", "Intro\n\n    ```js\n    code\n\n_TODO_\nCloses #", [6, 7]],
    ["indented comment opener", "Example template:\n\n    <!-- describe here\n\n_TODO_\nCloses #", [5, 6]],
    ["unclosed mid-line comment", "Escapes `<` in <!-- markers now.\n\n## Testing\nTODO: run tests\nCloses #", [4, 5]],
    ["backticks in an info string", "```js``` blocks keep their language.\n\n_TODO_", [3]],
    ["unclosed fence in a list item", "- Steps:\n  ```\n  npm test\n\n## Testing\n_TODO_", [6]],
  ] as const)
    assert.deepEqual(
      findDraftPlaceholders(body).map((item) => item.line),
      lines,
      name,
    );
  // Real comments, inline or as a block, are still hidden like GitHub hides them.
  assert.deepEqual(
    findDraftPlaceholders(
      "Text <!-- TODO: hidden --> more.\n<!--\nTODO: block\n-->\n    TODO: indented code\nDone",
    ),
    [],
  );
  // A task item after an unclosed fence in a list is still offered for ticking.
  assert.deepEqual(
    draftTaskItems("- Steps:\n  ```\n  npm test\n\n## Testing\n- [ ] tests pass").map(
      (item) => [item.heading, item.text],
    ),
    [["Testing", "tests pass"]],
  );
});

test("ordered task items and ordered issue slots are handled like bulleted ones", () => {
  const ordered = "## Checklist\n\n1. [ ] Tests pass\n2) [ ] Docs updated\n";
  const items = draftTaskItems(ordered);
  assert.deepEqual(
    items.map((item) => [item.heading, item.text, item.checked]),
    [
      ["Checklist", "Tests pass", false],
      ["Checklist", "Docs updated", false],
    ],
  );
  const ticked = setDraftTaskItem(ordered, items[0].line, true);
  assert.equal(ticked.split("\n")[2], "1. [x] Tests pass");
  assert.ok(sameDraftProse(ticked, ordered));
  assert.deepEqual(
    draftPreflight({ body: ordered }).map((check) => check.id),
    ["unchecked"],
  );
  assert.deepEqual(draftPreflight({ body: ticked }), []);
  assert.deepEqual(
    findDraftPlaceholders("1. [ ] TBD: owner\n1. Closes #\n1) Fixes # (issue)").map(
      (item) => item.line,
    ),
    [1, 2, 3],
  );
  assert.equal(
    issueRule([
      { id: "t", kind: "template", label: "T", content: "## Issue\n\n1. Closes #\n" },
    ])?.quote,
    "1. Closes #",
  );
  // Quotes keep code the rule cites, rather than the blanked prose.
  assert.equal(
    issueRule([
      {
        id: "c",
        kind: "contributing",
        label: "C",
        content: "Every PR must reference an issue with `Fixes #123`.",
      },
    ])?.quote,
    "Every PR must reference an issue with `Fixes #123`.",
  );
});

test("preflight blocks a credential in the PR text and asks to confirm local paths, CI files and a public e-mail", () => {
  const token = `ghp_${"a".repeat(36)}`;
  const secret = draftPreflight({ body: `Debugged with ${token} set.` });
  assert.deepEqual(
    secret.map(({ id, kind }) => [id, kind]),
    [["secret", "block"]],
  );
  assert.deepEqual(secret[0].details, ["In the description"]);
  for (const text of [secret[0].message, ...secret[0].details]) assertNoHan(text);
  assert.deepEqual(
    draftPreflight({
      title: `Fix ${token}`,
      body: "A fix.",
      // Split, so the repository's "no private keys" grep stays clean.
      commitMessage: `Fix\n\n-----${"BEGIN "}PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----`,
    })[0].details,
    ["In the title", "In the commit message"],
  );
  // A secret blocks before the other checks are even confirmed.
  assert.equal(
    draftPreflight({ body: `TODO: remove ${token}` }).map((check) => check.id).join(),
    "secret,placeholder",
  );

  const paths = draftPreflight({
    body: "Ran it in /home/alice/project and /Users/bob/src; output in /srv/bell-data/logs.",
    localDirectories: ["/srv/bell-data", "/data", "/"],
  });
  assert.deepEqual(paths.map(({ id, kind }) => [id, kind]), [["local-paths", "confirm"]]);
  assert.deepEqual(paths[0].details, [
    "Found: /srv/bell-data",
    "Found: /home/alice/",
    "Found: /Users/bob/",
  ]);
  // A one-segment directory such as /data says nothing about the person.
  assert.deepEqual(
    draftPreflight({ body: "Reads files from /data.", localDirectories: ["/data"] }),
    [],
  );
  // Repository folders and URLs that merely contain home or Users are not paths on this computer.
  assert.deepEqual(
    draftPreflight({
      body: "Moves src/home/components/Card.tsx; see https://example.com/Users/guide/ and app/Users/list/.",
      localDirectories: ["/home/alice"],
    }),
    [],
  );
  // A directory the server passed is reported once, and only as a whole name.
  assert.deepEqual(
    draftPreflight({
      body: "Ran in /home/alice/project, not in /home/alicex/.",
      localDirectories: ["/home/alice"],
    })[0].details,
    ["Found: /home/alice", "Found: /home/alicex/"],
  );

  const ci = draftPreflight({
    body: "Updates the workflow.",
    changedPaths: ["src/a.ts", ".github/workflows/ci.yml", ".gitlab-ci.yml"],
  });
  assert.deepEqual(ci.map(({ id, kind }) => [id, kind]), [["workflows", "confirm"]]);
  assert.deepEqual(ci[0].details, [
    "Changed: .github/workflows/ci.yml",
    "Changed: .gitlab-ci.yml",
  ]);

  const email = draftPreflight({
    body: "A fix.",
    commitEmails: ["me@company.dev", "12345+me@users.noreply.github.com"],
  });
  assert.deepEqual(email.map(({ id, kind }) => [id, kind]), [["author-email", "confirm"]]);
  assert.match(email[0].message, /me@company\.dev/);
  assert.doesNotMatch(email[0].message, /noreply/);
  // Two addresses are listed the way the locale lists them.
  assert.match(
    draftPreflight({ body: "A fix.", commitEmails: ["a@company.dev", "b@company.dev"] })[0].message,
    /addresses a@company\.dev and b@company\.dev,/,
  );
  for (const address of [
    "12345+me@users.noreply.github.com",
    "me@users.noreply.github.com",
    "bell@localhost.invalid",
    "someone@example.com",
    "ci@build.test",
  ])
    assert.deepEqual(draftPreflight({ body: "A fix.", commitEmails: [address] }), [], address);

  // Same ids and kinds in zh-TW, in Traditional Chinese.
  const zh = draftPreflight(
    {
      body: `${token} /home/alice/x`,
      changedPaths: [".github/workflows/ci.yml"],
      commitEmails: ["me@company.dev"],
    },
    "zh-TW",
  );
  assert.deepEqual(zh.map((check) => check.id), ["secret", "local-paths", "workflows", "author-email"]);
  assert.match(zh[0].message, /憑證/);
  assert.deepEqual(zh[0].details, ["位於說明"]);
});

const disclosureSource: DraftSource = {
  id: "base:CONTRIBUTING.md",
  kind: "contributing",
  label: "CONTRIBUTING.md",
  content: "## AI use\n\nIf you used AI tools, disclose it in the pull request description.",
};

test("AI disclosure is off by default: BELL never mentions AI unless the person or the project asks", () => {
  const prompt = draftPrompt(
    { title: "Update", prompt: "Update value", reports: {}, branch: "fix/abc" },
    [diff],
    context,
  );
  assert.match(prompt, /Do not mention AI assistance, AI tools, BELL or agents in title, body or commitMessageSuggestion/);
  assert.doesNotMatch(prompt, new RegExp(aiDisclosureLine));
  const parsed = parseDraftProposal(JSON.stringify(proposal), context);
  assert.equal(parsed.body, proposal.body);
  assert.doesNotMatch(parsed.body, /\bAI\b/);

  // A project rule that requires a disclosure reaches the model and becomes a
  // checklist item; BELL itself still adds nothing to the body.
  const ruled = { ...context, sources: [disclosureSource] };
  const ruledPrompt = draftPrompt(
    { title: "Update", prompt: "Update value", reports: {}, branch: "fix/abc" },
    [diff],
    ruled,
  );
  assert.match(ruledPrompt, /disclose it in the pull request description/);
  assert.match(ruledPrompt, /When a supplied source requires disclosing AI assistance, add a checklist item quoting that rule/);
  const followed = parseDraftProposal(
    JSON.stringify({
      ...proposal,
      policy: "repository",
      rules: [
        {
          text: "The project asks for an AI-use disclosure.",
          sourceId: disclosureSource.id,
          quote: "If you used AI tools, disclose it in the pull request description.",
        },
      ],
      checklist: ["Add your AI-use disclosure: \"If you used AI tools, disclose it in the pull request description.\""],
    }),
    ruled,
  );
  assert.equal(followed.body, proposal.body);
  assert.doesNotMatch(followed.body, new RegExp(aiDisclosureLine));
});

test("turning the AI disclosure on adds BELL's editable line, which the person can reword or remove", () => {
  const draft = { title: "Update", body: "Changes the value." };
  const on = applyAiDisclosure(draft, { ...draft, aiDisclosure: true });
  assert.equal(on.aiDisclosure, true);
  assert.equal(on.body, `Changes the value.\n\n${aiDisclosureLine}`);
  // Saving again with the line deleted keeps it deleted: the person's text wins.
  const removed = applyAiDisclosure(on, { ...on, body: "Changes the value." });
  assert.equal(removed.body, "Changes the value.");
  assert.equal(removed.aiDisclosure, true);
  const reworded = "Prepared with help from coding agents; I reviewed every line.";
  assert.equal(
    applyAiDisclosure(on, { ...on, body: `Changes the value.\n\n${reworded}` }).body,
    `Changes the value.\n\n${reworded}`,
  );
  // Turning it off removes BELL's own line and leaves the rest as written.
  const off = applyAiDisclosure(on, {
    ...on,
    body: `Changes the value.\n\n${aiDisclosureLine}\n\nMore notes.`,
    aiDisclosure: false,
  });
  assert.equal(off.aiDisclosure, false);
  assert.equal(off.body, "Changes the value.\n\nMore notes.");
  assert.equal(
    applyAiDisclosure(on, { ...on, body: `Changes the value.\n\n${reworded}`, aiDisclosure: false }).body,
    `Changes the value.\n\n${reworded}`,
  );
  // A client that does not know the field keeps the saved choice and text.
  const older = applyAiDisclosure(on, { title: "Update", body: on.body });
  assert.equal(older.aiDisclosure, true);
  assert.equal(older.body, on.body);
  // The line is added once.
  assert.equal(withAiDisclosure(withAiDisclosure("Body")), `Body\n\n${aiDisclosureLine}`);
  assert.equal(withAiDisclosure(""), aiDisclosureLine);
  assert.equal(withoutAiDisclosure(aiDisclosureLine), "");
  assert.equal(withoutAiDisclosure("No line here."), "No line here.");
});

test("the always-disclose setting adds the line to suggestions until the person turns it off for a draft", (t) => {
  setAlwaysDiscloseAiSource(() => true);
  t.after(() => setAlwaysDiscloseAiSource());
  const suggested = parseDraftProposal(JSON.stringify(proposal), context);
  assert.equal(suggested.body, `${proposal.body}\n\n${aiDisclosureLine}`);
  const draft = { title: "Update", body: suggested.body };
  // Saved without a choice: the setting stands, the text is kept.
  assert.deepEqual(applyAiDisclosure(draft, draft), draft);
  const off = applyAiDisclosure(draft, { ...draft, aiDisclosure: false });
  assert.equal(off.body, proposal.body);
  assert.equal(off.aiDisclosure, false);
  // A source that fails counts as off.
  setAlwaysDiscloseAiSource(() => {
    throw new Error("unreadable settings");
  });
  assert.equal(parseDraftProposal(JSON.stringify(proposal), context).body, proposal.body);
});

test("aiDisclosure round-trips through the draft API and state.json, and an older schema still parses it", async () => {
  const f = await fixture(async () => JSON.stringify(proposal));
  const app = createApp(f.workbench, { staticDirectory: path.join(f.directory, "missing") });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const patch = (body: unknown) =>
    new Promise<{ status: number; json: { run: { draft: RunDraft } } }>((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}/api/runs/${f.run.id}/draft`,
        {
          method: "PATCH",
          headers: { host: "127.0.0.1:4311", "content-type": "application/json" },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () => resolve({ status: response.statusCode!, json: JSON.parse(text) }));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  try {
    const on = await patch({ title: "Update value", body: "Changes the value.", aiDisclosure: true });
    assert.equal(on.status, 200);
    assert.equal(on.json.run.draft.aiDisclosure, true);
    assert.equal(on.json.run.draft.body, `Changes the value.\n\n${aiDisclosureLine}`);
    // An older client leaves the field out: the choice stays.
    const kept = await patch({ title: "Update value", body: on.json.run.draft.body });
    assert.equal(kept.json.run.draft.aiDisclosure, true);
    assert.equal((await patch({ title: "Update value", body: "x", aiDisclosure: "yes" })).status, 400);
    await f.store.save();
    const reopened = new Store(f.store.directory);
    await reopened.initialize();
    const saved: RunDraft = reopened.data.runs[0].draft;
    assert.equal(saved.aiDisclosure, true);
    const off = await patch({ title: "Update value", body: saved.body, aiDisclosure: false });
    assert.equal(off.json.run.draft.aiDisclosure, false);
    assert.equal(off.json.run.draft.body, "Changes the value.");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await f.cleanup();
  }
  // A build from before the field reads a draft that has it, and drops it.
  const written = { title: "Update value", body: "Changes the value.", aiDisclosure: true };
  const older = lenientRead(runDraftSchema.omit({ aiDisclosure: true })).parse(written);
  assert.deepEqual(older, { title: "Update value", body: "Changes the value." });
  // This build reads a draft written before the field existed: the choice is off.
  const current = lenientRead(runDraftSchema).parse({ title: "Update value", body: "b" });
  assert.equal(current.aiDisclosure, undefined);
  assert.equal(lenientRead(runDraftSchema).parse(written).aiDisclosure, true);
});
