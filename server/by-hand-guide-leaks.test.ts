// Red-team cases for the guide's stored text (DESIGN v1.2 F5, F7, F8): code
// must not reach the person as the product shows it, after every
// transformation. The review is rendered on one line per finding for the
// Reports tab, so the filter reads it that way; Markdown decodes escapes and
// character references and hides invisible characters, so the filter reads
// prose as shown; a link's query is shown too. The review covers only the
// version marked ready, and BELL's own timeout message stays whole. The
// agent runner is a fake; fake codex, claude and gh come first on PATH.
import test, { after, before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { changeFingerprint } from "../shared/change-fingerprint.js";
import { chat, review } from "./by-hand-guide.js";
import { readDiff } from "./git.js";
import { withLocale } from "./i18n/index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import type { TeamAgentInput } from "./team.js";
import { AppError, type Run } from "./types.js";
import { Workbench, type WorkbenchContext } from "./workbench.js";

const previousPath = process.env.PATH;
let fakeBin: string;

before(async () => {
  fakeBin = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-leaks-bin-"));
  for (const name of ["codex", "claude", "gh"])
    await writeFile(path.join(fakeBin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
});

after(async () => {
  process.env.PATH = previousPath;
  await rm(fakeBin, { recursive: true, force: true });
});

const retrySource = [
  "export async function withRetry(fn, { attempts = 3, delayMs = 100 } = {}) {",
  "  for (let attempt = 0; attempt < attempts; attempt++) {",
  "    try {",
  "      return await fn();",
  "    } catch (error) {",
  "      await new Promise((resolve) => setTimeout(resolve, delayMs));",
  "    }",
  "  }",
  "}",
  "",
].join("\n");

type Answer = string | ((input: TeamAgentInput) => string | Promise<string>);

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-leaks-"));
  const repository = path.join(directory, "repo");
  await mkdir(path.join(repository, "src"), { recursive: true });
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "BELL Test"]);
  await git(repository, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "src", "retry.js"), retrySource);
  await git(repository, ["add", "--", "."]);
  await git(repository, ["commit", "-m", "initial"]);
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  // The person's edit: a comment in the retry loop.
  await writeFile(path.join(repository, "src", "retry.js"), retrySource.replace("    } catch (error) {", "    } catch (error) {\n      // wait longer each time"));
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const answers: Answer[] = [];
  const workbench = new Workbench(store, async (input) => {
    const next = answers.shift() ?? "{}";
    return typeof next === "function" ? next(input) : next;
  });
  t.after(async () => {
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const repo = await workbench.importRepository(repository);
  const run: Run = {
    id: "lbh-leaks-run",
    repoId: repo.id,
    title: "Back off between retries",
    prompt: "Wait longer between retries.",
    status: "review",
    branch: "main",
    baseBranch: "main",
    baseSha,
    worktreePath: repository,
    createdAt: "2026-10-20T00:00:00.000Z",
    locale: "en",
    learnByHand: true,
    modelExecution: { provider: "codex", source: "cli-default" },
    agents: [
      { id: "lead", name: "Atlas", role: "Team lead", status: "waiting", detail: "" },
      { id: "reviewer", name: "Lens", role: "Reviewer", status: "waiting", detail: "" },
      { id: "tester", name: "Scout", role: "Test analyst", status: "waiting", detail: "" },
    ],
    logs: [],
    draft: { title: "Back off", body: "" },
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
    byHand: {
      plan: { steps: [{ id: "s1", title: "Wait longer each time", files: ["src/retry.js"] }], savedAt: "2026-10-20T00:10:00.000Z", confirmedAt: "2026-10-20T00:11:00.000Z" },
    },
  };
  store.data.runs.push(run);
  const ctx = (workbench as unknown as { context: WorkbenchContext }).context;
  /** Marks the current change ready for review, as Ready does. */
  const ready = async () => {
    run.byHand!.ready = { at: "2026-10-20T01:00:00.000Z", changeFingerprint: changeFingerprint(await readDiff(run)), review: true };
  };
  const edit = (text: string) => writeFile(path.join(repository, "src", "retry.js"), text);
  return { run, ctx, answers, ready, edit };
}

/** The text a reader sees of Markdown: every text node, soft line breaks as spaces (code blocks are BELL's quotes). */
function shown(markdown: string) {
  const parts: string[] = [];
  const walk = (node: { type: string; value?: string; children?: unknown[] }) => {
    if ((node.type === "text" || node.type === "inlineCode") && node.value) parts.push(node.value);
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(fromMarkdown(markdown));
  return parts.join(" ").replace(/\s+/g, " ");
}

/** The fix the person must write themselves, in the forms a reader would recognise. */
const fix = /delay(?:Ms)? ?\* ?2|2 ?\*\* ?attempt|attempt ?\+ ?1/;

test("a review is filtered as the Reports tab shows it: lines a list marker split are joined again there", async (t) => {
  const f = await fixture(t);
  f.answers.push(
    JSON.stringify({
      verified: "No test run at this version; it waits attempt\n+ 1 times.",
      checked: ["src/retry.js lines 2\n* 2"],
      findings: [
        {
          path: "src/retry.js",
          line: 7,
          observed: "The wait should be delayMs\n* 2 each time.",
          evidence: { type: "none", path: null, line: null, quote: null },
          why: "The wait never grows: delayMs\n* 2 ** attempt would.",
          question: "What should the second wait be?",
          dimension: null,
        },
      ],
    }),
    "The tests did not run at this version.",
  );
  await f.ready();
  await withLocale("en", () => review(f.ctx, f.run, {}, new AbortController().signal));
  const reviewer = f.run.reports!.reviewer;
  assert.doesNotMatch(shown(reviewer), fix, reviewer);
  assert.doesNotMatch(reviewer.replace(/\s+/g, " "), fix, reviewer);
  assert.ok((f.run.byHand?.reviews?.[0].removed ?? 0) >= 3);
});

test("Markdown escapes, character references and invisible characters can't spell code", async (t) => {
  const f = await fixture(t);
  const text = "Write delay\\*2\\*\\*attempt, or delayMs&#42;2, or attempt&#x2B;1, or delay *​ 2 there; delay &ast; 2 also.";
  f.answers.push(JSON.stringify({ text, question: null, refs: [{ path: "src/retry.js", line: 6, endLine: null }], quotes: [], options: null, topic: "change", askedForCode: false }));
  const answer = await withLocale("en", () => chat(f.ctx, f.run, "src/retry.js", "How do I back off?", new AbortController().signal));
  assert.doesNotMatch(shown(answer), fix, answer);
  assert.doesNotMatch(answer, /delay\\\*2|&#42;|&#x2B;|&ast;|\u200B/, answer);
});

test("a link can't carry code in its path, query or fragment", async (t) => {
  const f = await fixture(t);
  const text = "See https://example.com/?fix=return+delay*2**attempt and https://example.com/x#attempt%2B%2B and https://example.com/search?q=a%3D%3Db then https://developer.mozilla.org/en-US/docs/Web/API/setTimeout for the timer.";
  f.answers.push(JSON.stringify({ text, question: null, refs: [], quotes: [], options: null, topic: "project", askedForCode: false }));
  const answer = await withLocale("en", () => chat(f.ctx, f.run, "src/retry.js", "Where do I read about timers?", new AbortController().signal));
  assert.doesNotMatch(answer, /fix=|attempt%2B|a%3D%3Db/, answer);
  assert.match(answer, /https:\/\/developer\.mozilla\.org\/en-US\/docs\/Web\/API\/setTimeout/);
});

const reviewerAnswer = JSON.stringify({ verified: "No test run at this version.", checked: ["src/retry.js"], findings: [] });
/** The reviewer's and the test analyst's answers, by role (they run side by side). */
const byRole = (reviewer: () => string | Promise<string>) => (input: TeamAgentInput) => (input.role === "reviewer" ? reviewer() : "No tests ran.");
const notReady = (error: unknown) => error instanceof AppError && error.statusCode === 409 && error.message === "Mark your changes ready for review first.";

test("the review covers only the version marked ready: an edit after Ready, before or during the turn, stores nothing", async (t) => {
  const f = await fixture(t);
  await f.ready();
  // Saved right after Ready, before the review job starts: no turn at all.
  await f.edit(`${retrySource}// one more line\n`);
  let calls = 0;
  f.answers.push(byRole(() => (calls++, reviewerAnswer)), byRole(() => (calls++, reviewerAnswer)));
  await assert.rejects(withLocale("en", () => review(f.ctx, f.run, {}, new AbortController().signal)), notReady);
  assert.equal(calls, 0);
  // Saved while the reviewer reads: the turn's answer is not stored.
  await f.ready();
  const editing = byRole(async () => (await f.edit(`${retrySource}// and another\n`), reviewerAnswer));
  f.answers.splice(0, f.answers.length, editing, editing);
  await assert.rejects(withLocale("en", () => review(f.ctx, f.run, {}, new AbortController().signal)), notReady);
  // Read through a call, so the checks below don't narrow the run's fields for the last one.
  const stored = () => ({ reviews: f.run.byHand?.reviews, reviewer: f.run.reports?.reviewer, events: f.run.byHand?.events });
  assert.deepEqual(stored(), { reviews: undefined, reviewer: undefined, events: undefined });
  // At the ready version the review is stored.
  await f.ready();
  f.answers.push(byRole(() => reviewerAnswer), byRole(() => reviewerAnswer));
  await withLocale("en", () => review(f.ctx, f.run, {}, new AbortController().signal));
  assert.equal(stored().reviews?.length, 1);
});

test("BELL's own timeout message stays whole in a Learn-by-hand turn's error", async (t) => {
  const f = await fixture(t);
  f.answers.push(() => {
    throw new AppError((m) => m.run.agentCli.timedOut({ executable: "codex", minutes: 10 }), 504);
  });
  await assert.rejects(
    withLocale("en", () => chat(f.ctx, f.run, "src/retry.js", "How do I back off?", new AbortController().signal)),
    (error: unknown) => error instanceof AppError && error.statusCode === 504 && /raise BELLPR_AGENT_TIMEOUT_SCALE\.$/.test(error.message),
  );
});
