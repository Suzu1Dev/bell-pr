// The practice deck on the learning page (#/learning?view=practice): the
// sample's items while the person has nothing scheduled, one at a time,
// asked first, then revealed and graded, with the next review date. The
// person's own items are graded through POST /api/runs/:id/practice, which
// carries the grade and the confidence only. GET /api/learning/practice is
// stubbed, so the deck reads the same before and after the learning-loop
// routes exist.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { htmlLang, locales } from "../shared/i18n/locale";
import type { PracticeItem } from "../shared/practice";
import { getDemo } from "../src/demo";
import learning from "../src/i18n/en/learning";
import { assertNoHan } from "../src/test-utils/render";
import { expectNoOverflow } from "./helpers/overflow";

const sample = getDemo("en").practiceSample!;
const p = learning.practice;

/** Serious and critical axe issues on the page, color contrast included. */
async function axeProblems(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .options({ rules: { "color-contrast": { enabled: true } } })
    .analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) => violation.nodes.map((node) => `${violation.id} at ${node.target.join(" ")}`));
}

/** GET /api/learning/practice answers `body` (the sidebar's count reads it too). */
async function stubDeck(page: Page, body: () => unknown) {
  await page.route("**/api/learning/practice", (route) => route.fulfill({ json: body() }));
}

test("the practice view shows a sample item to answer and grade, in English, and it fits", async ({ page }) => {
  await stubDeck(page, () => ({ items: [] }));
  await page.goto("/#/learning?view=practice&locale=en");
  await expect(page.locator('.learning-views a[aria-current="page"]')).toHaveText(learning.views.practice);
  await expect(page.locator(".practice-empty-title")).toHaveText(p.empty);
  const deck = page.locator("section.practice-sample");
  await expect(deck.getByRole("heading", { level: 2, name: p.sampleTitle })).toBeVisible();
  const [first, second] = sample;
  await expect(deck.getByRole("heading", { level: 3, name: first.question })).toBeVisible();
  await expect(deck.getByRole("heading", { level: 3, name: second.question })).toHaveCount(0);

  await deck.getByLabel(p.answer).fill("The wait grows with each attempt, up to the cap.");
  // The reveal waits for how sure the person is.
  const show = deck.getByRole("button", { name: p.show });
  await show.click();
  await expect(deck.getByRole("alert")).toHaveText(p.chooseConfidence);
  await expect(deck.getByRole("radio", { name: p.confidences.sure })).toBeFocused();
  await deck.getByRole("radio", { name: p.confidences.think }).check();
  await show.click();
  await expect(deck.locator(".practice-reveal")).toBeFocused();
  await expect(deck.locator(".practice-reference")).toContainText(first.reference!);
  await expect(deck.getByText(p.aiWritten)).toBeVisible();
  if (first.earlier) await expect(deck.locator(".learning-own-note")).toContainText(first.earlier);
  await expect(deck.getByRole("button", { name: p.study })).toBeVisible();
  await expect(deck.getByLabel(p.answer)).not.toBeEditable();

  await deck.getByRole("button", { name: new RegExp(`^${p.grades.got}`) }).click();
  await expect(deck.locator(".practice-next")).toHaveText(p.nextReview({ days: 3 }));
  await expect(deck.getByRole("button", { name: p.next })).toBeFocused();

  assertNoHan(await page.locator("#main-content").innerText());
  await expectNoOverflow(page, [".practice"]);
  expect(await axeProblems(page)).toEqual([]);

  // The next item takes the focus to its question.
  await deck.getByRole("button", { name: p.next }).click();
  await expect(deck.getByRole("heading", { level: 3, name: second.question })).toBeFocused();
});

for (const locale of locales)
  test(`the practice view fits a phone screen (${locale})`, async ({ page }) => {
    await stubDeck(page, () => ({ items: [] }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/learning?view=practice&locale=${locale}`);
    await expect(page.locator("html")).toHaveAttribute("lang", htmlLang(locale));
    const deck = page.locator("section.practice-sample");
    await deck.getByRole("radio").first().check();
    await deck.locator(".practice-actions button").click();
    await expect(deck.locator(".practice-grade")).toHaveCount(3);
    await expectNoOverflow(page, [".practice"]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await axeProblems(page)).toEqual([]);
  });

test("an item of your own is graded on its run, with no answer sent, and the deck says when it is next due", async ({ page }) => {
  const item: PracticeItem = {
    key: "check:selfCheck:src/cache.ts",
    runId: "e2e-practice-run",
    repoId: "e2e-practice-repo",
    kind: "check",
    question: "What does the cache drop after a write, and why?",
    reference: "The entry for the written key, so the next read cannot see stale data.",
    earlier: "I thought the whole cache was cleared.",
    path: "src/cache.ts",
    dimension: "risk",
    dueAt: "2026-10-01T00:00:00.000Z",
    lastGrade: "missed",
    lastConfidence: "sure",
    codeAvailable: false,
  };
  const dueAt = new Date(Date.now() + 86_400_000).toISOString();
  let graded = false;
  await stubDeck(page, () => (graded ? { items: [], nextDueAt: dueAt } : { items: [item] }));
  const posts: unknown[] = [];
  await page.route(`**/api/runs/${item.runId}/practice`, async (route) => {
    posts.push(route.request().postDataJSON());
    graded = true;
    await route.fulfill({
      json: { run: { id: item.runId, practice: { [item.key]: { box: 0, dueAt, lastGrade: "missed" } } } },
    });
  });
  await page.goto("/#/learning?view=practice&locale=en");
  const card = page.locator(".practice > .practice-card");
  await expect(card.getByRole("heading", { level: 3, name: item.question })).toBeVisible();
  await expect(card.locator(".practice-dimension")).toHaveText(learning.dimensions.risk);
  // The sample stays away while the person has items of their own.
  await expect(page.locator("section.practice-sample")).toHaveCount(0);

  await card.getByLabel(p.answer).fill("A private answer that stays on the page.");
  await card.getByRole("radio", { name: p.confidences.sure }).check();
  await card.getByRole("button", { name: p.show }).click();
  await expect(card.locator(".learning-own-note")).toContainText(item.earlier!);
  await expect(card).toContainText(p.cleanedUp);
  await expect(card.getByRole("button", { name: p.study })).toHaveCount(0);
  await card.getByRole("button", { name: new RegExp(`^${p.grades.missed}`) }).click();
  await expect(card.locator(".practice-next")).toHaveText(p.nextReview({ days: 1 }));
  expect(posts).toEqual([{ key: item.key, confidence: "sure", grade: "missed" }]);

  // Done reads the deck again: nothing is due, and it says when the next is.
  await card.getByRole("button", { name: p.finish }).click();
  await expect(page.locator(".practice-empty-title")).toHaveText(p.empty);
  await expect(page.locator(".practice-empty")).toContainText(p.nextReview({ days: 1 }));
  await expect(page.locator("section.practice-sample")).toHaveCount(0);
});
