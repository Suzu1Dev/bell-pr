import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import type { DoctorCheck } from "../../shared/doctor";
import {
  defaultDiscoveryPreferences,
  type DiscoveryJob,
} from "../../shared/discovery";
import { getSampleDiscoveryJob } from "../demo/discovery";
import { mount, type FakeElement } from "../mission/test-dom";
import type { DoctorState } from "../setup/useDoctor";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import DiscoveryPanel from "./DiscoveryPanel";

// The smallest finished discovery: one candidate with one source and one
// opportunity that quotes it.
const job: DiscoveryJob = {
  id: "job-1",
  status: "ready",
  phase: "complete",
  message: "Found 1 opportunity.",
  preferences: { ...defaultDiscoveryPreferences, sort: "stars" },
  createdAt: "2026-10-01T08:00:00.000Z",
  completedAt: "2026-10-01T08:05:00.000Z",
  candidates: [
    {
      fullName: "example/widgets",
      url: "https://github.com/example/widgets",
      description: "Accessible UI widgets.",
      language: "",
      stars: 12_345,
      forks: 678,
      pushedAt: "2026-09-30T12:00:00Z",
      openIssues: 4,
      sources: [
        {
          id: "issue-1",
          kind: "issue",
          title: "Focus is lost after closing the dialog",
          url: "https://github.com/example/widgets/issues/1",
          content: "Focus is lost after closing the dialog.",
        },
      ],
      warnings: ["The README was shortened."],
    },
  ],
  opportunities: [
    {
      id: "opp-1",
      repository: "example/widgets",
      title: "Return focus when the dialog closes",
      summary: "Restore focus to the button that opened the dialog.",
      userNeed: "Keyboard users lose their place.",
      contributionRules: "Open an issue before a pull request.",
      popularity: "Active this month.",
      feasibility: "A small change in one component.",
      difficulty: "beginner",
      effort: "About two hours.",
      firstSteps: ["Reproduce the bug with a keyboard."],
      acceptanceChecks: ["Focus returns to the trigger."],
      risks: ["A maintainer may already be working on it."],
      evidence: [
        {
          sourceId: "issue-1",
          quote: "Focus is lost after closing the dialog.",
          reason: "The reporter describes the bug.",
        },
      ],
    },
  ],
  warnings: ["GitHub returned partial search results."],
  modelExecution: {
    provider: "claude",
    model: "sonnet",
    reasoningEffort: "high",
    source: "selected",
  },
  efficiency: {
    policyVersion: "bell-ponytail-v1",
    mode: "lite",
    calls: 1,
    completedCalls: 1,
    failedCalls: 0,
    measuredCalls: 1,
    durationMs: 4_000,
    inputTokens: 1_000,
    cachedInputTokens: 0,
    outputTokens: 200,
  },
};

type Props = Parameters<typeof DiscoveryPanel>[0];
const props = (
  initialJob: DiscoveryJob | null | undefined,
  options: Partial<Props> = {},
): Props => ({
  onChoose() {},
  initialJob,
  ...options,
});

/** The live panel, outside the sample project. */
const live: Partial<Props> = { demo: false };

/** Renders the live panel in English and checks that no zh-TW text is left. */
const renderEnglish = (initialJob: DiscoveryJob | null | undefined) => {
  const html = renderEn(createElement(DiscoveryPanel, props(initialJob, live)));
  assertNoHan(html);
  return html;
};

test("an English render of a finished discovery has no Han", () => {
  const html = renderEnglish(job);
  // The form
  assert.match(html, /<span class="eyebrow">FIND YOUR NEXT CONTRIBUTION<\/span>/);
  // Like every page's heading, it can take the focus when the app opens the page.
  assert.match(html, /<h1 tabindex="-1">Find the next contribution<br\/>/);
  assert.match(html, /<h2>Where do you want to start\?<\/h2>/);
  assert.match(html, /placeholder="For example: accessibility, developer tools"/);
  assert.match(html, /<option value="beginner" selected="">Beginner-friendly<\/option>/);
  assert.match(html, /<option value="stars" selected="">Stars<\/option>/);
  assert.match(html, /<option value=""[^>]*>Use the Codex default model<\/option>/);
  assert.match(html, /<option value="lite" selected="">Lean · default<\/option>/);
  assert.match(
    html,
    /<label title="Efficiency mode is based on Ponytail by DietrichGebert \(MIT\)\.">Efficiency mode<select>/,
  );
  assert.match(html, /The analysis uses your Codex sign-in/);
  // The status and the shortlist
  assert.match(html, /<span>Found 1 opportunity\.<\/span><small>Searched [^<]*2026[^<]*<\/small>/);
  assert.match(html, /<summary>Scope and limits of this search · 1<\/summary>/);
  assert.match(html, /aria-label="Recommended contributions"/);
  assert.match(html, /YOUR CONTRIBUTION SHORTLIST/);
  assert.match(html, /in the &quot;Stars&quot; order you chose/);
  assert.match(html, /<span class="discovery-count">1 opportunity<\/span>/);
  // The opportunity card
  assert.match(html, /<span class="discovery-difficulty">Beginner<\/span>/);
  assert.match(html, /12,345/);
  assert.match(html, /678/);
  assert.match(html, /<span>Language not specified<\/span><span>Last push 2026-09-30<\/span>/);
  assert.match(html, /<h4>Who does this contribution help\?<\/h4>/);
  assert.match(html, /Evidence and quoted sources · 1/);
  assert.match(html, /The README was shortened\./);
  assert.match(html, /Choose this opportunity<\/button>/);
  // The model and usage of the discovery
  assert.match(html, /<summary>Model and usage for this discovery<\/summary>/);
  assert.match(html, /<dd>High<\/dd>/);
  assert.match(html, /<strong>Discovery AI usage<\/strong>/);
});

test("English renders of the other discovery states have no Han", () => {
  assert.match(renderEnglish(undefined), /Loading your discovery history…/);

  const first = renderEnglish(null);
  assert.match(first, /Good contributions start with understanding the need\./);
  assert.match(first, /<span>04<\/span><strong>Barrier to entry<\/strong>/);

  const nothing = renderEnglish({
    ...job,
    opportunities: [],
    warnings: [],
    message: "No suitable opportunity found.",
  });
  assert.match(nothing, /Change the criteria and look for the next opportunity\./);
  assert.doesNotMatch(nothing, /Scope and limits/);

  const running = renderEnglish({
    ...job,
    status: "running",
    phase: "screening",
    message: "Checking contribution rules…",
    opportunities: [],
    modelExecution: undefined,
  });
  assert.match(running, /aria-label="Discovery progress"/);
  assert.match(running, /RESEARCH IN PROGRESS/);
  assert.match(running, /<strong>Search projects<\/strong>/);
  assert.match(running, /<strong>Check the rules and needs<\/strong>/);
  assert.match(running, /Stop discovery/);

  const previous = renderEnglish({
    ...job,
    opportunities: [],
    previousResult: {
      createdAt: job.createdAt,
      candidates: job.candidates,
      opportunities: job.opportunities,
    },
  });
  assert.match(previous, /PREVIOUS RESULTS/);
  assert.match(previous, /Your previous recommendations are still here\./);
  assert.match(previous, /These results are from [^<]*2026[^<]* and do not reflect/);
});

test("a learn-by-hand opportunity is tagged, has no agent-team choice, and keeps its reading", () => {
  const byHand: DiscoveryJob = {
    ...job,
    opportunities: [{ ...job.opportunities[0], learnByHand: true }],
  };
  const html = renderEnglish(byHand);
  assert.match(
    html,
    /<span class="discovery-learn-tag"><svg[^>]*lucide-hand[\s\S]*?<\/svg>Learn by hand: write this one yourself<\/span><h3>Return focus when the dialog closes<\/h3>/,
  );
  assert.doesNotMatch(html, /Choose this opportunity/);
  assert.match(html, /The issue is labelled for newcomers\. Writing the fix yourself is how you learn the project/);
  // The person can start writing it, with the guide (DESIGN v1.2 F1).
  assert.match(html, /<button type="button" class="button primary"><svg[^>]*lucide-hand[\s\S]*?<\/svg>Start learning by hand<\/button>/);
  // The issue it cites opens on GitHub; the overview and the sources stay.
  assert.match(
    html,
    /<a class="button secondary" href="https:\/\/github\.com\/example\/widgets\/issues\/1" target="_blank" rel="noreferrer">Open the issue<svg/,
  );
  assert.match(html, /<h4>Who does this contribution help\?<\/h4>/);
  assert.match(html, /Contribution rules and activity/);
  assert.match(html, /First steps, acceptance checks and open questions/);
  assert.match(html, /Evidence and quoted sources · 1/);
  // Without an issue link (a sample), there is nothing to open.
  const noLink: DiscoveryJob = {
    ...byHand,
    candidates: [{ ...job.candidates[0], sources: [{ ...job.candidates[0].sources[0], url: "" }] }],
  };
  assert.doesNotMatch(renderEnglish(noLink), /Open the issue/);
  // Opportunities without the flag keep their choice.
  assert.match(renderEnglish(job), /Choose this opportunity<\/button>/);
  assert.doesNotMatch(renderEnglish(job), /discovery-learn-tag/);
  const zh = renderZh(createElement(DiscoveryPanel, props(byHand, live)));
  assert.match(zh, /親手學：這一個請自己寫/);
  assert.doesNotMatch(zh, /選擇此項目/);
});

test("the sample's learn-by-hand opportunity shows its tag in place of the choice", () => {
  const sampleJob = getSampleDiscoveryJob("en");
  const html = renderEn(createElement(DiscoveryPanel, props(undefined, { demo: true })));
  assertNoHan(html);
  const cards = html.split('<article class="discovery-opportunity"').slice(1);
  assert.equal(cards.length, sampleJob.opportunities.length);
  sampleJob.opportunities.forEach((item, index) => {
    assert.equal(cards[index].includes("Learn by hand: write this one yourself"), !!item.learnByHand, item.id);
    assert.equal(cards[index].includes("Choose this opportunity"), !item.learnByHand, item.id);
  });
});

test("saved settings missing from the catalog are labelled in English", () => {
  const html = renderEnglish({
    ...job,
    preferences: {
      ...job.preferences,
      provider: "claude",
      model: "retired-model",
      reasoningEffort: "xhigh",
    },
  });
  assert.match(html, /<option value="">Use the Claude Code default model<\/option>/);
  assert.match(html, /retired-model \(not in the catalog\)/);
  assert.match(html, /Extra high \(saved, not in the catalog\)/);
});

test("the zh-TW render keeps the original copy and formats numbers", () => {
  const html = renderZh(createElement(DiscoveryPanel, props(job, live)));
  assert.match(html, /找到值得投入的<br\/><em>下一個貢獻。<\/em>/);
  assert.match(html, /依你選的「星數」排序取 12 個候選/);
  assert.match(html, /<span class="discovery-count">1 個項目<\/span>/);
  assert.match(html, /<span class="discovery-difficulty">初學者<\/span>/);
  assert.match(html, /12,345/);
  assert.match(html, /<span>未標示語言<\/span><span>最近推送 2026-09-30<\/span>/);
  assert.match(html, /推薦依據與原文 · 1 則/);
  assert.match(html, /這次搜尋的範圍與限制 · 1/);
  assert.match(html, /<dd>高 · high<\/dd>/);
  assert.match(html, /<strong>探索 AI 用量<\/strong>/);
});

const panel = (initialJob: DiscoveryJob | null | undefined, options: Partial<Props>) =>
  renderEn(createElement(DiscoveryPanel, props(initialJob, options)));
const fieldsets = (html: string) =>
  [...html.matchAll(/<fieldset([^>]*)class="discovery-fields/g)].map((match) => match[1].includes("disabled"));
const submit = (html: string) =>
  html.match(/<button type="submit"[^>]*>.*?<\/button>/)?.[0] ?? "";
const sample = getSampleDiscoveryJob("en");

test("the live form is open from the first render, with no sample and no chip", () => {
  const html = panel(null, live);
  assertNoHan(html);
  assert.doesNotMatch(html, /Sample results/);
  assert.deepEqual(fieldsets(html), [false, false]);
  assert.doesNotMatch(submit(html), /disabled/);
  assert.doesNotMatch(html, /pro-badge/);
  assert.match(html, /Good contributions start with understanding the need\./);
});

test("while the saved results load, the panel waits and sends nothing", () => {
  const html = panel(undefined, live);
  assert.match(html, /Loading your discovery history…/);
  assert.doesNotMatch(html, /Good contributions start|Sample results/);
  assert.match(submit(html), /disabled=""/);
});

test("saved results show with their repository links and can be chosen", () => {
  const html = panel(job, live);
  assertNoHan(html);
  assert.doesNotMatch(html, /Sample results — not live/);
  assert.match(html, /<a class="discovery-repo-link" href="https:\/\/github\.com\/example\/widgets"/);
  assert.deepEqual(fieldsets(html), [false, false]);
  assert.match(html, /<button class="button primary">.*?Choose this opportunity<\/button>/);
  // A discovery still running can be stopped, and the form waits for it.
  const running = panel({ ...job, status: "running", phase: "searching", opportunities: [] }, live);
  assert.match(running, /Stop discovery/);
  assert.deepEqual(fieldsets(running), [true, true]);
  assert.doesNotMatch(running, /Sample results/);
});

test("the sample project shows its sample results as ordinary sample data", () => {
  const html = panel(undefined, { demo: true });
  assertNoHan(html);
  assert.match(
    html,
    /<div class="discovery-sample-banner" role="note"><strong>Sample results — not live<\/strong><span>These fictional projects show what discovery finds\./,
  );
  assert.match(html, /Nothing here comes from GitHub or an AI, and they cannot be imported\./);
  assert.doesNotMatch(html, /pro-badge|Upgrade|trial/i);
  assert.deepEqual(fieldsets(html), [false, false]);
  assert.doesNotMatch(submit(html), /disabled/);
  // Every sample opportunity, with plain names: no link leads anywhere.
  assert.equal(html.match(/<article class="discovery-opportunity"/g)?.length, sample.opportunities.length);
  for (const candidate of sample.candidates)
    assert.ok(html.includes(`<span class="discovery-repo-link">`) && html.includes(candidate.fullName));
  assert.doesNotMatch(html, /<a [^>]*href="(?!#)/);
  assert.doesNotMatch(html, /lucide-github/);
  assert.match(html, /<span class="discovery-source-title">/);
  // A sample cannot be chosen, and a newcomer issue offers no choice at all.
  const byHand = sample.opportunities.filter((item) => item.learnByHand).length;
  assert.ok(byHand > 0, "the sample has a learn-by-hand opportunity");
  assert.equal(
    html.match(/<button class="button primary" disabled="">.*?Choose this opportunity<\/button>/g)?.length,
    sample.opportunities.length - byHand,
  );
  assert.match(html, /A sample cannot be chosen\. Live discovery finds real projects you can import\./);
  // The heading's note describes a live search, not one the reader ran.
  assert.match(html, /A live search takes 12 candidates in the order you choose/);
  assert.doesNotMatch(html, /order you chose/);
  // The form shows what the sample searched for.
  assert.ok(html.includes(`value="${sample.preferences.interests}"`));
  assert.doesNotMatch(html, /Loading your discovery history/);
  const zh = renderZh(createElement(DiscoveryPanel, props(undefined, { demo: true })));
  assert.match(zh, /示範結果，非即時資料/);
});

const check = (
  id: DoctorCheck["id"],
  status: DoctorCheck["status"],
  extra: Partial<DoctorCheck> = {},
): DoctorCheck => ({ id, status, required: false, ...extra });
const doctor = (checks: DoctorCheck[]): DoctorState => ({
  report: { checks, ready: true, checkedAt: "2026-10-14T00:00:00.000Z", platform: "linux" },
  checking: false,
  error: "",
  refresh: async () => {},
});
const ready = [
  check("gh", "ok"),
  check("gh-auth", "ok"),
  check("codex", "ok"),
  check("codex-auth", "ok"),
];

test("a live search waits for the GitHub CLI and the chosen provider, and says how to fix them", () => {
  const live = (checks: DoctorCheck[], preferences = job.preferences) =>
    panel({ ...job, preferences }, { demo: false, doctor: doctor(checks) });
  const fine = live(ready);
  assert.doesNotMatch(fine, /readiness-notice/);
  assert.doesNotMatch(submit(fine), /disabled/);

  const noGh = live([
    check("gh", "fail", { detail: "Not installed.", fixes: [{ label: "Install gh", command: "brew install gh" }] }),
    ...ready.slice(2),
  ]);
  assertNoHan(noGh);
  assert.match(noGh, /This needs the GitHub CLI, installed and signed in\./);
  assert.match(noGh, /brew install gh/);
  assert.match(submit(noGh), /disabled=""/);

  const claude = live([...ready, check("claude", "ok"), check("claude-auth", "warn", { detail: "Not signed in." })], {
    ...job.preferences,
    provider: "claude",
  });
  assert.match(claude, /This needs an AI provider/);
  assert.match(claude, /Claude Code sign-in: Not signed in\./);
  assert.match(submit(claude), /disabled=""/);
  // The sample project checks nothing.
  assert.doesNotMatch(panel(undefined, { demo: true, doctor: doctor([check("gh", "fail")]) }), /readiness-notice/);
});

test("saved results in another language than the UI's say so", () => {
  const html = panel({ ...job, locale: "zh-TW" }, live);
  assertNoHan(html);
  assert.match(
    html,
    /<p class="discovery-locale-notice" role="status"><svg[^>]*>.*?<\/svg><span>These results were written in Traditional Chinese\. Search again to get them in English\.<\/span><\/p>/,
  );
  for (const other of [panel({ ...job, locale: "en" }, live), panel(job, live), panel(null, live)])
    assert.doesNotMatch(other, /discovery-locale-notice/);
  assert.match(
    renderZh(createElement(DiscoveryPanel, props({ ...job, locale: "en" }, live))),
    /這些結果以英文撰寫。重新搜尋即可取得繁體中文的結果。/,
  );
});

test("the language notice follows the previous results on screen, not the search that found nothing", () => {
  const earlier = (locale?: DiscoveryJob["locale"]): DiscoveryJob["previousResult"] => ({
    createdAt: job.createdAt,
    candidates: job.candidates,
    opportunities: job.opportunities,
    ...(locale ? { locale } : {}),
  });
  const empty = { ...job, message: "No suitable opportunity found.", candidates: [], opportunities: [] };
  // Chinese results kept under an English search that found nothing.
  const chinese = panel({ ...empty, locale: "en", previousResult: earlier("zh-TW") }, live);
  assert.match(chinese, /PREVIOUS RESULTS/);
  assert.match(chinese, /These results were written in Traditional Chinese\. Search again to get them in English\./);
  // English results kept under a Chinese search, and results saved before
  // their language was recorded, say nothing.
  for (const previousResult of [earlier("en"), earlier()]) {
    const html = panel({ ...empty, locale: "zh-TW", previousResult }, live);
    assert.match(html, /PREVIOUS RESULTS/);
    assert.doesNotMatch(html, /discovery-locale-notice/);
  }
  // No results on screen: nothing to describe.
  for (const status of ["failed", "running"] as const)
    assert.doesNotMatch(panel({ ...empty, status, locale: "zh-TW" }, live), /discovery-locale-notice/);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** fetch that answers what the panel reads, and records every request. */
function stubApi(saved: DiscoveryJob | null) {
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    const body = url.startsWith("/api/discovery")
      ? { job: saved }
      : url.startsWith("/api/models")
        ? { source: "codex", models: [] }
        : { checks: ready, ready: true, checkedAt: "", platform: "linux" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return requests;
}

/** Whether `element` or a fieldset around it is disabled. */
const isDisabled = (element: FakeElement) =>
  element.disabled || element.hasAttribute("disabled");

test("once mounted the panel reads the saved results and the environment, and sends no search", async () => {
  const requests = stubApi(null);
  const view = await mount(createElement(DiscoveryPanel, props(undefined, { demo: false })));
  try {
    assert.ok(!view.text().includes("Sample results"));
    const fields = view.container.querySelectorAll((element) => element.tagName === "fieldset");
    assert.deepEqual(fields.map(isDisabled), [false, false]);
    assert.ok(requests.includes("GET /api/discovery"));
    assert.ok(requests.some((request) => request.startsWith("GET /api/doctor")));
    const button = view.container.querySelectorAll((element) => element.getAttribute("type") === "submit")[0];
    assert.ok(button && !isDisabled(button));
    assert.ok(!requests.some((request) => request.startsWith("POST")), requests.join());
  } finally {
    await view.unmount();
  }
});

test("the demo reads nothing from the server and sends nothing", async () => {
  const requests = stubApi(job);
  const view = await mount(createElement(DiscoveryPanel, props(undefined, { demo: true })));
  try {
    assert.ok(view.text().includes("Sample results — not live"));
    assert.deepEqual(
      requests.filter((request) => !request.startsWith("GET /api/models")),
      [],
    );
  } finally {
    await view.unmount();
  }
});

