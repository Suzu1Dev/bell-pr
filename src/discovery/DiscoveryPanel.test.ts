import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import {
  defaultDiscoveryPreferences,
  type DiscoveryJob,
} from "../../shared/discovery";
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
const props = (initialJob: DiscoveryJob | null | undefined): Props => ({
  onChoose() {},
  initialJob,
});

/** Renders in English and checks that no zh-TW text is left. */
const renderEnglish = (initialJob: DiscoveryJob | null | undefined) => {
  const html = renderEn(createElement(DiscoveryPanel, props(initialJob)));
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
  assert.match(html, /<dd>High · high<\/dd>/);
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
  const html = renderZh(createElement(DiscoveryPanel, props(job)));
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
