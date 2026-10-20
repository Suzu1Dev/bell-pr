// Shared steps for the e2e specs.
import { expect, type Page } from "@playwright/test";
import { htmlLang, type Locale } from "../shared/i18n/locale";
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
