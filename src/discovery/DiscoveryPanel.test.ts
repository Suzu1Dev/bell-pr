import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { act, createElement } from "react";
import type { DoctorCheck } from "../../shared/doctor";
import {
  defaultDiscoveryPreferences,
  type DiscoveryJob,
} from "../../shared/discovery";
import {
  freeEntitlements,
  proEntitlements,
  type LicenseSummary,
} from "../../shared/plans";
import { getSampleDiscoveryJob } from "../demo/discovery";
import { licenseChangedEvent } from "../license/useEntitlements";
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

/** The live panel: Pro, outside the demo. */
const live: Partial<Props> = { entitlements: proEntitlements(2), demo: false };

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
  assert.match(html, /<h2>Where do you want to start\?<\/h2>/);
  assert.match(html, /placeholder="For example: accessibility, developer tools"/);
  assert.match(html, /<option value="beginner" selected="">Beginner-friendly<\/option>/);
  assert.match(html, /<option value="stars" selected="">Stars<\/option>/);
  assert.match(html, /<option value=""[^>]*>Use the Codex default model<\/option>/);
  assert.match(html, /<option value="lite" selected="">Lite · default<\/option>/);
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

const free: LicenseSummary = {
  plan: "free",
  source: "none",
  status: "none",
  reason: "no_license",
  trialAvailable: true,
};
const trial: LicenseSummary = {
  plan: "trial",
  source: "trial",
  status: "active",
  trialDaysLeft: 14,
  trialAvailable: false,
};

const panel = (initialJob: DiscoveryJob | null | undefined, options: Partial<Props>) =>
  renderEn(createElement(DiscoveryPanel, props(initialJob, options)));
const fieldsets = (html: string) =>
  [...html.matchAll(/<fieldset([^>]*)class="discovery-fields/g)].map((match) => match[1].includes("disabled"));
const submit = (html: string) =>
  html.match(/<button type="submit"[^>]*>.*?<\/button>/)?.[0] ?? "";
const proChips = (html: string) => html.match(/class="pro-badge"/g)?.length ?? 0;
const sample = getSampleDiscoveryJob("en");

test("on Free the panel shows labelled sample results, a locked form and the ways to Pro", () => {
  const html = panel(null, { license: free, demo: false });
  assertNoHan(html);
  assert.match(html, /<div class="discovery-sample-banner" role="note"><strong>Sample results — not live<\/strong><span class="pro-badge"/);
  assert.match(html, /Nothing here comes from GitHub or an AI, and they cannot be imported\./);
  assert.deepEqual(fieldsets(html), [true, true]);
  assert.match(submit(html), /disabled=""/);
  assert.match(submit(html), /Recommend contributions<span class="pro-badge"/);
  assert.match(html, /Live discovery searches GitHub and has your AI provider weigh each project\. It is part of Pro/);
  assert.match(html, /<button type="button" class="button primary">Start 14-day trial<\/button>/);
  assert.match(html, /<button type="button" class="button secondary">Upgrade to Pro<\/button>/);
  // Every sample opportunity, with plain names: no link leads anywhere.
  assert.equal(html.match(/<article class="discovery-opportunity"/g)?.length, sample.opportunities.length);
  for (const candidate of sample.candidates)
    assert.ok(html.includes(`<span class="discovery-repo-link">`) && html.includes(candidate.fullName));
  assert.doesNotMatch(html, /<a [^>]*href="(?!#)/);
  assert.doesNotMatch(html, /lucide-github/);
  assert.match(html, /<span class="discovery-source-title">/);
  // A sample cannot be chosen.
  assert.equal(
    html.match(/<button class="button primary" disabled="">.*?Choose this opportunity<\/button>/g)?.length,
    sample.opportunities.length,
  );
  assert.match(html, /A sample cannot be chosen\. Live discovery finds real projects you can import\./);
  // Once the trial was used, only the upgrade remains.
  const used = panel(null, { license: { ...free, trialAvailable: false }, demo: false });
  assert.doesNotMatch(used, /Start 14-day trial/);
  assert.match(used, /Upgrade to Pro/);
  // The same with entitlements alone.
  assert.match(panel(null, { entitlements: freeEntitlements, demo: false }), /Sample results — not live/);
  const zh = renderZh(createElement(DiscoveryPanel, props(null, { license: free, demo: false })));
  assert.match(zh, /示範結果，非即時資料/);
  assert.match(zh, />開始 14 天試用</);
});

test("while the plan is read, the panel waits and sends nothing", () => {
  const html = panel(null, { demo: false });
  assert.match(html, /Loading your discovery history…/);
  assert.doesNotMatch(html, /Good contributions start|Sample results/);
  assert.match(submit(html), /disabled=""/);
});

test("on Free, results saved earlier stay readable in place of the sample", () => {
  const html = panel(job, { license: free, demo: false });
  assertNoHan(html);
  assert.doesNotMatch(html, /Sample results — not live/);
  assert.match(html, /<a class="discovery-repo-link" href="https:\/\/github\.com\/example\/widgets"/);
  assert.match(html, /Upgrade to Pro/);
  assert.deepEqual(fieldsets(html), [true, true]);
  // Importing a project is Free, so a saved result can still be chosen.
  assert.match(html, /<button class="button primary">.*?Choose this opportunity<\/button>/);
  // A discovery still running can be stopped.
  const running = panel({ ...job, status: "running", phase: "searching", opportunities: [] }, { license: free, demo: false });
  assert.match(running, /Stop discovery/);
  assert.doesNotMatch(running, /Sample results/);
});

test("on Pro and the trial the live form is open, with no sample and no chip", () => {
  for (const options of [{ entitlements: proEntitlements(2) }, { license: trial }]) {
    const html = panel(null, { ...options, demo: false });
    assertNoHan(html);
    assert.doesNotMatch(html, /Sample results|Upgrade to Pro|Start 14-day trial/);
    assert.deepEqual(fieldsets(html), [false, false]);
    assert.doesNotMatch(submit(html), /disabled/);
    assert.equal(proChips(html), 0);
    assert.match(html, /Good contributions start with understanding the need\./);
  }
});

test("the demo shows the sample results with a PRO chip and nothing locked", () => {
  const html = panel(undefined, { entitlements: freeEntitlements, demo: true });
  assertNoHan(html);
  assert.match(html, /Sample results — not live/);
  assert.doesNotMatch(html, /Upgrade to Pro|Start 14-day trial/);
  assert.deepEqual(fieldsets(html), [false, false]);
  assert.doesNotMatch(submit(html), /disabled/);
  // The heading, the submit button and the banner.
  assert.equal(proChips(html), 3);
  // The form shows what the sample searched for.
  assert.ok(html.includes(`value="${sample.preferences.interests}"`));
  assert.doesNotMatch(html, /Loading your discovery history/);
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
    panel({ ...job, preferences }, { entitlements: proEntitlements(2), demo: false, doctor: doctor(checks) });
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
  // Free and the demo check nothing.
  assert.doesNotMatch(panel(null, { license: free, demo: false, doctor: doctor([check("gh", "fail")]) }), /readiness-notice/);
});

test("saved results in another language than the UI's say so", () => {
  const live = panel({ ...job, locale: "zh-TW" }, { entitlements: proEntitlements(2), demo: false });
  assertNoHan(live);
  assert.match(
    live,
    /<p class="discovery-locale-notice" role="status"><svg[^>]*>.*?<\/svg><span>These results were written in Traditional Chinese\. Search again to get them in English\.<\/span><\/p>/,
  );
  const locked = panel({ ...job, locale: "zh-TW" }, { license: free, demo: false });
  assert.match(locked, /<span>These results were written in Traditional Chinese\.<\/span>/);
  for (const html of [
    panel({ ...job, locale: "en" }, { entitlements: proEntitlements(2), demo: false }),
    panel(job, { entitlements: proEntitlements(2), demo: false }),
    panel(null, { license: free, demo: false }),
  ])
    assert.doesNotMatch(html, /discovery-locale-notice/);
  assert.match(
    renderZh(createElement(DiscoveryPanel, props({ ...job, locale: "en" }, { entitlements: proEntitlements(2), demo: false }))),
    /這些結果以英文撰寫。重新搜尋即可取得繁體中文的結果。/,
  );
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** fetch that answers what the panel reads, and records every request. */
function stubApi(license: LicenseSummary, saved: DiscoveryJob | null) {
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    const body = url.startsWith("/api/license")
      ? { license }
      : url.startsWith("/api/discovery")
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

test("once mounted on Free the panel reads the plan and saved results, sends no search, and opens with the trial", async () => {
  const requests = stubApi(free, null);
  const view = await mount(createElement(DiscoveryPanel, props(undefined, { demo: false })));
  try {
    assert.ok(view.text().includes("Sample results — not live"));
    const fields = view.container.querySelectorAll((element) => element.tagName === "fieldset");
    assert.deepEqual(fields.map(isDisabled), [true, true]);
    assert.ok(requests.includes("GET /api/license"));
    assert.ok(requests.includes("GET /api/discovery"));
    assert.ok(!requests.some((request) => request.startsWith("POST")), requests.join());
    // Free checks no environment: there is nothing to search with.
    assert.ok(!requests.some((request) => request.includes("/api/doctor")));

    // The trial starts (here from another screen): the live form opens.
    await act(async () => {
      window.dispatchEvent(new CustomEvent(licenseChangedEvent, { detail: trial }));
    });
    assert.ok(!view.text().includes("Sample results"));
    assert.ok(!view.text().includes("Upgrade to Pro"));
    assert.deepEqual(fields.map(isDisabled), [false, false]);
    const button = view.container.querySelectorAll((element) => element.getAttribute("type") === "submit")[0];
    assert.ok(button && !isDisabled(button));
    assert.ok(requests.some((request) => request.startsWith("GET /api/doctor")));
    assert.ok(!requests.some((request) => request.startsWith("POST")), requests.join());
  } finally {
    await view.unmount();
  }
});

test("the demo reads nothing from the server and sends nothing", async () => {
  const requests = stubApi(free, job);
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

