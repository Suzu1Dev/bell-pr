// Shared steps for the e2e specs.
import { expect, type Page } from "@playwright/test";
import { htmlLang, type Locale } from "../shared/i18n/locale";
import type { Plan } from "../shared/plans";
import { localeStorageKey } from "../src/i18n";

/** The language switcher: a select offering both UI languages. */
const switcher = 'select:has(option[value="en"]):has(option[value="zh-TW"])';

/**
 * Switches the UI language the way a person does, through the language
 * switcher (which remembers the choice), and waits for `<html lang>`. When
 * the page shows no switcher, it saves the choice and reloads instead.
 */
export async function switchLocale(page: Page, locale: Locale) {
  const select = page.locator(switcher).first();
  const shown = await select
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true, () => false);
  if (shown) await select.selectOption(locale);
  else {
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [localeStorageKey, locale],
    );
    await page.reload();
  }
  await expect(page.locator("html")).toHaveAttribute("lang", htmlLang(locale));
}

/** The plan in a GET /api/license body, at the top or one level down. */
function planOf(body: unknown): Plan | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.plan === "string") return record.plan as Plan;
  for (const value of Object.values(record)) {
    const nested = value as Record<string, unknown> | null;
    if (nested && typeof nested === "object" && typeof nested.plan === "string")
      return nested.plan as Plan;
  }
  return undefined;
}

async function readPlan(page: Page): Promise<Plan> {
  const response = await page.request.get("/api/license");
  if (response.status() === 404)
    throw new Error(
      "setPlan: this server has no /api/license route, so its plan cannot be read or changed.",
    );
  if (!response.ok())
    throw new Error(`setPlan: GET /api/license answered ${response.status()}.`);
  const plan = planOf(await response.json());
  if (!plan) throw new Error("setPlan: GET /api/license named no plan.");
  return plan;
}

/**
 * Puts the server of `page`'s context on Free or on the 14-day trial
 * (started through POST /api/license/trial), then reloads the app so it
 * shows the plan. A data dir's trial can be used once and Free cannot come
 * back after it, so a spec that needs Free after a trial starts its own
 * server with launchServer().
 */
export async function setPlan(page: Page, plan: "free" | "trial") {
  const current = await readPlan(page);
  if (current !== plan) {
    if (plan === "free")
      throw new Error(
        `setPlan: the server is on ${current}; Free cannot come back on this data dir. Start a fresh server with launchServer().`,
      );
    const started = await page.request.post("/api/license/trial", { data: {} });
    if (!started.ok())
      throw new Error(
        `setPlan: POST /api/license/trial answered ${started.status()}: ${await started.text()}`,
      );
    const now = await readPlan(page);
    if (now !== "trial")
      throw new Error(`setPlan: the server is on ${now} after starting the trial.`);
  }
  if (page.url().startsWith("http")) await page.reload();
}
