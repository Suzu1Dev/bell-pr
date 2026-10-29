// Scope changes are read-only API mocks; no agent, Git or publishing action runs.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Route } from "@playwright/test";
import { getDemo } from "../src/demo/all";
import type { DiffFile, Run } from "../src/types";
import workspace from "../src/i18n/en/workspace";
import review from "../src/i18n/en/review";
import { launchServer } from "./start-server.mjs";

test("review rounds have independent read-only files and return to the current scoped review", async ({ browser }) => {
  const sample = getDemo("en");
  const id = "e2e-diff-rounds";
  const base = "a".repeat(40);
  const parent = "b".repeat(40);
  const currentFile: DiffFile = {
    ...sample.files[0], path: "current.ts", fingerprint: "c".repeat(64), status: "modified",
    patch: "@@ -2 +2 @@\n-before-current\n+after-current",
    explanationStatus: "ready", walkthroughStatus: "ready",
  };
  const historyFile = (filePath: string, content: string): DiffFile => ({
    path: filePath, language: "TypeScript", status: "added", additions: 1, deletions: 0,
    patch: `@@ -0,0 +1 @@\n+${content}`,
  });
  let current: Run;
  const server = await launchServer({ seed: async (dataDir) => {
    current = {
      ...sample.run, id, repoId: "e2e-rounds-repo", status: "review", baseSha: base,
      publishCommit: parent, prUrl: "https://github.com/acme/widgets/pull/7",
      agents: [], logs: [],
      worktreePath: path.join(dataDir, "worktrees", id),
      reviewedFiles: [currentFile.path], reviewedFingerprints: { [currentFile.path]: "old-cumulative-fingerprint" },
      followUps: [
        { id: "prior", status: "published", requestedAt: sample.run.createdAt, feedbackUrls: [], parentCommit: base, commit: parent },
        { id: "now", status: "review", requestedAt: sample.run.createdAt, feedbackUrls: [], parentCommit: parent },
      ],
      draft: { title: "Handle retry failures", body: "Keep retries predictable.", commitMessage: "Handle the review comment" },
    };
    await writeFile(path.join(dataDir, "state.json"), JSON.stringify({
      version: 1,
      repos: [{ ...sample.repo, id: current.repoId, path: path.join(dataDir, "repositories", "sample") }],
      runs: [current],
    }));
  } });
  const context = await browser.newContext({ baseURL: server.baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let delayedInitial: Route | undefined;
  let allCalls = 0;
  const writes: string[] = [];
  const contextBases: string[] = [];
  const reviewed: unknown[] = [];
  try {
    await page.route(`**/api/runs/${id}`, (route) => route.fulfill({ json: { run: current } }));
    await page.route(`**/api/runs/${id}/**`, (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== "GET") writes.push(url.pathname);
      if (url.pathname.endsWith("/diff")) return route.fulfill({ json: { files: [currentFile] } });
      if (url.pathname.endsWith("/preflight")) return route.fulfill({ json: { checks: [] } });
      if (url.pathname.endsWith("/context")) {
        contextBases.push(url.searchParams.get("base") ?? "");
        return route.fulfill({ json: { lines: ["keep line", "before-current", "tail line"] } });
      }
      if (url.pathname.endsWith("/diff-view")) {
        const round = url.searchParams.get("round");
        if (round === "initial") { delayedInitial = route; return; }
        if (round === "all" && ++allCalls === 1)
          return route.fulfill({ status: 409, json: { error: "Cannot read this comparison yet." } });
        return route.fulfill({ json: {
          baseSha: base, ...(round === "prior" ? { headSha: parent } : {}),
          files: round === "prior" ? [historyFile("prior.ts", "previous-round-only")]
            : [historyFile("initial.ts", "initial-contribution"), historyFile("current.ts", "cumulative-current")],
        } });
      }
      if (url.pathname.endsWith("/review") && request.method() === "POST") {
        const input = request.postDataJSON();
        reviewed.push(input);
        current = { ...current, reviewedFiles: [currentFile.path], reviewedFingerprints: { [currentFile.path]: currentFile.fingerprint! } };
        return route.fulfill({ json: { run: current } });
      }
      if (request.method() !== "GET") return route.fulfill({ status: 409, json: { error: "Unexpected mutation." } });
      return route.fallback();
    });
    await page.goto(`/#/runs/${id}/changes?locale=en`);
    const selector = page.getByRole("combobox", { name: workspace.diffRounds.label });
    await expect(selector).toHaveValue("current");
    await expect(page.locator(".rv-reviewed input")).not.toBeChecked();
    await expect(page.locator(".review-footer")).toContainText("0 / 1 reviewed");
    await page.getByRole("button", { name: review.diff.gap.wholeFile, exact: true }).click();
    await expect(page.getByText("tail line", { exact: true })).toBeVisible();
    expect(contextBases).toEqual([parent]);

    await selector.selectOption("initial");
    await expect.poll(() => !!delayedInitial).toBe(true);
    await selector.selectOption("prior");
    await expect(page.getByText("previous-round-only", { exact: true })).toBeVisible();
    await delayedInitial!.fulfill({ json: { baseSha: base, headSha: parent, files: [historyFile("late.ts", "late-initial-answer")] } });
    await expect(page.getByText("late-initial-answer", { exact: true })).toHaveCount(0);
    await expect(page.getByText("previous-round-only", { exact: true })).toBeVisible();
    await expect(page.locator(".rv-reviewed, .explanation-wrap, .check-wrap")).toHaveCount(0);
    await expect(page.locator(".review-footer")).not.toContainText(workspace.footer.approvePush);
    await expect(page.locator(".review-footer")).not.toContainText(workspace.footer.explainBack);

    await selector.selectOption("all");
    await expect(page.getByRole("alert").filter({ hasText: "Cannot read this comparison yet." })).toBeVisible();
    await page.getByRole("button", { name: workspace.diffRounds.retry, exact: true }).click();
    await expect(page.locator(".historical-diff .file-item")).toHaveCount(2);
    await page.locator(".historical-diff .file-item").filter({ hasText: "current.ts" }).click();
    await expect(page.getByText("cumulative-current", { exact: true })).toBeVisible();
    expect(writes).toEqual([]);
    expect(contextBases).toEqual([parent]);

    await page.getByRole("button", { name: workspace.diffRounds.back, exact: true }).click();
    await expect(selector).toHaveValue("current");
    await expect(page.locator(".file-tree .file-item")).toHaveCount(1);
    await expect(page.locator(".rv-reviewed input")).not.toBeChecked();
    await expect(page.getByText("after-current", { exact: true })).toBeVisible();
    // The controlled checkbox changes after the review API returns.
    await page.locator(".rv-reviewed input").click();
    await expect(page.locator(".rv-reviewed input")).toBeChecked();
    expect(reviewed).toEqual([{ filePath: currentFile.path, fingerprint: currentFile.fingerprint, reviewed: true }]);
    expect(writes).toEqual([`/api/runs/${id}/review`]);
  } finally {
    await context.close();
    await server.stop();
  }
});
