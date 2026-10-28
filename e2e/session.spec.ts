// Collaboration on an existing run, with every agent action intercepted.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { getDemo } from "../src/demo/all";
import type { Run } from "../src/types";
import session from "../src/i18n/en/session";
import workspace from "../src/i18n/en/workspace";
import { launchServer } from "./start-server.mjs";

test("an existing session handles draft limitations, blocks concurrent edits, and refreshes its result", async ({ browser }) => {
  const sample = getDemo("en");
  let current: Run;
  const server = await launchServer({ seed: async (dataDir) => {
    current = {
      ...sample.run,
      id: "e2e-session-run",
      repoId: "e2e-session-repo",
      status: "review",
      agents: [],
      logs: [],
      worktreePath: path.join(dataDir, "worktrees", "e2e-session-run"),
      draft: { title: "Handle retry failures", body: "## Summary\nHandle retries.\n\n## Limitations\n- Retry tests have not run." },
      session: { revision: 1, updatedAt: "2026-10-28T00:00:00Z", messages: [
        { id: "old", role: "agent", content: "Existing collaboration message preserved.", at: "2026-10-28T00:00:00Z" },
      ] },
    };
    await writeFile(path.join(dataDir, "state.json"), JSON.stringify({
      version: 1,
      repos: [{ ...sample.repo, id: current.repoId, path: path.join(dataDir, "repositories", "sample") }],
      runs: [current],
    }));
  } });
  const context = await browser.newContext({ baseURL: server.baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let sent = "";
  let diffReads = 0;
  try {
    await page.route("**/api/runs/e2e-session-run", (route) => route.fulfill({ json: { run: current } }));
    await page.route("**/api/runs/e2e-session-run/diff", (route) => {
      diffReads++;
      return route.fulfill({ json: { files: sample.files } });
    });
    await page.route("**/api/runs/e2e-session-run/preflight", (route) => route.fulfill({ json: { checks: [] } }));
    await page.route("**/api/runs/e2e-session-run/session/messages", (route) => {
      sent = route.request().postDataJSON().content;
      current = { ...current, session: { ...current.session!, running: true, startedAt: new Date().toISOString() } };
      return route.fulfill({ json: { run: current } });
    });
    await page.route("**/api/runs/e2e-session-run/session/cancel", (route) => {
      current = {
        ...current,
        draft: { ...current.draft, body: "## Summary\nHandle retries.\n\n## Limitations\n- Retry tests passed." },
        session: { ...current.session!, running: false, revision: 2 },
      };
      return route.fulfill({ json: { run: current } });
    });
    await page.goto("/#/runs/e2e-session-run/draft?locale=en");
    await page.getByRole("button", { name: session.limitationsAction }).click();
    await expect(page.getByRole("tab", { name: session.tab, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Existing collaboration message preserved.")).toBeVisible();
    const composer = page.getByRole("textbox", { name: session.messageLabel });
    await expect(composer).toHaveValue(/Retry tests have not run/);
    await page.getByRole("button", { name: session.send, exact: true }).click();
    expect(sent).toContain("Retry tests have not run");
    await expect(composer).toBeDisabled();
    await page.getByRole("tab", { name: workspace.tabs.draft, exact: true }).click();
    await expect(page.locator("#pr-title")).toBeDisabled();
    await expect(page.locator("#pr-body")).toBeDisabled();
    await expect(page.locator(".review-footer .button.primary")).toBeDisabled();
    await page.getByRole("tab", { name: new RegExp(workspace.tabs.changes) }).click();
    await expect(page.locator(".rv-reviewed input")).toBeDisabled();
    await page.getByRole("tab", { name: new RegExp(session.tab) }).click();
    const before = diffReads;
    await page.getByRole("button", { name: session.stop, exact: true }).click();
    await expect(composer).toBeEnabled();
    await expect.poll(() => diffReads).toBeGreaterThan(before);
    await page.getByRole("tab", { name: workspace.tabs.draft, exact: true }).click();
    await expect(page.locator("#pr-body")).toHaveValue(/Retry tests passed/);
  } finally {
    await context.close();
    await server.stop();
  }
});
