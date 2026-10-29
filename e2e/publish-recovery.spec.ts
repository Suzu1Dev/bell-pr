// Every write is intercepted; this exercises recovery without approving or publishing.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { getDemo } from "../src/demo/all";
import type { Run } from "../src/types";
import workspace from "../src/i18n/en/workspace";
import { launchServer } from "./start-server.mjs";

test("unfinished publish recovery waits for saved edits, reports refusal, and returns to review", async ({ browser }) => {
  const sample = getDemo("en");
  const id = "e2e-publish-recovery";
  const commit = "a".repeat(40);
  let current: Run;
  const server = await launchServer({ seed: async (dataDir) => {
    current = {
      ...sample.run, id, repoId: "e2e-recovery-repo", status: "approved",
      agents: [], logs: [], publishCommit: commit, approvedFingerprint: "old-approval",
      prUrl: undefined, headRepository: undefined, publishedBranch: undefined, followUps: undefined,
      worktreePath: path.join(dataDir, "worktrees", id),
      draft: { title: "Handle retry failures", body: "## Summary\nKeep the retry behavior predictable." },
    };
    await writeFile(path.join(dataDir, "state.json"), JSON.stringify({
      version: 1,
      repos: [{ ...sample.repo, id: current.repoId, path: path.join(dataDir, "repositories", "sample") }],
      runs: [current],
    }));
  } });
  const context = await browser.newContext({ baseURL: server.baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let recoveryCalls = 0;
  const writes: string[] = [];
  try {
    await page.route(`**/api/runs/${id}`, (route) => route.fulfill({ json: { run: current } }));
    await page.route(`**/api/runs/${id}/**`, (route) => {
      const request = route.request();
      const endpoint = new URL(request.url()).pathname;
      if (request.method() !== "GET") writes.push(`${request.method()} ${endpoint}`);
      if (endpoint.endsWith("/diff")) return route.fulfill({ json: { files: sample.files } });
      if (endpoint.endsWith("/preflight")) return route.fulfill({ json: { checks: [] } });
      if (endpoint.endsWith("/draft") && request.method() === "PATCH") {
        current = { ...current, draft: request.postDataJSON(), status: "review" };
        delete current.approvedFingerprint;
        return route.fulfill({ json: { run: current } });
      }
      if (endpoint.endsWith("/publish/recover") && request.method() === "POST") {
        recoveryCalls++;
        expect(request.postDataJSON()).toEqual({ commit });
        if (recoveryCalls === 1) return route.fulfill({
          status: 409, json: { error: "The remote branch could not be checked. Try again." },
        });
        current = { ...current, status: "review" };
        delete current.publishCommit;
        delete current.approvedFingerprint;
        return route.fulfill({ json: { run: current } });
      }
      // No unmatched mutation can reach a real backend operation.
      if (request.method() !== "GET") return route.fulfill({ status: 409, json: { error: "Unexpected mutation." } });
      return route.fallback();
    });
    await page.goto(`/#/runs/${id}/draft?locale=en`);
    const recover = page.getByRole("button", { name: workspace.draft.recoverPublish, exact: true });
    await expect(recover).toBeEnabled();
    await expect(page.getByText(workspace.draft.recoveryHelp, { exact: true })).toBeVisible();

    const edited = "## Summary\nKeep the retry behavior predictable and preserve my latest words.";
    await page.locator("#pr-body").fill(edited);
    await expect(recover).toBeDisabled();
    await expect(page.getByText(workspace.draft.recoveryNeedsSave, { exact: true })).toBeVisible();
    expect(recoveryCalls).toBe(0);
    await page.getByRole("button", { name: workspace.draft.save, exact: true }).click();
    await expect(recover).toBeEnabled();

    await recover.click();
    await expect(page.locator(".toast-error")).toHaveText("The remote branch could not be checked. Try again.");
    await expect(recover).toBeEnabled();
    await expect(page.locator("#pr-body")).toHaveValue(edited);
    expect(current!.publishCommit).toBe(commit);

    await recover.click();
    await expect(page.locator(".toast")).toHaveText(workspace.notices.publishRecovered);
    await expect(recover).toHaveCount(0);
    await expect(page.locator("#pr-body")).toHaveValue(edited);
    expect(current!.status).toBe("review");
    expect(current!.publishCommit).toBeUndefined();
    expect(current!.prUrl).toBeUndefined();
    expect(writes).toEqual([
      `PATCH /api/runs/${id}/draft`,
      `POST /api/runs/${id}/publish/recover`,
      `POST /api/runs/${id}/publish/recover`,
    ]);
  } finally {
    await context.close();
    await server.stop();
  }
});
