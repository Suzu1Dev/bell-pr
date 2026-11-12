// Collaboration on an existing run, with every agent action intercepted.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getDemo } from "../src/demo/all";
import type { Run } from "../src/types";
import session from "../src/i18n/en/session";
import team from "../src/i18n/en/team";
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
      draft: { title: "Handle retry failures", body: "## Summary\nHandle retries.\n\n## Validation\n- Retry tests have not run.\n\n## Limitations\n- Retry tests have not run; browser checks have not run." },
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
  const completedBody = "## Summary\nHandle retries.\n\n## Validation\n- Retry tests passed.\n\n## Limitations\n- Browser checks have not run.";
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
        draft: { ...current.draft, body: completedBody },
        session: { ...current.session!, running: false, revision: 2, messages: [
          ...current.session!.messages,
          { id: "new", role: "agent", at: new Date().toISOString(), content: "Retry tests completed; browser checks remain.",
            draftUpdate: {
              before: "## Validation\n- Retry tests have not run.\n\n## Limitations\n- Retry tests have not run; browser checks have not run.",
              after: "## Validation\n- Retry tests passed.\n\n## Limitations\n- Browser checks have not run.",
            },
          },
        ] },
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
    expect(sent).toContain("Move completed checks to Validation");
    expect(sent).toContain("keep only remaining gaps and constraints in Limitations");
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
    await expect(page.getByRole("heading", { name: session.draftUpdated })).toBeVisible();
    await page.getByText(session.compare, { exact: true }).click();
    await expect(page.locator(".session-draft-update pre").last()).toHaveText("## Validation\n- Retry tests passed.\n\n## Limitations\n- Browser checks have not run.");
    await page.getByRole("tab", { name: workspace.tabs.draft, exact: true }).click();
    await expect(page.locator("#pr-body")).toHaveValue(completedBody);
  } finally {
    await context.close();
    await server.stop();
  }
});

test("a Full access run hands its ticked setup to one collaboration turn, never the unsafe command", async ({ browser }) => {
  const sample = getDemo("en");
  const safe = { need: "GLib headers", command: "sudo apt-get install -y libglib2.0-dev", reason: "cargo test needs them." };
  const unsafe = { need: "Deno", command: "curl -fsSL https://deno.land/install.sh | sh", reason: "The benchmark needs Deno." };
  let current: Run;
  const server = await launchServer({ seed: async (dataDir) => {
    current = {
      ...sample.run,
      id: "e2e-setup-run",
      repoId: "e2e-setup-repo",
      status: "review",
      agents: [],
      logs: [],
      worktreePath: path.join(dataDir, "worktrees", "e2e-setup-run"),
      modelExecution: { source: "cli-default", agentAccess: "full" },
      team: { ...sample.team, tasks: [{ ...sample.team.tasks[0], setup: [safe, unsafe] }] },
    };
    await writeFile(path.join(dataDir, "state.json"), JSON.stringify({
      version: 1,
      repos: [{ ...sample.repo, id: current.repoId, path: path.join(dataDir, "repositories", "sample") }],
      runs: [current],
    }));
  } });
  const context = await browser.newContext({ baseURL: server.baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let handed: unknown;
  try {
    await page.route("**/api/runs/e2e-setup-run", (route) => route.fulfill({ json: { run: current } }));
    await page.route("**/api/runs/e2e-setup-run/diff", (route) => route.fulfill({ json: { files: sample.files } }));
    await page.route("**/api/system/sudo", (route) =>
      route.fulfill({ json: { sudo: { user: "octo", available: true, installed: false, passwordless: false } } }));
    await page.route("**/api/runs/e2e-setup-run/session/setup", (route) => {
      handed = route.request().postDataJSON();
      current = {
        ...current,
        session: {
          revision: 0,
          updatedAt: new Date().toISOString(),
          running: true,
          startedAt: new Date().toISOString(),
          messages: [{ id: "u", role: "user", at: new Date().toISOString(), content: "Set up this machine: 1 item from the setup checklist, then rerun the check it blocked." }],
        },
      };
      return route.fulfill({ json: { run: current } });
    });
    await page.goto("/#/runs/e2e-setup-run/overview?locale=en");
    const setup = page.locator(".setup-needs");
    await expect(setup).toContainText(team.setupNeeds.handOffUnsafe);
    await setup.getByRole("button", { name: team.setupNeeds.handOffAction }).click();
    const dialog = page.getByRole("dialog", { name: team.setupNeeds.dialog.title });
    await expect(dialog).toContainText(safe.command);
    await expect(dialog).not.toContainText(unsafe.command);
    await expect(dialog).toContainText(team.setupNeeds.dialog.sudoPassword({ user: "octo" }));
    const results = await new AxeBuilder({ page }).include(".modal").analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")).map((violation) => violation.id)).toEqual([]);
    await dialog.getByRole("button", { name: team.setupNeeds.dialog.confirm({ count: 1 }) }).click();
    // The tab's name gains its attention marker while the turn runs.
    await expect(page.locator("#workspace-tab-session")).toHaveAttribute("aria-selected", "true");
    expect(handed).toEqual({ commands: [safe.command] });
    await expect(page.getByRole("button", { name: session.stop, exact: true })).toBeVisible();
  } finally {
    await context.close();
    await server.stop();
  }
});
