import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { CoachDebrief } from "../../shared/coach";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo } from "../types";
import {
  CoachDebriefPanel,
  DebriefCard,
  debriefProjects,
  fetchDebriefs,
  requestDebrief,
  type DebriefRun,
} from "./CoachDebriefPanel";

const repo = (id: string, fullName: string): Repo => ({
  id,
  name: fullName.split("/")[1],
  owner: fullName.split("/")[0],
  fullName,
  path: `/tmp/${id}`,
  defaultBranch: "main",
  url: "",
});
const repos = [repo("repo-a", "e2e-sample/alpha"), repo("repo-b", "e2e-sample/beta"), repo("repo-c", "e2e-sample/gamma")];

const runs: DebriefRun[] = [
  { repoId: "repo-a", status: "published", createdAt: "2026-10-01T00:00:00.000Z" },
  { repoId: "repo-b", status: "approved", createdAt: "2026-10-05T00:00:00.000Z" },
  // Still in review: gamma has nothing to debrief yet.
  { repoId: "repo-c", status: "review", createdAt: "2026-10-09T00:00:00.000Z" },
];

const stored: CoachDebrief = {
  at: "2026-10-10T12:00:00.000Z",
  locale: "en",
  runIds: ["run-2", "run-1"],
  recurring: {
    dimension: "naming",
    quotes: ["Please call it retryDelay, as the rest of the client does."],
  },
  drills: [
    {
      context: "Naming the option that sets the first wait.",
      optionA: "delay",
      optionB: "retryDelay",
      question: "Which fits this project, and why?",
      reveal: "retryDelay: the client prefixes every retry option, so the name says where it belongs.",
    },
  ],
  nextStep: "Before your next pull request here, read how the existing options are named.",
};

const older: CoachDebrief = { ...stored, at: "2026-09-01T12:00:00.000Z", recurring: undefined, drills: [], nextStep: "An older next step." };

const panel = (props: Partial<Parameters<typeof CoachDebriefPanel>[0]> = {}) =>
  createElement(CoachDebriefPanel, { repos, demo: false, locked: false, runs, debriefs: [], ...props });

const sample = getDemo("en").debriefSample!;

test("a debrief can read the projects with an approved or published run, the latest first", () => {
  assert.deepEqual(debriefProjects(repos, runs).map((value) => value.id), ["repo-b", "repo-a"]);
  assert.deepEqual(debriefProjects(repos, []), []);
  // A run of a project that is no longer imported offers nothing.
  assert.deepEqual(debriefProjects([], runs), []);
});

test("on Free the request is locked with the PRO badge and the stored debriefs stay readable", () => {
  const html = renderEn(panel({ locked: true, debriefs: [stored] }));
  assertNoHan(html);
  assert.match(html, /<h2 id="debrief-title">Coach debrief<\/h2>/);
  assert.match(html, /<select[^>]*><option value="repo-b" selected="">e2e-sample\/beta<\/option><option value="repo-a">e2e-sample\/alpha<\/option><\/select>/);
  const button = html.match(/<button type="button" class="button primary"[^>]*>.*?<\/button>/)?.[0] ?? "";
  assert.match(button, /Debrief my contributions to this project<span class="pro-badge" role="img" aria-label="Pro feature"/);
  const note = button.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(note, "the button is described by the lock note");
  assert.ok(html.includes(`<p id="${note}" class="practice-help">The coach debrief is a Pro feature. Debriefs you already have stay readable on every plan.</p>`));
  // The stored debrief reads in full on Free.
  assert.ok(html.includes("Please call it retryDelay, as the rest of the client does."));
  assert.doesNotMatch(html, /Sample debrief/);
});

test("on Pro the request is open, and a stored debrief shows its dimension, quotes, drills and next step", () => {
  const html = renderEn(panel({ debriefs: [older, stored] }));
  assertNoHan(html);
  assert.doesNotMatch(html, /pro-badge/);
  assert.doesNotMatch(html, /is a Pro feature/);
  const cards = [...html.matchAll(/<article class="debrief-card">.*?<\/article>/g)].map(([card]) => card);
  assert.equal(cards.length, 2);
  // Newest first.
  const [card, second] = cards;
  assert.match(second, /An older next step\./);
  assert.match(card, /<span class="note-ai-label">AI-written<\/span><span>Written Oct 10, 2026<\/span><span>From 2 contributions<\/span>/);
  assert.match(card, /<h3>What maintainers raised most: Naming<\/h3><p class="debrief-label">Quoted from your records<\/p><blockquote>Please call it retryDelay/);
  assert.match(card, /<h3>Drills<\/h3><div class="debrief-drill"><h4>Drill 1<\/h4><p>Naming the option that sets the first wait\.<\/p>/);
  assert.match(card, /<strong>Version A<\/strong><p>delay<\/p>.*<strong>Version B<\/strong><p>retryDelay<\/p>/);
  assert.match(card, /<p class="debrief-question">Which fits this project, and why\?<\/p><button type="button" class="button secondary" aria-expanded="false" aria-controls="([^"]+)-trade-off">Show the trade-off<\/button><div id="\1-trade-off" class="debrief-trade-off" hidden="">/);
  assert.match(card, /<h3>Next step<\/h3><p>Before your next pull request here/);
  assert.doesNotMatch(html, /Sample debrief/);
});

test("without a debrief of its own the panel shows the sample, labelled as a sample of a Pro feature", () => {
  const html = renderEn(panel({ locked: true }));
  assertNoHan(html);
  assert.match(html, /<p class="practice-help">No debrief for this project yet\.<\/p>/);
  assert.match(html, /<h2 id="debrief-sample-title">Sample debrief<span class="learning-demo-label">Sample<\/span><span class="pro-badge" role="img" aria-label="Pro feature" title="Pro feature">PRO<\/span><\/h2>/);
  assert.ok(html.includes(sample.nextStep));
  for (const quote of sample.recurring!.quotes) assert.ok(html.includes(quote.replace(/'/g, "&#x27;")), quote);

  // Without an approved contribution there is nothing to debrief yet.
  const none = renderEn(panel({ runs: [runs[2]] }));
  assert.match(none, /A debrief reads approved contributions\./);
  assert.doesNotMatch(none, /<select/);
  assert.match(none, /Sample debrief/);

  // While the runs load, the panel says so.
  assert.match(renderEn(panel({ runs: undefined })), /role="status" aria-busy="true">.*Loading your projects…/);
});

test("the demo shows only the sample debrief and asks for nothing", () => {
  const html = renderEn(panel({ demo: true, runs: undefined, debriefs: undefined }));
  assertNoHan(html);
  assert.doesNotMatch(html, /Debrief my contributions|Loading/);
  assert.match(html, /Sample debrief/);
  assert.ok(html.includes(sample.nextStep));
});

test("the debrief reads in zh-TW", () => {
  const html = renderZh(panel({ locked: true, debriefs: [stored] }));
  assert.match(html, /<h2 id="debrief-title">教練回顧<\/h2>/);
  assert.match(html, /回顧我在這個專案的貢獻/);
  assert.match(html, /維護者最常提到：命名/);
  assert.match(renderZh(createElement(DebriefCard, { debrief: getDemo("zh-TW").debriefSample! })), /<h3>下一步<\/h3>/);
});

test("the stored debriefs are read per project, and a debrief is asked for with the project only", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let missing = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (missing)
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    const body = init?.method === "POST" ? { debrief: stored } : { debriefs: [stored] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  assert.deepEqual(await fetchDebriefs("repo a"), [stored]);
  assert.deepEqual(await requestDebrief("repo-b"), stored);
  // A server without the debrief routes has no stored debriefs.
  missing = true;
  assert.deepEqual(await fetchDebriefs("repo-b"), []);
  await assert.rejects(requestDebrief("repo-b"), /Not found/);
  assert.deepEqual(calls.slice(0, 2), [
    { url: "/api/learning/debriefs?repoId=repo%20a", method: "GET" },
    { url: "/api/learning/debrief", method: "POST", body: { repoId: "repo-b" } },
  ]);
});
