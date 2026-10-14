// The sample project in the routed workspace (#/runs/demo-run/:tab?file=):
// reading and reviewing the changes up to its sample Draft PR, its learning
// record, and deep links into its tabs and files.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { getDemo } from "../src/demo";
import common from "../src/i18n/en/common";
import review from "../src/i18n/en/review";
import workspace from "../src/i18n/en/workspace";
import { runTabs, type RunTab } from "../src/navigation/route";
import { expectNoOverflow } from "./helpers/overflow";

const demo = getDemo("en");
const tab = (page: Page, name: RunTab) => page.locator(`#workspace-tab-${name}`);
const selectedFile = (page: Page) => page.locator(".file-item.selected");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function expectTab(page: Page, name: RunTab) {
  await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
}

test("the sample goes from reviewing every file to its published sample PR", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/runs"))
      writes.push(request.url());
  });
  await page.goto("/#/runs/demo-run/overview");
  await expectTab(page, "overview");
  await expect(page.locator(".workspace-heading h1")).toHaveText(demo.run.title);

  await tab(page, "changes").click();
  await expectTab(page, "changes");
  await expect(page).toHaveURL(/#\/runs\/demo-run\/changes$/);
  for (const file of demo.files) {
    await page.locator(`.file-item[title="${file.path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`\\?file=${escape(file.path)}$`));
    await expect(selectedFile(page)).toHaveAttribute("title", file.path);
    const reviewed = page.getByRole("checkbox", { name: review.diff.reviewed });
    await reviewed.check();
    await expect(reviewed).toBeChecked();
  }
  await expect(page.locator(".file-item .file-reviewed")).toHaveCount(demo.files.length);

  await tab(page, "draft").click();
  await expectTab(page, "draft");
  const approve = page.getByRole("button", { name: workspace.footer.approvePr });
  await approve.click();
  const dialog = page.getByRole("dialog", { name: workspace.publish.titleDemo });
  await expect(dialog).toBeVisible();
  // The demo previews the description and opens its PR without any check.
  await expect(dialog.locator(".publish-body-preview")).toBeVisible();
  await expect(dialog.locator(".readiness-notice")).toHaveCount(0);
  await dialog.getByRole("button", { name: workspace.publish.finishDemo }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".sample-published")).toContainText(demo.publishedCard!.title);
  await expect(page.locator(".workspace-heading .status-badge")).toHaveText(common.runStatus.published);
  await expect(approve).toBeDisabled();
  // As on a real PR, the opened sample takes no more review marks.
  await tab(page, "changes").click();
  const reviewed = page.getByRole("checkbox", { name: review.diff.reviewed });
  await expect(reviewed).toBeChecked();
  await reviewed.click();
  await expect(reviewed).toBeChecked();
  await expect(page.locator(".workspace-heading .status-badge")).toHaveText(common.runStatus.published);
  await tab(page, "draft").click();
  // The sample PR links nowhere, and its feedback is a labelled sample.
  await expect(page.locator('a[href^="#demo-pr"]')).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(workspace.feedback.fetch) }).click();
  await expect(page.locator(".pr-feedback")).toContainText(demo.prFeedback!.warnings![0]);
  expect(writes).toEqual([]);

  // A reload keeps the opened sample PR.
  await page.reload();
  await expectTab(page, "draft");
  await expect(page.locator(".sample-published")).toContainText(demo.publishedCard!.title);
});

test("the sample's learning record is built in the browser", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/export.md")) requests.push(request.url());
  });
  await page.goto("/#/runs/demo-run/overview?locale=en");
  const button = page.getByRole("button", {
    name: new RegExp(workspace.exportLearning.replace(/[()]/g, "\\$&")),
  });
  await expect(button.locator(".pro-badge")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe("bell-learning-demo-run.md");
  const text = await readFile(await download.path(), "utf8");
  expect(text.startsWith(`# Learning record: ${demo.run.title}\n`)).toBe(true);
  expect(text).toContain(demo.files[0].explanation!.summary);
  expect(requests).toEqual([]);
});

test("a deep link opens the file, a reload keeps it and Back returns to the tab before", async ({ page }) => {
  const file = demo.files[1].path;
  await page.goto("/#/runs/demo-run/overview");
  await expectTab(page, "overview");

  await page.goto(`/#/runs/demo-run/changes?file=${file}`);
  await expectTab(page, "changes");
  await expect(selectedFile(page)).toHaveAttribute("title", file);
  await expect(page.locator(".diff-panel")).toContainText(file.split("/").pop()!);

  await page.reload();
  await expectTab(page, "changes");
  await expect(selectedFile(page)).toHaveAttribute("title", file);

  await tab(page, "draft").click();
  await expectTab(page, "draft");
  await expect(page).toHaveURL(new RegExp(`#/runs/demo-run/draft\\?file=${escape(file)}$`));

  await page.goBack();
  await expectTab(page, "changes");
  await expect(selectedFile(page)).toHaveAttribute("title", file);
  await page.goBack();
  await expectTab(page, "overview");
  await page.goForward();
  await expectTab(page, "changes");
  await expect(selectedFile(page)).toHaveAttribute("title", file);
});

test("a file the run does not have selects its first file", async ({ page }) => {
  await page.goto("/#/runs/demo-run/changes?file=no/such/file.ts");
  await expectTab(page, "changes");
  await expect(selectedFile(page)).toHaveAttribute("title", demo.files[0].path);
});

test("presentation flags stay in the address while the reader moves around", async ({ page }) => {
  await page.goto("/#/runs/demo-run/overview?present=1&locale=en");
  await expectTab(page, "overview");
  await tab(page, "changes").click();
  await expect(page).toHaveURL(/#\/runs\/demo-run\/changes\?present=1&locale=en$/);
  await page.locator(`.file-item[title="${demo.files[2].path}"]`).click();
  await expect(page).toHaveURL(
    new RegExp(`#/runs/demo-run/changes\\?file=${escape(demo.files[2].path)}&present=1&locale=en$`),
  );
});

for (const width of [1440, 390])
  test(`every tab's English text fits at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const name of runTabs) {
      await page.goto(`/#/runs/demo-run/${name}?locale=en`);
      await expectTab(page, name);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await expectNoOverflow(page);
    }
  });
