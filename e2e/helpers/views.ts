// The v1.1 views that need a few steps to reach, for the accessibility
// gate (e2e/a11y.spec.ts) and the narrow widths (e2e/responsive.spec.ts):
// each step of the Explain-it-back panel, Settings → Learning with the
// check-off dialog open, the Practice view, the rules card, the Draft
// tab's maintainer checklist, the sample's code walkthrough with a range
// marked in the diff, its commit history with a commit open on a file's
// diff, the brief of a real run whose premise was refuted, and the publish
// dialog's groups of checks on a real run; and Learn by hand's views on a
// real run (v1.2): the plan with the guide, the guide's panel with a thread
// and the Tests card while the person writes, the Ready dialog, and the
// publish dialog's run record. Each view opens its route, then
// drive() takes it to the state; `include` names the part of the page the
// view is about.
import { expect, type Page } from "@playwright/test";
import { changeFingerprint } from "../../shared/change-fingerprint";
import type { Locale } from "../../shared/i18n/locale";
import recordEn from "../../src/byhand/record/i18n/en";
import recordZh from "../../src/byhand/record/i18n/zh-TW";
import writeEn from "../../src/byhand/write/i18n/en";
import writeZh from "../../src/byhand/write/i18n/zh-TW";
import { getDemo } from "../../src/demo/all";
import { files, issueNode, otherPr, runId, welcomeFacts, type RealProjectOptions } from "./real-project";
import { messages } from "./sample-states";

export interface StateView {
  name: string;
  /** The route to open, without the locale and presentation flags. */
  route: string;
  /** Takes the opened page to the view. */
  drive?(page: Page, locale: Locale): Promise<void>;
  /** The part of the page the view is about. */
  include: string;
  /** The view needs a real project's server (startRealProject with these options). */
  real?: RealProjectOptions;
  /** Wider windows to check besides the phones, where the view's layout changes. */
  wider?: { width: number; height: number }[];
}

const panel = (page: Page) => page.locator(".understanding-check");
const step = (page: Page, name: string) => panel(page).getByRole("region", { name });

/** Types a sample answer with its Fill button and waits until it is in. */
async function fill(region: ReturnType<typeof step>, value: string, locale: Locale) {
  await region.getByRole("button", { name: messages[locale].workspace.check.fill }).first().click();
  await expect(region.getByRole("textbox").first()).toHaveValue(value);
}

/** The check panel open on the sample, its summary typed. */
async function checkExplained(page: Page, locale: Locale) {
  const t = messages[locale].workspace.check;
  await expect(panel(page).getByRole("heading", { name: t.title })).toBeVisible();
  await fill(step(page, t.explainTitle), getDemo(locale).understandingSample!.summary, locale);
}

/** …its answers typed with their confidence, and locked: the grade step. */
async function checkLocked(page: Page, locale: Locale) {
  const t = messages[locale].workspace.check;
  const sample = getDemo(locale).understandingSample!;
  await checkExplained(page, locale);
  const answers = step(page, t.answerTitle).getByRole("listitem");
  for (const [index, id] of ["selfCheck:src/utils/retry.ts", "untested"].entries()) {
    const entry = answers.nth(index);
    await entry.getByRole("button", { name: t.fill }).click();
    await expect(entry.getByRole("textbox")).toHaveValue(sample.answers[id].answer);
    await entry.getByRole("radio", { name: t.confidences[sample.answers[id].confidence] }).check();
  }
  await panel(page).getByRole("button", { name: t.lock }).click();
  await expect(step(page, t.gradeTitle)).toBeVisible();
}

/** …graded Partly: the correction step. */
async function checkGraded(page: Page, locale: Locale) {
  const t = messages[locale].workspace.check;
  await checkLocked(page, locale);
  await step(page, t.gradeTitle).getByRole("radio", { name: t.grades.partly }).check();
  await expect(step(page, t.correctTitle)).toBeVisible();
}

/** …corrected and saved: the forecast step and the result. */
async function checkPassed(page: Page, locale: Locale) {
  const t = messages[locale].workspace.check;
  const sample = getDemo(locale).understandingSample!;
  await checkGraded(page, locale);
  await fill(step(page, t.correctTitle), sample.answers["selfCheck:src/utils/retry.ts"].correction!, locale);
  await panel(page).getByRole("button", { name: t.saveGrades }).click();
  await expect(step(page, t.forecastTitle)).toBeVisible();
  await expect(panel(page).getByRole("region", { name: t.resultTitle })).toBeVisible();
}

/** …and the forecast saved. */
async function checkForecast(page: Page, locale: Locale) {
  const t = messages[locale].workspace.check;
  const sample = getDemo(locale).understandingSample!;
  await checkPassed(page, locale);
  const forecast = step(page, t.forecastTitle);
  await forecast.getByRole("radio", { name: t.dimensions[sample.forecast.dimension] }).check();
  await fill(forecast, sample.forecast.question, locale);
  await forecast.getByRole("button", { name: t.saveForecast }).click();
  await expect(panel(page).getByRole("region", { name: t.resultTitle })).toContainText(
    t.forecast({ dimension: t.dimensions[sample.forecast.dimension] }),
  );
}

const checkRoute = "#/runs/demo-run/changes?panel=check";

const write = { en: writeEn, "zh-TW": writeZh } as const;
const runRecord = { en: recordEn, "zh-TW": recordZh } as const;

/** A clean Learn-by-hand run of the real project (src/greeting.ts and the rest changed by the person), at `status`. */
function byHandRun(status: string, phase: string, byHand: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const at = "2026-10-14T09:00:00.000Z";
  const agent = (id: string, name: string) => ({ id, name, role: name, status: "complete", detail: "" });
  return {
    status,
    learnByHand: true,
    agents: [agent("lead", "Guide"), agent("reviewer", "Reviewer"), agent("tester", "Test analyst")],
    explanations: {},
    draft: { title: "", body: "" },
    team: {
      config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
      phase,
      planSummary: "Greetings are always in English, so people who read another language get one they don't read.",
      tasks: [],
      messages: [],
    },
    byHand: {
      guidePlan: {
        summary: "Greetings are always in English, so people who read another language get one they don't read.",
        steps: [{ title: "Read how the greeting is built", files: [files.greeting] }, { title: "Look the greeting up by language", files: [files.greeting] }],
        readFirst: [{ path: files.greeting, startLine: 1, endLine: 3, why: "Where the greeting is built." }],
        at,
      },
      ...byHand,
    },
    ...extra,
  };
}

const steps = [
  { id: "s1", title: "Read how the greeting is built", files: [files.greeting], doneAt: "2026-10-14T09:10:00.000Z" },
  { id: "s2", title: "Look the greeting up by language, with English when a language has none", files: [files.greeting] },
];
/** A run in review while the person writes: a thread of answers, a failing test run, a confirmed command. */
const writingRun: RealProjectOptions = {
  repo: { testCommand: { command: "npx vitest run test/greeting.test.ts", confirmedAt: "2026-10-14T09:00:00.000Z" } },
  run: byHandRun("review", "developing", {
    plan: { steps, savedAt: "2026-10-14T09:05:00.000Z", confirmedAt: "2026-10-14T09:05:00.000Z", outlineAt: "2026-10-14T09:02:00.000Z" },
    hints: { s2: { rung: 1, at: "2026-10-14T09:20:00.000Z", fingerprint: "0000000000000000" } },
    thread: [
      {
        id: "e1",
        at: "2026-10-14T09:15:00.000Z",
        kind: "ask",
        entry: "project",
        question: "Where does the greeting text come from?",
        text: "It is built in one place.\nWhat should a language without a greeting get?",
        quotes: [{ path: files.greeting, startLine: 1, endLine: 2, from: "base", text: "export function greeting(name: string) {\n  return `Hello, ${name}!`;" }],
        removed: 1,
      },
      { id: "e2", at: "2026-10-14T09:20:00.000Z", kind: "hint", stepId: "s2", rung: 1, text: "Look where the name is put into the text.", refs: [{ path: files.greeting, line: 2 }] },
    ],
    tests: [
      { at: "2026-10-14T09:25:00.000Z", command: "npx vitest run test/greeting.test.ts", changeFingerprint: "0000000000000000", outcome: "failed", exitCode: 1, ms: 1800, prediction: "fail", outputTail: "FAIL test/greeting.test.ts > greets\nexpected 'Hello, Ada!'" },
    ],
    events: [
      { at: "2026-10-14T09:15:00.000Z", kind: "answer", source: "ask" },
      { at: "2026-10-14T09:20:00.000Z", kind: "answer", source: "hint", rung: 1 },
    ],
    removedTotal: 1,
  }),
};

/** Marks the run's current version ready through its route, as "Mark it ready" does, and reads the page again. */
async function markReady(page: Page) {
  const { files: changed } = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
  const ready = await page.request.post(`/api/runs/${runId}/by-hand/ready`, { data: { changeFingerprint: changeFingerprint(changed), review: false } });
  expect(ready.ok()).toBe(true);
  await page.reload();
}

export const stateViews: StateView[] = [
  { name: "check-explain", route: checkRoute, drive: checkExplained, include: ".understanding-check" },
  { name: "check-grade", route: checkRoute, drive: checkLocked, include: ".understanding-check" },
  { name: "check-correct", route: checkRoute, drive: checkGraded, include: ".understanding-check" },
  { name: "check-result", route: checkRoute, drive: checkPassed, include: ".understanding-check" },
  { name: "check-forecast", route: checkRoute, drive: checkForecast, include: ".understanding-check" },
  {
    name: "settings-learning-modal",
    route: "#/settings/learning",
    include: '[role="dialog"]',
    async drive(page, locale) {
      // The dialog only asks; nothing is saved until "Turn it off".
      const s = messages[locale].settings.learning.check;
      await page.getByRole("checkbox", { name: s.label }).click();
      await expect(page.getByRole("dialog", { name: s.confirmTitle })).toBeVisible();
    },
  },
  {
    name: "learning-practice",
    route: "#/learning?view=practice",
    include: ".practice",
    async drive(page) {
      await expect(page.locator("section.practice-sample")).toBeVisible();
    },
  },
  {
    name: "rules-card",
    route: "#/runs/demo-run/overview",
    include: ".rules-card",
    async drive(page) {
      await expect(page.locator(".rules-card figure")).toHaveCount(3);
    },
  },
  {
    name: "draft-checklist",
    route: "#/runs/demo-run/draft",
    include: ".draft-checklist",
    async drive(page) {
      await expect(page.locator(".draft-checklist-row")).toHaveCount(8);
    },
  },
  {
    name: "walkthrough",
    route: "#/runs/demo-run/changes?file=src/client.ts",
    include: ".explain-panel",
    async drive(page, locale) {
      const t = messages[locale].review;
      await page.getByRole("tab", { name: t.panel.tabs.walkthrough }).click();
      const locate = page.locator(".walkthrough-locate").first();
      await locate.click();
      await expect(locate).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".rv-line-highlighted").first()).toBeVisible();
    },
  },
  {
    name: "commit-history",
    route: "#/runs/demo-run/commits",
    include: ".commit-history",
    async drive(page, locale) {
      const t = messages[locale].review.commits;
      const review = page.locator(".commit-item").nth(1);
      await review.getByRole("button", { name: t.show }).click();
      await review.locator(".commit-files .file-item").first().click();
      await expect(review.locator(".rv-line").first()).toBeVisible();
    },
  },
  {
    // A real run whose premise check refuted the request's assumption: the
    // brief's motivation and after card carry the tag, at every width.
    name: "premise-refuted",
    route: `#/runs/${runId}/overview`,
    include: ".mission-contribution",
    real: {
      run: {
        // Short enough for the sidebar's run list at 768 and 1024 px.
        title: "Greet by language",
        team: {
          config: { maxTeammates: 2, requirePlanApproval: true, provider: "codex", protocol: "bell-shared-tasks", messageDelivery: "between-turns" },
          phase: "complete",
          planSummary: "Look greetings up in a table of languages.",
          tasks: [],
          messages: [],
          premise: {
            verdict: "refuted",
            statement: "Greetings are always in English today.",
            evidence: "src/greeting.ts already reads the language from its options.",
          },
        },
      },
    },
    wider: [
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ],
    async drive(page, locale) {
      const t = messages[locale].mission.brief;
      await expect(page.locator(".mission-after .mission-premise-tag")).toHaveText(t.premiseRefuted);
    },
  },
  {
    // Learn by hand: the person's plan, before they confirm it.
    name: "byhand-plan",
    route: `#/runs/${runId}/activity`,
    include: ".by-hand",
    real: {
      run: byHandRun("awaiting_plan", "awaiting_approval", { plan: { steps: [{ id: "s1", title: "Read how the greeting is built", files: [files.greeting] }], savedAt: "2026-10-14T09:05:00.000Z" } }),
    },
    async drive(page, locale) {
      await expect(page.getByRole("region", { name: write[locale].plan.title })).toBeVisible();
      await expect(page.getByRole("button", { name: write[locale].plan.confirm })).toBeEnabled();
    },
  },
  {
    // …the guide's panel while the person writes: its thread and the Tests card.
    name: "byhand-writing",
    route: `#/runs/${runId}/changes`,
    include: ".guide-panel",
    real: writingRun,
    async drive(page, locale) {
      const guide = page.locator(".guide-panel");
      await expect(guide.locator(".by-hand-thread")).toContainText(write[locale].thread.removed);
      await expect(guide.getByRole("region", { name: write[locale].tests.title })).toContainText("npx vitest run test/greeting.test.ts");
    },
  },
  {
    // …the Ready for review dialog.
    name: "byhand-ready",
    route: `#/runs/${runId}/changes`,
    include: '[role="dialog"]',
    real: writingRun,
    async drive(page, locale) {
      await page.locator(".review-footer").getByRole("button", { name: messages[locale].workspace.byHand.ready }).click();
      await expect(page.getByRole("dialog", { name: write[locale].ready.title })).toBeVisible();
    },
  },
  {
    // …and the publish dialog with the run record, on a clean run marked ready and approved.
    name: "byhand-publish-record",
    route: `#/runs/${runId}/draft`,
    include: '[role="dialog"]',
    real: {
      reviewed: true,
      appSettings: { skipUnderstandingCheck: true },
      run: byHandRun(
        "review",
        "complete",
        {
          plan: { steps, savedAt: "2026-10-14T09:05:00.000Z", confirmedAt: "2026-10-14T09:05:00.000Z" },
          events: [
            { at: "2026-10-14T09:15:00.000Z", kind: "explain", source: "premise" },
            { at: "2026-10-14T09:20:00.000Z", kind: "answer", source: "hint", rung: 1 },
          ],
          tests: [{ at: "2026-10-14T09:25:00.000Z", command: "npm test", changeFingerprint: "0000000000000000", outcome: "passed", ms: 900, prediction: "pass" }],
          removedTotal: 1,
        },
        { draft: { title: "Greet people in their own language", body: "Greetings come from a table of languages, with English when a language has none. I wrote and tested it myself." } },
      ),
    },
    async drive(page, locale) {
      await markReady(page);
      const t = messages[locale].workspace;
      await page.locator(".review-footer").getByRole("button", { name: t.footer.approvePr }).click();
      const dialog = page.getByRole("dialog", { name: t.publish.title });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await expect(dialog.getByText(t.publish.factsLoading)).toHaveCount(0, { timeout: 30_000 });
      await expect(dialog.getByRole("region", { name: runRecord[locale].title })).toContainText(runRecord[locale].claim);
    },
  },
  {
    // A real run, ticked and approved with the check off, under facts that
    // fill most groups: a door GitHub did not answer, the project's rule
    // about explaining a change, someone else's pull request on the issue
    // (with its reason field) and the person's pace at the budget.
    name: "publish-groups",
    route: `#/runs/${runId}/draft`,
    include: '[role="dialog"]',
    real: {
      reviewed: true,
      appSettings: { skipUnderstandingCheck: true },
      facts: {
        ...welcomeFacts,
        issues: { 7: issueNode(otherPr) },
        pacing: { open: 1, merged: 0 },
        fail: { door: "exit", doorGraph: "exit" },
      },
    },
    async drive(page, locale) {
      const t = messages[locale].workspace;
      await page.locator(".review-footer").getByRole("button", { name: t.footer.approvePr }).click();
      const dialog = page.getByRole("dialog", { name: t.publish.title });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(t.publish.factsLoading)).toHaveCount(0);
      for (const group of ["unknown", "rules", "issue", "pacing"] as const)
        await expect(dialog.getByRole("group", { name: t.publish.groups[group] })).toBeVisible();
      await expect(dialog.locator(".publish-block").getByRole("textbox")).toBeVisible();
    },
  },
];
