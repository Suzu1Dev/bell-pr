// Accessibility gate: axe on Home and the four workspace tabs, in both
// languages, on a desktop and a phone screen. Serious and critical issues
// fail, color contrast included. Known issues are excluded only through
// the per-workstream allowlists in e2e/a11y/allowlist.<5A..5F>.json: each
// entry {rule, selector, view, reason} sits in the file of the workstream
// that owns the component, and wave 5 empties every file.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { locales } from "../shared/i18n/locale";

const views = {
  home: "#/home",
  "workspace-overview": "#/runs/demo-run/overview",
  "workspace-changes": "#/runs/demo-run/changes",
  "workspace-activity": "#/runs/demo-run/activity",
  "workspace-draft": "#/runs/demo-run/draft",
} as const;
type View = keyof typeof views;

const widths = [1440, 390];
const owners = ["5A", "5B", "5C", "5D", "5E", "5F"] as const;

interface AllowlistEntry {
  rule: string;
  /** A CSS selector; it covers the element it matches and everything inside. */
  selector: string;
  view: View;
  reason: string;
  owner: (typeof owners)[number];
}

function readAllowlists(): AllowlistEntry[] {
  return owners.flatMap((owner) => {
    const file = new URL(`./a11y/allowlist.${owner}.json`, import.meta.url);
    const entries: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(entries))
      throw new Error(`allowlist.${owner}.json must hold an array.`);
    return entries.map((entry, index) => {
      const where = `allowlist.${owner}.json entry ${index + 1}`;
      const value = entry as Record<string, unknown>;
      for (const field of ["rule", "selector", "view", "reason"])
        if (typeof value?.[field] !== "string" || !(value[field] as string).trim())
          throw new Error(`${where} needs a non-empty "${field}".`);
      if (!Object.hasOwn(views, value.view as string))
        throw new Error(`${where} names the unknown view "${value.view}".`);
      return { ...(value as Omit<AllowlistEntry, "owner">), owner };
    });
  });
}

const allowlist = readAllowlists();
const used = new Set<AllowlistEntry>();

test("every allowlist entry names a rule, a selector, a view and a reason, once", () => {
  // readAllowlists() threw already if an entry lacked a field; this lists
  // the entries in the report and refuses the same issue in two files.
  const keys = allowlist.map((entry) => `${entry.rule} ${entry.selector} ${entry.view}`);
  for (const entry of allowlist)
    test.info().annotations.push({
      type: `allowed (${entry.owner})`,
      description: `${entry.rule} on ${entry.selector} in ${entry.view}: ${entry.reason}`,
    });
  expect(new Set(keys).size).toBe(keys.length);
});

for (const locale of locales)
  for (const width of widths)
    for (const [view, hash] of Object.entries(views) as [View, string][])
      test(`${view} has no serious or critical issue (${locale}, ${width} px)`, async ({ page }) => {
        await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
        await page.goto(`/${hash}?locale=${locale}`);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);
        // Let transitions (focus rings, panels) settle before colors are read.
        await page.waitForTimeout(300);
        const results = await new AxeBuilder({ page })
          .options({ rules: { "color-contrast": { enabled: true } } })
          .analyze();
        // The contrast rule really ran on this view.
        expect(
          [...results.passes, ...results.violations, ...results.incomplete].some(
            (rule) => rule.id === "color-contrast",
          ),
        ).toBe(true);
        const { violations } = results;
        const problems: string[] = [];
        for (const violation of violations) {
          if (violation.impact !== "serious" && violation.impact !== "critical")
            continue;
          const entries = allowlist.filter(
            (entry) => entry.rule === violation.id && entry.view === view,
          );
          for (const node of violation.nodes) {
            const target = node.target.join(" ");
            const allowed = await page.evaluate(
              ({ target, selectors }) => {
                let element: Element | null = null;
                try {
                  element = document.querySelector(target);
                } catch {
                  return -1;
                }
                return selectors.findIndex((selector) => element?.closest(selector));
              },
              { target, selectors: entries.map((entry) => entry.selector) },
            );
            if (allowed >= 0) {
              used.add(entries[allowed]);
              continue;
            }
            problems.push(
              `${violation.id} (${violation.impact}) at ${target}\n  ${node.html}\n  ${(node.failureSummary ?? "").replace(/\n/g, "\n  ")}\n  ${violation.helpUrl}`,
            );
          }
        }
        expect(problems, `axe found ${problems.length} issue(s) on ${view}:\n${problems.join("\n")}`).toEqual([]);
      });

test.afterAll(() => {
  // Entries no run needed may be fixed already: their owner can drop them.
  for (const entry of allowlist)
    if (!used.has(entry))
      console.warn(
        `[a11y] allowlist.${entry.owner}.json: ${entry.rule} on ${entry.selector} in ${entry.view} did not occur in this worker.`,
      );
});
