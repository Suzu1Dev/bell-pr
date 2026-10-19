// The review surface from the keyboard and for screen readers: the diff is
// one tab stop with arrow-key line navigation and selection, the
// explanation panel's tabs use arrow keys, AI output is labelled, and axe
// finds no serious or critical issue on the changes tab in any state.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { locales, type Locale } from "../shared/i18n/locale";
import { getDemo } from "../src/demo";
import en from "../src/i18n/en";
import { isCodeLine, parseDiff } from "../src/review/diff";
import zhTW from "../src/i18n/zh-TW";
import { expectNoOverflow } from "./helpers/overflow";

const messages = { en, "zh-TW": zhTW } as const;
const review = en.review;
const demo = getDemo("en");

/** The sample run's changes tab in `locale`, with the explanation panel loaded. */
async function openChanges(page: Page, locale: Locale = "en", file?: string) {
  const query = [file && `file=${file}`, `locale=${locale}`].filter(Boolean).join("&");
  await page.goto(`/#/runs/demo-run/changes?${query}`);
  await expect(page.locator("#workspace-tab-changes")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".explain-panel")).toBeVisible();
  await expect(page.locator(".rv-diff [role=option]").first()).toBeVisible();
}

/** Where keyboard focus is: which part of the changes tab, and its name. */
function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return { part: "none", role: "", name: "" };
    const part = element.closest(".explain-panel")
      ? "panel"
      : element.closest(".rv-diff")
        ? "diff"
        : element.closest(".file-panel")
          ? "files"
          : element.closest(".diff-toolbar-actions")
            ? "toolbar"
            : "other";
    return {
      part,
      role: element.getAttribute("role") ?? element.tagName.toLowerCase(),
      name: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 60),
    };
  });
}

const lines = (page: Page) => page.locator(".rv-diff [role=listbox] [role=option]");
const selectedLines = (page: Page) =>
  page.locator('.rv-diff [role=listbox] [role=option][aria-selected="true"]');

/** Focuses the diff's lines the way a keyboard user does: Tab from the Reviewed checkbox. */
async function tabIntoLines(page: Page) {
  await page.getByRole("checkbox", { name: review.diff.reviewed }).focus();
  await page.keyboard.press("Tab");
  await expect.poll(async () => (await focused(page)).role).toBe("option");
}

test("the diff is one tab stop however many lines it has", async ({ page }) => {
  await openChanges(page);
  expect(await lines(page).count()).toBeGreaterThan(20);
  await expect(page.locator('.rv-diff [role=listbox] [tabindex="0"]')).toHaveCount(1);
  await tabIntoLines(page);
  expect(await focused(page)).toMatchObject({ part: "diff", role: "option" });
  await expect(lines(page).first()).toBeFocused();
  // The next Tab leaves the code, wherever it is in the list.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  expect((await focused(page)).part).not.toBe("diff");
  // Coming back lands on the line the reader left, not the first one.
  await page.keyboard.press("Shift+Tab");
  await expect(lines(page).nth(2)).toBeFocused();
  await expect(lines(page).nth(2)).toHaveAttribute("tabindex", "0");
  await expect(page.locator('.rv-diff [role=listbox] [tabindex="0"]')).toHaveCount(1);
});

test("the explanation panel is reached in 5 or fewer Tab presses from the file list", async ({ page }) => {
  await openChanges(page);
  await page.locator(".file-panel .file-item").last().focus();
  const stops: { part: string; role: string; name: string }[] = [];
  while (stops.length < 40) {
    await page.keyboard.press("Tab");
    const stop = await focused(page);
    stops.push(stop);
    if (stop.part === "panel") break;
  }
  const route = stops.map((stop) => `${stop.part}:${stop.role}:${stop.name}`).join("\n");
  expect(stops.at(-1)?.part, route).toBe("panel");
  // The panel opens on its selected tab, the explanation.
  expect(stops.at(-1), route).toMatchObject({ role: "tab", name: review.panel.tabs.explain });
  // The diff (5C) costs two stops however long it is: the Reviewed
  // checkbox and the list of lines.
  expect(stops.filter((stop) => stop.part === "diff").length, route).toBe(2);
  // The diff toolbar between the file list and the diff is one tab stop: a
  // role="toolbar" with a roving tabindex, whose arrow keys move inside it.
  expect(stops.filter((stop) => stop.part === "toolbar").length, route).toBe(1);
  expect(stops.length, route).toBeLessThanOrEqual(5);
});

test("Shift+ArrowDown selects lines and Enter brings up the ask bar", async ({ page }) => {
  await openChanges(page);
  await tabIntoLines(page);
  await page.keyboard.press("ArrowDown");
  await expect(lines(page).nth(1)).toBeFocused();
  await expect(selectedLines(page)).toHaveCount(0);

  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(lines(page).nth(3)).toBeFocused();
  await expect(selectedLines(page)).toHaveCount(3);
  for (const index of [1, 2, 3])
    await expect(lines(page).nth(index)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".rv-diff [role=status]")).toHaveText(
    review.diff.selectedLines({ count: 3 }),
  );
  // Shift+ArrowUp shrinks the selection back toward where it started.
  await page.keyboard.press("Shift+ArrowUp");
  await expect(selectedLines(page)).toHaveCount(2);

  const ask = page.getByRole("button", { name: review.diff.askSelection });
  await page.keyboard.press("Enter");
  await expect(ask).toBeVisible();
  await expect(ask).toBeFocused();
  await expect(page.locator(".rv-diff-footer")).toContainText(
    review.diff.selectedLines({ count: 2 }),
  );

  // Escape on the lines clears the selection and the ask bar with it.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(lines(page).nth(2)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(selectedLines(page)).toHaveCount(0);
  await expect(ask).toHaveCount(0);

  // Enter on a line without a selection selects it; Enter again asks.
  await page.keyboard.press("End");
  await expect(lines(page).last()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(selectedLines(page)).toHaveCount(1);
  await expect(lines(page).last()).toHaveAttribute("aria-selected", "true");
  await expect(ask).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: review.panel.tabs.chat })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".explain-message-user")).toHaveCount(1);
  // The sample answers are prewritten, and say so.
  await expect(page.locator(".explain-message-assistant").first()).toContainText(
    review.provenance.sample,
  );

  // Home goes back to the first line.
  await lines(page).last().focus();
  await page.keyboard.press("Home");
  await expect(lines(page).first()).toBeFocused();
});

test("a click on either side of the split view leaves the keys working from that line", async ({ page }) => {
  await openChanges(page);
  await page.locator(".view-toggle button").nth(1).click();
  await expect(page.locator(".rv-diff-split [role=listbox]")).toBeVisible();
  // The old side's copy of an unchanged line is for the mouse only; a click
  // on it focuses the line's entry in the list.
  const copies = page.locator('.rv-split-row > .rv-line-context[aria-hidden="true"]');
  await copies.nth(1).click();
  await expect(lines(page).nth(1)).toBeFocused();
  await expect(lines(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(lines(page).nth(2)).toBeFocused();
  await expect(selectedLines(page)).toHaveCount(2);
  // A click on a line in the list itself does the same.
  await lines(page).nth(4).click();
  await expect(lines(page).nth(4)).toBeFocused();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(lines(page).nth(3)).toBeFocused();
  await expect(selectedLines(page)).toHaveCount(2);
  await expect(page.locator('.rv-diff [role=listbox] [tabindex="0"]')).toHaveCount(1);
});

test("the explanation panel's four tabs share one row at desktop widths, in both languages", async ({ page }) => {
  for (const locale of locales)
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      // As the screenshots show it: presentation mode, where the panel is narrowest.
      await page.goto(`/#/runs/demo-run/changes?present=1&capture=1&locale=${locale}`);
      await expect(page.locator(".explain-tabs [role=tab]")).toHaveCount(4);
      await page.evaluate(() => document.fonts.ready);
      const tops = await page
        .locator(".explain-tabs [role=tab]")
        .evaluateAll((tabs) => tabs.map((tab) => Math.round(tab.getBoundingClientRect().top)));
      expect(new Set(tops).size, `${locale} at ${width} px: ${tops.join(", ")}`).toBe(1);
    }
});

test("the explanation panel's tabs move with the arrow keys and keep one tab stop", async ({ page }) => {
  await openChanges(page);
  const tab = (name: keyof typeof review.panel.tabs) =>
    page.getByRole("tab", { name: review.panel.tabs[name] });
  await expect(page.locator('.explain-tabs [role=tab][tabindex="0"]')).toHaveCount(1);
  await tab("explain").focus();
  // The code walkthrough follows the explanation, then the reviews.
  await page.keyboard.press("ArrowRight");
  await expect(tab("walkthrough")).toBeFocused();
  await expect(tab("walkthrough")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tab("reports")).toBeFocused();
  await expect(tab("reports")).toHaveAttribute("aria-selected", "true");
  await expect(tab("reports")).toHaveAttribute("tabindex", "0");
  await expect(tab("explain")).toHaveAttribute("tabindex", "-1");
  await expect(page.locator(".explain-content .explain-provenance")).toHaveText(
    review.provenance.sample,
  );
  await page.keyboard.press("End");
  await expect(tab("chat")).toBeFocused();
  await expect(tab("chat")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tab("explain")).toBeFocused();
  await expect(tab("explain")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(tab("chat")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tab("explain")).toHaveAttribute("aria-selected", "true");
  // Tab goes from the selected tab into the panel, which can be scrolled.
  await page.keyboard.press("Tab");
  await expect(page.locator(".explain-content")).toBeFocused();
  await expect(page.locator(".explain-content .explain-provenance")).toHaveText(
    review.provenance.sample,
  );
});

/** Serious and critical axe issues inside the changes tab, one line each. */
async function axeProblems(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Let transitions (focus rings, selection colors) settle before colors are read.
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page })
    .include("#workspace-panel")
    .options({ rules: { "color-contrast": { enabled: true } } })
    .analyze();
  // The contrast rule really ran on this state.
  expect(
    [...results.passes, ...results.violations, ...results.incomplete].some(
      (rule) => rule.id === "color-contrast",
    ),
  ).toBe(true);
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) =>
      violation.nodes.map(
        (node) => `${violation.id} (${violation.impact}) at ${node.target.join(" ")}: ${node.html}`,
      ),
    );
}

for (const locale of locales)
  test(`a question about selected lines shows them as a highlighted diff block (${locale})`, async ({ page }) => {
    const t = messages[locale].review;
    const file = getDemo(locale).files.find((entry) => entry.path === "src/utils/retry.ts")!;
    await openChanges(page, locale, file.path);
    // "): Promise<T> {", the removed line and the first two added lines.
    await lines(page).nth(8).click();
    await lines(page).nth(11).click({ modifiers: ["Shift"] });
    await expect(selectedLines(page)).toHaveCount(4);
    await page.getByRole("button", { name: t.diff.askSelection }).click();

    const bubble = page.locator(".explain-message-user").last();
    await expect(bubble.locator(".markdown-content > p").first()).toHaveText(
      t.selection.question({ path: file.path, count: 4 }),
    );
    const code = bubble.locator("pre > code.language-diff");
    await expect(code).toBeVisible();
    // Each line keeps its prefix and its own indentation.
    const expected = parseDiff(file.patch)
      .filter(isCodeLine)
      .slice(8, 12)
      .map((line) => `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${line.text}`)
      .join("\n");
    expect(await code.textContent()).toBe(expected);
    await expect(code.locator(".markdown-diff-removed")).toHaveCount(1);
    await expect(code.locator(".markdown-diff-added")).toHaveCount(2);
    // The sample answers it, as before.
    await expect(page.locator(".explain-message-assistant").last()).toBeVisible();
    await expectNoOverflow(page, [".explain-panel"]);
  });

for (const locale of locales)
  test(`axe finds no serious or critical issue on the changes tab in any review state (${locale})`, async ({ page }) => {
    const t = messages[locale].review;
    await openChanges(page, locale);
    expect(await axeProblems(page), "unified view").toEqual([]);

    // Lines selected from the keyboard, with the ask bar focused.
    await page.getByRole("checkbox", { name: t.diff.reviewed }).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: t.diff.askSelection })).toBeFocused();
    expect(await axeProblems(page), "selection").toEqual([]);

    // Split view.
    await page.locator(".view-toggle button").nth(1).click();
    await expect(page.locator(".rv-diff-split [role=listbox]")).toBeVisible();
    expect(await axeProblems(page), "split view").toEqual([]);

    // The reviews tab, then a question and its answer in the chat.
    await page.getByRole("tab", { name: t.panel.tabs.reports }).click();
    expect(await axeProblems(page), "reviews tab").toEqual([]);
    await page.getByRole("button", { name: t.diff.askSelection }).click();
    await expect(page.locator(".explain-message-assistant").first()).toBeVisible();
    expect(await axeProblems(page), "chat tab").toEqual([]);
  });

/** The box-shadow of the chip around a radio: the focus ring when the radio has keyboard focus. */
const chipRing = (radio: Locator) =>
  radio.evaluate((input) => getComputedStyle(input.closest(".tf-chip")!).boxShadow);

for (const locale of locales)
  test(`the try-first cards work from the keyboard, and axe finds no serious or critical issue in any of their states (${locale})`, async ({ page }) => {
    const t = messages[locale].review.tryFirst;
    const sample = getDemo(locale);
    const path = "src/utils/retry.ts";
    await openChanges(page, locale, path);
    const quiz = page.locator(".explain-card-selfcheck");
    const road = page.locator(".explain-card-alternatives");
    expect(await axeProblems(page), "unanswered").toEqual([]);

    // Answer, then Tab into the confidence chips: arrows choose, the chip shows the focus.
    await quiz.getByRole("textbox", { name: t.quiz.answerLabel }).fill(sample.quizSamples![path].answer);
    await page.keyboard.press("Tab");
    const sure = quiz.getByRole("radio", { name: t.confidences.sure });
    await expect(sure).toBeFocused();
    expect(await chipRing(sure)).not.toBe("none");
    await page.keyboard.press("ArrowRight");
    const think = quiz.getByRole("radio", { name: t.confidences.think });
    await expect(think).toBeFocused();
    await expect(think).toBeChecked();
    expect(await chipRing(think)).not.toBe("none");
    expect(await chipRing(sure)).toBe("none");
    expect(await axeProblems(page), "answered").toEqual([]);

    // Show answer from the keyboard; focus lands on the grade group.
    await page.keyboard.press("Tab");
    await expect(quiz.getByRole("button", { name: t.quiz.reveal })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(quiz.getByRole("group", { name: t.quiz.gradeLabel })).toBeFocused();
    await expect(quiz.locator('.tf-reference[aria-live="polite"]')).toContainText(t.quiz.referenceLabelDemo);
    expect(await axeProblems(page), "revealed").toEqual([]);
    await page.keyboard.press("Tab");
    await expect(quiz.getByRole("button", { name: t.grades.got })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(quiz.locator(".tf-graded p").first()).toBeFocused();
    await expect(quiz.locator(".tf-graded")).toHaveText(t.quiz.graded.got);
    expect(await axeProblems(page), "graded").toEqual([]);

    // The road choice: a guess, the reveal, then a choice from the keyboard.
    await road.getByRole("textbox", { name: t.road.guessLabel }).fill(sample.roadSamples![path].guess);
    await page.keyboard.press("Tab");
    await expect(road.getByRole("button", { name: t.road.reveal })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(road.getByRole("radiogroup", { name: t.road.choiceLabel })).toBeFocused();
    expect(await axeProblems(page), "alternative revealed").toEqual([]);
    await page.keyboard.press("Tab");
    const keep = road.getByRole("radio", { name: t.road.choices.keep });
    await expect(keep).toBeFocused();
    await page.keyboard.press("Space");
    await expect(keep).toBeChecked();
    expect(await chipRing(keep)).not.toBe("none");
    await road.getByRole("textbox", { name: t.road.whyLabel }).fill(sample.roadSamples![path].why);
    await road.getByRole("button", { name: t.road.saveWhy, exact: true }).click();
    expect(await axeProblems(page), "road chosen").toEqual([]);
  });

test("a chosen try-first chip keeps an outline when forced colors drop its fill", async ({ page }) => {
  const t = review.tryFirst;
  await page.emulateMedia({ forcedColors: "active" });
  await openChanges(page, "en", "src/utils/retry.ts");
  const quiz = page.locator(".explain-card-selfcheck");
  const outline = (radio: Locator) =>
    radio.evaluate((input) => getComputedStyle(input.closest(".tf-chip")!).outlineStyle);
  const think = quiz.getByRole("radio", { name: t.confidences.think });
  expect(await outline(think)).toBe("none");
  await think.check();
  expect(await outline(think)).toBe("solid");
  expect(await outline(quiz.getByRole("radio", { name: t.confidences.sure }))).toBe("none");
});

for (const locale of locales)
  for (const width of [1440, 390])
    test(`the diff and the explanation panel fit their text (${locale}, ${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // The file the sample's module line describes.
      await openChanges(page, locale, demo.files[0].path);
      await expect(page.locator(".explain-module")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await expectNoOverflow(page, [".rv-diff", ".explain-panel"]);
    });
