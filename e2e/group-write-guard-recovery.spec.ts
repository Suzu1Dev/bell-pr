// End-to-end group collaboration + write-guard S2 stop and recovery UI:
// (a) Host sets up #/group, invites a paired member, member joins; both take
//     disjoint holds via Start work and complete concurrent runs without
//     blocking each other; dependent Start work naming an unfinished task is
//     refused on #/group until the prerequisite releases with done: true.
// (b) When a member's write turn touches a path held by the host (including
//     during the refreshAfterSession background draft/explanations window),
//     the run halts and renders the holdStop recovery card in en and zh-TW at
//     1440px, 360px and 320px with zero leaked holder names or hold titles,
//     zero horizontal overflow, and zero serious/critical axe issues; Check
//     again while held shows the still-held notice (409), Check again after
//     the host releases clears the card (200), and on a second mixed run after
//     clearing localStorage["bellpr-participant-token"] on the paired device,
//     both Check again and Put these files back omit X-Bell-Participant and
//     succeed via deviceId fallback (no 403), restoring only the held paths,
//     handing focus to .workspace-heading h1, and keeping non-conflicting files.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page } from "@playwright/test";
import { locales } from "../shared/i18n/locale";
import type { Run } from "../src/types";
import { e2eApiHeaders } from "./api-token.mjs";
import { messages } from "./helpers/messages";
import { expectNoOverflow } from "./helpers/overflow";
import { readyStandIns } from "./helpers/ready-server";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const en = messages.en;
const repoId = "7a1c1a52-6b1e-4c58-9d2f-1a2b3c4d5e6f";
const privateHoldTitle = "SecretAuditHold77";
const viewports = [
  { width: 1440, height: 900 },
  { width: 360, height: 800 },
  { width: 320, height: 780 },
] as const;

const seedContents: Record<string, string> = {
  "README.md": "# shop\n",
  "docs/admin-only.md": "# Admin Notes\n",
  "src/catalog/feature.ts": 'export const adaFeature = "v1";\n',
  "src/billing/feature.ts": 'export const benFeature = "v1";\n',
  "src/api/users.ts": "export const users: string[] = [];\n",
  "src/free/safe.ts": 'export const safeHelper = "initial";\n',
  "db/schema.sql": "-- v1\n",
  "db/runner.ts": "export const runMigrations = () => true;\n",
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });

async function expectAccessible(page: Page, include?: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const builder = new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } });
  const results = await (include ? builder.include(include) : builder).analyze();
  expect(
    [...results.passes, ...results.violations, ...results.incomplete].some((rule) => rule.id === "color-contrast"),
  ).toBe(true);
  const problems = results.violations
    .filter(({ impact }) => impact === "serious" || impact === "critical")
    .flatMap(({ id, nodes }) => nodes.map((node) => `${id} at ${node.target.join(" ")}\n  ${node.html}`));
  expect(problems, problems.join("\n")).toEqual([]);
}

const expectFits = async (page: Page) => {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
  await expectNoOverflow(page);
};

async function takeHold(page: Page, title: string, paths: string) {
  await page.locator("#hold-title").fill(title);
  await page.locator("#hold-paths").fill(paths);
  await expect(page.locator("#hold-answer .split-info")).toContainText(en.collab.free);
  await page.getByRole("button", { name: en.collab.takeHold }).click();
}

async function startAutoRunFromDialog(page: Page, prompt: string): Promise<string> {
  await page.goto(`/#/repos/${repoId}?locale=en`);
  await page.getByRole("button", { name: en.repos.explore.chooseDirection }).click();
  const dialog = page.getByRole("dialog", { name: en.modals.newTask.title });
  const planCheckbox = dialog.getByRole("checkbox", { name: en.mission.settings.planApproval.label });
  await expect(planCheckbox).toBeEnabled();
  if (await planCheckbox.isChecked()) await planCheckbox.uncheck();
  await dialog.locator("#task-prompt").fill(prompt);
  const createdPromise = page.waitForResponse(
    (res) => res.url().endsWith("/api/runs") && res.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: en.modals.newTask.start }).click();
  const created = await createdPromise;
  expect(created.status()).toBe(202);
  const { run } = (await created.json()) as { run: Run };
  return run.id;
}

test.describe("group parallel work, task dependencies, write-guard stop, and recovery UI", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  let tempDir: string;
  let refreshGateFile: string;
  let draftInFlightFile: string;
  let explanationsInFlightFile: string;
  let server: LaunchedServer;
  let ada: Page;
  let ben: Page;
  let benRunId = "";

  test.beforeAll(async ({ browser }) => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "bellpr-e2e-group-wg-"));
    refreshGateFile = path.join(tempDir, "hold-refresh-gate");
    draftInFlightFile = path.join(tempDir, "draft-in-flight");
    explanationsInFlightFile = path.join(tempDir, "explanations-in-flight");

    const fakeBin = path.join(tempDir, "bin");
    await mkdir(fakeBin, { recursive: true });
    for (const name of ["claude", "gh"] as const) {
      await writeFile(path.join(fakeBin, name), `#!/bin/sh\n${readyStandIns[name]}\n`, { mode: 0o755 });
    }

    const codexRunner = path.join(tempDir, "codex-runner.mjs");
    await writeFile(
      codexRunner,
      `import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli 0.159.0");
  process.exit(0);
}
if (args[0] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
if (args[0] !== "exec") process.exit(1);

const argAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const cwd = argAfter("-C") || process.cwd();
const schemaPath = argAfter("--output-schema");
const prompt = fs.readFileSync(0, "utf8");
const emit = (text) => {
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\\n");
};
const writeRel = (rel, content) => {
  const full = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gateFile = ${JSON.stringify(refreshGateFile)};
const draftMarker = ${JSON.stringify(draftInFlightFile)};
const explanationsMarker = ${JSON.stringify(explanationsInFlightFile)};

if (!schemaPath) {
  emit("Reviewed and verified cleanly.");
  process.exit(0);
}

const base = path.basename(schemaPath);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

if (base === "plan-schema.json") {
  const target = prompt.includes("Catalog work") ? "src/catalog/feature.ts" : prompt.includes("Billing work") ? "src/billing/feature.ts" : "README.md";
  emit(JSON.stringify({
    summary: "Update " + target,
    revisionNotes: null,
    premise: null,
    tasks: [{ id: "task-1", title: "Update " + target, description: "Edit " + target, files: [target], dependsOn: [] }],
  }));
} else if (base === "report-schema.json") {
  const target = prompt.includes("Catalog work") ? "src/catalog/feature.ts" : prompt.includes("Billing work") ? "src/billing/feature.ts" : "README.md";
  await sleep(150);
  writeRel(target, 'export const featureState = "updated-by-run";\\n');
  emit(JSON.stringify({
    report: {
      summary: "Updated " + target,
      checks: [{ command: "git status", outcome: "clean diff" }],
      tradeoffs: "None.",
      limitations: "None.",
      setup: [],
    },
    messages: [],
  }));
} else if (base === "session-schema.json") {
  if (prompt.includes("[E2E_CONFLICT_MIXED]")) {
    writeRel("src/api/users.ts", 'export const users = ["ben-turn-2"];\\n');
    writeRel("docs/admin-only.md", "# Admin Notes (unauthorized edit)\\n");
    writeRel("src/free/safe.ts", 'export const safeHelper = "kept-after-restore";\\n');
  } else if (prompt.includes("[E2E_CONFLICT_SINGLE]")) {
    writeRel("src/api/users.ts", 'export const users = ["ben-turn-1"];\\n');
  }
  emit(JSON.stringify({
    reply: "Applied the requested changes.",
    questions: [],
    notRun: [],
    setup: [],
    limitations: "None.",
    validation: "Checked modified files.",
  }));
} else if (schema.properties?.files) {
  if (fs.existsSync(gateFile)) {
    fs.writeFileSync(explanationsMarker, "1");
    while (fs.existsSync(gateFile)) await sleep(40);
  }
  const rawDiffs = (prompt.split("\\nProvided diffs:\\n").pop() || "[]").split("\\n\\nBELL Ponytail")[0];
  const diffs = JSON.parse(rawDiffs);
  emit(JSON.stringify({
    files: diffs.map((d) => ({
      path: d.path,
      summary: "Updated " + d.path,
      reason: "Supports requested behavior.",
      concept: "Module export\\nExports updated constant.",
      tip: "Verify callers expecting previous value.",
      example: { scenario: "Importing module.", before: "Previous value.", after: "Updated value.", beforeSteps: [], afterSteps: [] },
      alternatives: "Could pass as parameter instead.",
      lookup: ["typescript exports"],
      selfCheck: { question: "What changed in " + d.path + "?", answer: "Its exported value was updated." },
    })),
  }));
} else if (schema.properties?.policy) {
  if (fs.existsSync(gateFile)) {
    fs.writeFileSync(draftMarker, "1");
    while (fs.existsSync(gateFile)) await sleep(40);
  }
  emit(JSON.stringify({
    title: "feat: update shop module",
    body: "## Problem\\nUpdate module.\\n\\n## Changes\\nUpdated module exports.\\n\\n## Validation\\nVerified diff.\\n\\n## Limitations\\nNone.",
    policy: "repository",
    summary: "Updated shop module.",
    rules: [],
    checklist: [],
    templateSourceId: "",
    commitMessageSuggestion: null,
  }));
} else {
  emit("{}");
}
`,
    );
    await writeFile(
      path.join(fakeBin, "codex"),
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(codexRunner)} "$@"\n`,
      { mode: 0o755 },
    );
    const gitconfig = path.join(tempDir, "gitconfig");
    await writeFile(gitconfig, "[user]\n\tname = Sample Contributor\n\temail = contributor@example.com\n");

    server = await launchServer({
      env: {
        BELLPR_GROUP: "1",
        GIT_CONFIG_GLOBAL: gitconfig,
        PATH: [fakeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
      },
      async seed(dataDir) {
        const checkout = path.join(dataDir, "repositories", "shop");
        await mkdir(checkout, { recursive: true });
        for (const [rel, content] of Object.entries(seedContents)) {
          const full = path.join(checkout, rel);
          await mkdir(path.dirname(full), { recursive: true });
          await writeFile(full, content);
        }
        git(checkout, "init", "-q", "-b", "main");
        git(checkout, "add", ".");
        git(checkout, "-c", "user.name=Sample Author", "-c", "user.email=author@example.com", "commit", "-q", "-m", "Initial shop");
        await writeFile(
          path.join(dataDir, "state.json"),
          JSON.stringify({
            version: 1,
            repos: [{
              id: repoId,
              name: "shop",
              owner: "local",
              fullName: "local/shop",
              path: checkout,
              defaultBranch: "main",
              url: "",
            }],
            runs: [],
          }),
        );
      },
    });

    const options = { baseURL: server.baseURL, viewport: viewports[0] };
    ada = await (await browser.newContext({ ...options, extraHTTPHeaders: e2eApiHeaders })).newPage();

    const hostReq = await request.newContext({ baseURL: server.baseURL, extraHTTPHeaders: e2eApiHeaders });
    const { code } = await (await hostReq.post("/api/pair/codes", { data: {} })).json();
    const { token } = await (await hostReq.post("/api/pair", { data: { code, name: "Ben's laptop" } })).json();
    await hostReq.dispose();

    const benContext = await browser.newContext({ ...options, extraHTTPHeaders: {} });
    await benContext.addInitScript((value) => localStorage.setItem("bellpr-device-token", value), token);
    ben = await benContext.newPage();
  });

  test.afterAll(async () => {
    if (refreshGateFile && existsSync(refreshGateFile)) await unlink(refreshGateFile).catch(() => undefined);
    await ada?.context().close();
    await ben?.context().close();
    await server?.stop();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  test("(a) host and paired member join #/group, complete concurrent runs on disjoint holds, and enforce dependsOn until done: true", async () => {
    // 1. Host (Ada) sets up #/group, adds the shop repository, and invites Ben.
    await ada.goto("/#/group?locale=en");
    await ada.locator("#host-name").fill("Ada");
    await ada.getByRole("button", { name: en.collab.host.submit }).click();
    await ada.getByRole("button", { name: en.collab.addRepository }).click();
    await expect(ada.locator("#hold-title")).toBeVisible();

    await ada.getByRole("button", { name: en.collab.invite, exact: true }).click();
    const inviteDialog = ada.getByRole("dialog");
    await inviteDialog.locator("#invite-name").fill("Ben");
    await inviteDialog.getByRole("button", { name: en.collab.inviteDialog.create }).click();
    const inviteCode = await inviteDialog.locator("code").innerText();
    await inviteDialog.getByRole("button", { name: en.collab.inviteDialog.done }).click();

    // 2. Member (Ben) joins on #/group.
    await ben.goto("/#/group?locale=en");
    await ben.locator("#join-code").fill(inviteCode);
    await ben.getByRole("button", { name: en.collab.join.submit, exact: true }).click();
    await expect(ben.locator("#hold-title")).toBeVisible();

    // 3. Both take disjoint holds via Start work on #/group.
    await takeHold(ada, "Catalog feature work", "src/catalog/feature.ts");
    await takeHold(ben, "Billing feature work", "src/billing/feature.ts");
    await expect(ada.locator(".group-hold")).toHaveCount(2);
    await expect(ben.locator(".group-hold")).toHaveCount(2);

    // 4. Both launch runs concurrently and complete to review without blocking each other.
    const [adaRunId, startedBenRunId] = await Promise.all([
      startAutoRunFromDialog(ada, "Catalog work"),
      startAutoRunFromDialog(ben, "Billing work"),
    ]);
    benRunId = startedBenRunId;

    const hostApi = await request.newContext({ baseURL: server.baseURL, extraHTTPHeaders: e2eApiHeaders });
    try {
      await expect
        .poll(
          async () => {
            const [rAda, rBen] = await Promise.all([
              hostApi.get(`/api/runs/${adaRunId}`).then((r) => r.json() as Promise<{ run: Run }>),
              hostApi.get(`/api/runs/${benRunId}`).then((r) => r.json() as Promise<{ run: Run }>),
            ]);
            return [rAda.run.status, rBen.run.status];
          },
          { timeout: 45_000 },
        )
        .toEqual(["review", "review"]);
    } finally {
      await hostApi.dispose();
    }

    // Release the two initial feature holds on #/group.
    await ada.goto("/#/group?locale=en");
    await ben.goto("/#/group?locale=en");
    await ada.getByRole("button", { name: en.collab.release.unfinishedAria({ title: "Catalog feature work" }) }).click();
    await ben.getByRole("button", { name: en.collab.release.unfinishedAria({ title: "Billing feature work" }) }).click();
    await expect(ada.locator(".group-hold", { hasText: "Catalog feature work" })).toContainText(en.collab.gone);
    await expect(ben.locator(".group-hold", { hasText: "Billing feature work" })).toContainText(en.collab.gone);

    // 5. The real prerequisite control blocks until Finish & release, including after a reload.
    await takeHold(ada, "Schema migration", "db/schema.sql");
    const prerequisite = ben.getByRole("checkbox", { name: "Schema migration", exact: true });
    await expect(prerequisite).toBeVisible();
    await prerequisite.check();
    await ben.locator("#hold-title").fill("Migration runner");
    await ben.locator("#hold-paths").fill("db/runner.ts");
    await expect(ben.locator("#hold-answer .split-info")).toContainText(en.collab.free);
    const refusedWork = ben.waitForResponse(
      (res) => res.url().endsWith("/work") && res.request().method() === "POST",
    );
    await ben.getByRole("button", { name: en.collab.takeHold }).click();
    const refusedRes = await refusedWork;
    expect(refusedRes.status()).toBe(409);
    expect(((await refusedRes.json()) as { reason?: string }).reason).toBe("dependencyPending");

    const refusalAlert = ben.locator(".group-page form [role=alert]");
    await expect(refusalAlert).toHaveText("This work depends on a task that is not done yet. Nothing was held.");
    await expect(ben.locator(".group-hold", { hasText: "Migration runner" })).toHaveCount(0);

    const releaseAnnouncement = ada.locator('section[aria-labelledby="held-h"] > [aria-live="polite"]');
    await ada.getByRole("button", { name: en.collab.release.finishAria({ title: "Schema migration" }) }).click();
    await expect(releaseAnnouncement).toHaveText(
      en.collab.spoken.finishedAndReleased({ title: "Schema migration", paths: "db/schema.sql" }),
    );
    await expect(ada.locator(".group-hold", { hasText: "Schema migration" })).toContainText(en.collab.gone);
    await expect(ben.locator(".group-hold", { hasText: "Schema migration" })).toHaveCount(0);

    await ben.reload();
    await expect(ben.locator("#hold-title")).toBeVisible();
    await ben.getByRole("checkbox", { name: "Schema migration", exact: true }).check();
    await ben.locator("#hold-title").fill("Migration runner");
    await ben.locator("#hold-paths").fill("db/runner.ts");
    await expect(ben.locator("#hold-answer .split-info")).toContainText(en.collab.free);
    await ben.getByRole("button", { name: en.collab.takeHold }).click();
    const dependent = ben.locator(".group-hold.mine", { hasText: "Migration runner" });
    await expect(dependent).toBeVisible();
    await expect(dependent).toContainText(
      en.collab.dependsOn.cardNote({ titles: "Schema migration" }),
    );
    await expect(ada.locator(".group-hold", { hasText: "Migration runner" })).toContainText("Ben");
    await ben.getByRole("button", { name: en.collab.release.unfinishedAria({ title: "Migration runner" }) }).click();

    // Release only keeps the selected unfinished task, and the next refusal says held: false.
    await takeHold(ada, "Schema draft", "db/draft.sql");
    const draft = ben.getByRole("checkbox", { name: "Schema draft", exact: true });
    await draft.check();
    await ben.locator("#hold-title").fill("Draft reader");
    await ben.locator("#hold-paths").fill("db/reader.ts");
    await expect(ben.locator("#hold-answer .split-info")).toContainText(en.collab.free);
    await ben.getByRole("button", { name: en.collab.takeHold }).click();
    await expect(refusalAlert).toHaveText("This work depends on a task that is not done yet. Nothing was held.");
    await ada.getByRole("button", { name: en.collab.release.unfinishedAria({ title: "Schema draft" }) }).click();
    await expect(releaseAnnouncement).toHaveText(
      en.collab.spoken.releasedUnfinished({ title: "Schema draft", paths: "db/draft.sql" }),
    );
    await expect(draft).toBeChecked();
    await expect(refusalAlert).toHaveCount(0);
    const stillRefused = ben.waitForResponse(
      (res) => res.url().endsWith("/work") && res.request().method() === "POST",
    );
    await ben.getByRole("button", { name: en.collab.takeHold }).click();
    const stillPending = (await (await stillRefused).json()) as {
      reason?: string;
      pending?: { taskId: string; title: string; held: boolean }[];
    };
    expect(stillPending.reason).toBe("dependencyPending");
    expect(stillPending.pending).toEqual([
      { taskId: expect.any(String), title: "Schema draft", held: false },
    ]);
    await ben.getByRole("button", { name: en.collab.dependsOn.clear, exact: true }).click();
    await expect(draft).toHaveCount(0);
  });

  test("(b) write-guard stop card (en/zh-TW, 1440px/360px/320px, privacy, axe, overflow), Check again during refreshAfterSession -> release -> clear, and selective Put these files back", async () => {
    // 1. Host (Ada) takes a hold with a private title on src/api/users.ts.
    await ada.goto("/#/group?locale=en");
    await takeHold(ada, privateHoldTitle, "src/api/users.ts");
    await expect(ada.locator(".group-hold.mine")).toContainText(privateHoldTitle);

    // Hold refreshAfterSession's background draft + explanations jobs open so we prove
    // Check again works inside the exact post-session refresh window without 409 holdRecoveryBusy.
    await writeFile(refreshGateFile, "hold");

    // 2. Ben sends a conflicting Session write turn that edits held src/api/users.ts.
    await ben.goto(`/#/runs/${benRunId}/session?locale=en`);
    const composer = ben.getByRole("textbox", { name: en.session.messageLabel });
    await composer.fill("Update users endpoint [E2E_CONFLICT_SINGLE]");
    await ben.getByRole("button", { name: en.session.send, exact: true }).click();

    // Wait for the stop recovery card to render in Ben's workspace AND for background refresh jobs to be in flight.
    const stopCard = ben.locator(".hold-stop-notice");
    await expect(stopCard).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => existsSync(draftInFlightFile) && existsSync(explanationsInFlightFile), { timeout: 15_000 })
      .toBe(true);

    // 3. Verify en & zh-TW at both 1440px and 360px: exact copy, zero leaked holder names or titles,
    //    scrollWidth <= clientWidth (0px overflow), and 0 serious/critical axe violations.
    for (const locale of locales) {
      for (const viewport of viewports) {
        const t = messages[locale].workspace;
        const view = await ben.context().newPage();
        try {
          await view.setViewportSize(viewport);
          await view.goto(`/#/runs/${benRunId}/overview?locale=${locale}`);
          const card = view.locator(".hold-stop-notice");
          await expect(card).toBeVisible();
          await expect(card.locator("h2")).toHaveText(t.holdStop.heading({ count: 1 }));
          await expect(card).toContainText(t.holdStop.itemPathOnly({ path: "src/api/users.ts" }));
          await expect(card.getByRole("button", { name: t.holdStop.restoreAction({ count: 1 }) })).toBeVisible();
          await expect(card.getByRole("button", { name: t.holdStop.recheckAction })).toBeVisible();

          // Privacy boundary: neither holder name ("Ada") nor private hold title appears anywhere in the run workspace.
          const workspaceText = await view.locator("body").innerText();
          expect(workspaceText).not.toContain("Ada");
          expect(workspaceText).not.toContain(privateHoldTitle);

          await expectFits(view);
          await expectAccessible(view);

          // Also check overflow & axe on the confirmation modal at this locale & viewport.
          await card.getByRole("button", { name: t.holdStop.restoreAction({ count: 1 }) }).click();
          const modal = view.getByRole("dialog", { name: t.holdStop.restoreConfirmTitle });
          await expect(modal).toBeVisible();
          await expectFits(view);
          await expectAccessible(view, ".modal");
          await modal.getByRole("button", { name: t.holdStop.restoreCancelAction }).click();
          await expect(modal).toHaveCount(0);
        } finally {
          await view.close();
        }
      }
    }

    // 4. While refreshAfterSession (draft + explanations) is STILL actively running AND Ada still holds src/api/users.ts:
    //    Check again returns 409 heldByOther (not holdRecoveryBusy!), shows the still-held notice, and reveals holder metadata on the card.
    const recheckWhileHeld = ben.waitForResponse(
      (res) => res.url().endsWith(`/api/runs/${benRunId}/holds/recheck`) && res.request().method() === "POST",
    );
    await stopCard.getByRole("button", { name: en.workspace.holdStop.recheckAction }).click();
    const heldRes = await recheckWhileHeld;
    expect(heldRes.status()).toBe(409);
    const heldJson = (await heldRes.json()) as { reason?: string };
    expect(heldJson.reason).toBe("heldByOther");

    await expect(ben.locator(".toast")).toContainText("Ada still holds src/api/users.ts");
    await expect(stopCard).toContainText(`Held by Ada for “${privateHoldTitle}”`);

    // Verify 360px overflow + axe with holder metadata visible on the card as well.
    await ben.setViewportSize({ width: 360, height: 800 });
    await expectFits(ben);
    await expectAccessible(ben, ".hold-stop-notice");
    await ben.setViewportSize(viewports[0]);

    // Release the background draft/explanations gate.
    await unlink(refreshGateFile);

    // 5. Host releases the hold on #/group -> Ben clicks Check again (200) -> recovery card clears!
    await ada.getByRole("button", { name: en.collab.release.unfinishedAria({ title: privateHoldTitle }) }).click();
    await expect(ada.locator(".group-hold", { hasText: privateHoldTitle })).toContainText(en.collab.gone);

    const recheckCleared = ben.waitForResponse(
      (res) => res.url().endsWith(`/api/runs/${benRunId}/holds/recheck`) && res.request().method() === "POST",
    );
    await stopCard.getByRole("button", { name: en.workspace.holdStop.recheckAction }).click();
    expect((await recheckCleared).status()).toBe(200);
    await expect(stopCard).toHaveCount(0);
    await expect(ben.locator(".toast")).toContainText(en.workspace.notices.holdCleared);

    // 6. Second mixed write turn: Ada holds TWO paths (src/api/users.ts + docs/admin-only.md) and Ben's
    //    turn edits both held paths PLUS non-conflicting src/free/safe.ts. "Put these files back" restores
    //    ONLY the two held paths while keeping src/free/safe.ts (and src/billing/feature.ts) intact!
    await takeHold(ada, "Users and admin lock", "src/api/users.ts\ndocs/admin-only.md");
    await expect(ada.locator(".group-hold.mine")).toContainText("Users and admin lock");

    await ben.getByRole("textbox", { name: en.session.messageLabel }).fill(
      "Update safe helper, admin docs, and users [E2E_CONFLICT_MIXED]",
    );
    await ben.getByRole("button", { name: en.session.send, exact: true }).click();
    await expect(stopCard).toBeVisible({ timeout: 30_000 });
    await expect(stopCard.locator("h2")).toHaveText(en.workspace.holdStop.heading({ count: 2 }));
    await expect(stopCard).toContainText("docs/admin-only.md");
    await expect(stopCard).toContainText("src/api/users.ts");

    // 7. Paired-device deviceId fallback without localStorage["bellpr-participant-token"]:
    //    remove the participant token and reload so the paired device relies solely on bellpr-device-token.
    await ben.evaluate(() => localStorage.removeItem("bellpr-participant-token"));
    await ben.reload();
    expect(
      await ben.evaluate(() => ({
        participantToken: localStorage.getItem("bellpr-participant-token"),
        hasDeviceToken: Boolean(localStorage.getItem("bellpr-device-token")),
      })),
    ).toEqual({ participantToken: null, hasDeviceToken: true });
    await expect(stopCard).toBeVisible();

    const recheckFallbackPromise = ben.waitForResponse(
      (res) => res.url().endsWith(`/api/runs/${benRunId}/holds/recheck`) && res.request().method() === "POST",
    );
    await stopCard.getByRole("button", { name: en.workspace.holdStop.recheckAction }).click();
    const recheckFallbackRes = await recheckFallbackPromise;
    expect(recheckFallbackRes.request().headers()["x-bell-participant"]).toBeUndefined();
    expect(recheckFallbackRes.status()).toBe(409);
    expect(((await recheckFallbackRes.json()) as { reason?: string }).reason).toBe("heldByOther");

    await stopCard.getByRole("button", { name: en.workspace.holdStop.restoreAction({ count: 2 }) }).click();
    const confirmModal = ben.getByRole("dialog", { name: en.workspace.holdStop.restoreConfirmTitle });
    await expect(confirmModal).toBeVisible();
    const restoreResponse = ben.waitForResponse(
      (res) => res.url().endsWith(`/api/runs/${benRunId}/holds/restore`) && res.request().method() === "POST",
    );
    await confirmModal
      .getByRole("button", { name: en.workspace.holdStop.restoreConfirmAction })
      .click();
    const restoreRes = await restoreResponse;
    expect(restoreRes.request().headers()["x-bell-participant"]).toBeUndefined();
    expect(restoreRes.status()).toBe(200);
    const restoredJson = (await restoreRes.json()) as { restored: string[]; run: Run };
    expect(restoredJson.restored).toEqual(["docs/admin-only.md", "src/api/users.ts"]);
    await expect(stopCard).toHaveCount(0);
    await expect(ben.locator(".workspace-heading h1")).toBeFocused();
    await expect(ben.locator(".toast")).toContainText(
      en.workspace.notices.heldFilesRestored({ count: 2, keptOtherChanges: true }),
    );

    // Verify in Changes UI and on disk in worktreePath: held paths are restored, non-conflicting files remain!
    await ben.getByRole("tab", { name: /^Code changes/ }).click();
    await expect(ben.locator('.file-item[title="src/free/safe.ts"]')).toBeVisible();
    await expect(ben.locator('.file-item[title="src/billing/feature.ts"]')).toBeVisible();
    await expect(ben.locator('.file-item[title="src/api/users.ts"]')).toHaveCount(0);
    await expect(ben.locator('.file-item[title="docs/admin-only.md"]')).toHaveCount(0);

    const worktreePath = restoredJson.run.worktreePath!;
    expect(await readFile(path.join(worktreePath, "src/api/users.ts"), "utf8")).toBe(
      seedContents["src/api/users.ts"],
    );
    expect(await readFile(path.join(worktreePath, "docs/admin-only.md"), "utf8")).toBe(
      seedContents["docs/admin-only.md"],
    );
    expect(await readFile(path.join(worktreePath, "src/free/safe.ts"), "utf8")).toBe(
      'export const safeHelper = "kept-after-restore";\n',
    );
  });
});
