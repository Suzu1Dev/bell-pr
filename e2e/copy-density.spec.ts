import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import enMission from "../src/i18n/en/mission";
import zhMission from "../src/i18n/zh-TW/mission";
import enModals from "../src/i18n/en/modals";
import zhModals from "../src/i18n/zh-TW/modals";
import enWorkspace from "../src/i18n/en/workspace";
import zhWorkspace from "../src/i18n/zh-TW/workspace";
import enSettings from "../src/i18n/en/settings";
import zhSettings from "../src/i18n/zh-TW/settings";
import { expectNoOverflow } from "./helpers/overflow";

for (const locale of ["en", "zh-TW"] as const) {
  const mission = locale === "en" ? enMission : zhMission;
  const modals = locale === "en" ? enModals : zhModals;
  const workspace = locale === "en" ? enWorkspace : zhWorkspace;
  const settings = locale === "en" ? enSettings : zhSettings;
  for (const width of [1440, 390]) {
    test(`task goals and publishing blockers stay accessible (${locale}, ${width})`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.route("**/api/models?**", (route) => route.fulfill({ json: { provider: "codex", models: [] } }));
      await page.goto(`/#/runs/demo-run/overview?locale=${locale}`);
      const context = page.locator("details.mission-context");
      await expect(context).not.toHaveAttribute("open", "");
      await expect(page.getByRole("button", { name: mission.nextStep.codeAction })).toBeVisible();
      await context.locator(":scope > summary").click();
      await expect(page.locator("#mission-purpose-title")).toBeVisible();
      await context.locator(":scope > summary").click();
      await page.getByRole("button", { name: modals.runs.newContribution, exact: true }).last().click();
      const dialog = page.getByRole("dialog", { name: modals.newTask.title });
      const goal = dialog.locator("#task-prompt");
      await goal.fill("Explain and test retries after a temporary connection failure.");
      const execution = dialog.locator(".mission-form-details").last();
      await expect(execution).not.toHaveAttribute("open", "");
      await expect(dialog.getByLabel(mission.settings.acceptance.label, { exact: false })).toBeVisible();
      await execution.locator(":scope > summary").click();
      await expect(dialog.locator('select[id$="-agent-access"]')).toBeVisible();
      await expect(goal).toHaveValue("Explain and test retries after a temporary connection failure.");
      await dialog.getByRole("button", { name: modals.close, exact: true }).click();

      await page.goto(`/#/runs/demo-run/draft?locale=${locale}`);
      const checklist = page.locator(".draft-checklist");
      await expect(checklist).toBeVisible();
      await page.getByRole("button", { name: workspace.checklist.open }).click();
      await expect(checklist).toBeFocused();
      await expect(checklist.getByRole("button", { name: workspace.checklist.reviewAction })).toBeVisible();
      await expect(checklist.locator('[data-row="words"]')).toBeVisible();
      const completed = checklist.locator(".draft-completed-checks");
      await expect(completed).not.toHaveAttribute("open", "");
      await expect(completed.locator('[data-row="door"]')).toBeHidden();
      await completed.locator(":scope > summary").click();
      await expect(completed.locator('[data-row="door"]')).toBeVisible();
      await completed.locator(":scope > summary").click();
      await expectNoOverflow(page);
      await page.waitForTimeout(300);
      const audit = await new AxeBuilder({ page }).include(".draft-workspace").analyze();
      expect(audit.violations.filter((item) => item.impact === "serious" || item.impact === "critical")).toEqual([]);
      await checklist.getByRole("button", { name: workspace.checklist.understandingAction }).click();
      await expect(page.locator(".understanding-check")).toBeVisible();

      await page.goto(`/#/settings/safety?locale=${locale}`);
      await expect(page.getByText(settings.safety.web.exception, { exact: true })).toBeVisible();
      await expectNoOverflow(page);
    });
  }
}
