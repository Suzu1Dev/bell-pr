// Learn by hand's own words and run record on a real (not sample) run
// (DESIGN v1.2 F11, F12, F13): the Draft tab offers no AI draft and no
// agent line, even with "Always add" on, and shows the facts list, which
// nothing inserts; the publish dialog shows the record, with the claim only
// for a run whose history is clean, and the quoted confirm beside it. Each
// test runs its own server (e2e/helpers/real-project.ts) with fake codex,
// claude and gh first on PATH. The approval request answers with the
// seeded approved run, so the dialog opens on it as it is; the PR template
// and, for the quoted confirm, the server's checks are stubbed (the
// template route and the confirm's decision are W2A's and W2G's). The
// "against the real server" tests stub nothing: the last one approves and
// publishes a fitted run with the real quoted-confirm decision.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { DraftCheck } from "../shared/draft-checks";
import { changeFingerprint } from "../shared/change-fingerprint";
import { aiDisclosureLine } from "../shared/drafts";
import byHand from "../server/i18n/en/by-hand";
import byHandFlow from "../server/i18n/en/by-hand-flow";
import serverRun from "../server/i18n/en/run";
import record from "../src/byhand/record/i18n/en";
import common from "../src/i18n/en/common";
import draft from "../src/i18n/en/draft";
import mission from "../src/i18n/en/mission";
import workspace from "../src/i18n/en/workspace";
import { readFileSync } from "node:fs";
import path from "node:path";
import { byHandRulesCase } from "../shared/by-hand-rules";
import { attachCarveOuts, classifyPolicy } from "../shared/project-policy";
import { repoId, runId, startRealProject, type RealProject } from "./helpers/real-project";

const at = "2026-10-20T09:00:00.000Z";
const agent = (id: string, role: string) => ({ id, name: role, role, status: "complete", detail: "" });

/** An approved Learn-by-hand run whose guide explained, answered and hinted, with two test runs. */
function byHandRun(extra: Record<string, unknown> = {}, byHand: Record<string, unknown> = {}) {
  return {
    status: "approved",
    approvedFingerprint: "e2e-approved",
    createdAt: at,
    learnByHand: true,
    agents: [agent("lead", "Guide"), agent("reviewer", "Reviewer"), agent("tester", "Test analyst")],
    explanations: {},
    modelExecution: { provider: "claude", source: "selected", reported: { model: "claude-sonnet-4-5", cliVersion: "2.1.292" } },
    byHand: {
      events: [
        { at, kind: "explain", source: "premise" },
        { at, kind: "answer", source: "ask" },
        { at, kind: "answer", source: "hint", rung: 1 },
      ],
      tests: [
        { at, command: "npm test", changeFingerprint: "a", outcome: "failed", ms: 40, prediction: "fail" },
        { at: "2026-10-20T10:00:00.000Z", command: "npm test", changeFingerprint: "b", outcome: "passed", ms: 40, prediction: "pass" },
      ],
      ...byHand,
    },
    ...extra,
  };
}

async function open(browser: Browser, project: RealProject) {
  const context = await browser.newContext({
    baseURL: project.baseURL,
    storageState: project.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  // Approval answers with the seeded approved run as it is.
  await page.route(`**/api/runs/${runId}/approve`, async (route) => {
    const response = await page.request.get(`/api/runs/${runId}`);
    await route.fulfill({ json: await response.json() });
  });
  return { context, page };
}

/** Opens the publish dialog from the Draft tab's footer. */
async function publishDialog(page: Page) {
  await page.locator(".review-footer").getByRole("button", { name: workspace.footer.approvePr }).click();
  const dialog = page.getByRole("dialog", { name: workspace.publish.title });
  // Approval reads the server's checks before the dialog opens; a busy machine takes its time.
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(workspace.publish.factsLoading)).toHaveCount(0, { timeout: 30_000 });
  return dialog;
}

/** Fails on serious or critical axe issues inside `include`. */
async function expectAccessible(page: Page, include: string) {
  const { violations } = await new AxeBuilder({ page }).include(include).analyze();
  const problems = violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .flatMap((violation) => violation.nodes.map((node) => `${violation.id} at ${node.target.join(" ")}`));
  expect(problems).toEqual([]);
}

test("a clean Learn-by-hand run: no AI draft or agent line, the facts list and the record with the claim", async ({ browser }) => {
  test.setTimeout(120_000);
  const project = await startRealProject({
    reviewed: true,
    appSettings: { alwaysDiscloseAi: true, skipUnderstandingCheck: true },
    run: byHandRun(),
  });
  const { context, page } = await open(browser, project);
  try {
    const template = "## Summary\n\n## How I tested it\n";
    await page.route(`**/api/runs/${runId}/by-hand/template`, (route) =>
      route.fulfill({ json: { templates: [{ path: ".github/pull_request_template.md", content: template }] } }),
    );
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    const guide = page.locator(".draft-guidance-panel");
    await expect(guide.getByRole("heading", { name: draft.guidance.title })).toBeVisible();
    // No AI draft and no AI line to switch on, although "Always add" is on.
    await expect(page.getByRole("button", { name: draft.guidance.generate.first })).toHaveCount(0);
    await expect(page.getByRole("switch")).toHaveCount(0);
    const body = page.getByRole("textbox", { name: workspace.draft.bodyLabel });
    await expect(body).not.toHaveValue(new RegExp(aiDisclosureLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // The facts list, and the note to write the AI note yourself.
    const helpers = guide.getByRole("region", { name: record.helpers });
    await expect(helpers.getByRole("heading", { name: record.facts })).toBeVisible();
    await expect(helpers).toContainText(record.cli({ cli: "Claude Code 2.1.292", model: "claude-sonnet-4-5" }));
    await expect(helpers).toContainText("Help you used: explanations (1) and answers (2).");
    await expect(helpers).toContainText(record.claim);
    await expect(helpers).toContainText(record.otherTools);
    await expect(helpers.getByRole("note")).toHaveText(record.ownWords);
    await expect(helpers.locator("li button, li a")).toHaveCount(0);
    // The checklist row opens the record.
    const row = page.locator(".publish-checklist details.byhand-record");
    await row.locator("summary", { hasText: record.title }).click();
    await expect(row).toContainText(`${record.claim} ${record.quotes}`);
    await expect(row).toContainText("BELL PR ran your tests 2 times; your first prediction after each change was right 2 of 2 times.");
    await expectAccessible(page, ".draft-workspace");

    // The publish dialog: the record with the claim and what BELL can't see.
    const dialog = await publishDialog(page);
    const shown = dialog.getByRole("region", { name: record.title });
    await expect(shown).toContainText(record.claim);
    await expect(shown).toContainText(record.quotes);
    await expect(shown).toContainText("BELL PR can't see other tools you used, such as editor autocomplete or another chat.");
    await expect(dialog.getByText(record.fitted({ kinds: "explanations and answers" }))).toHaveCount(0);
    await expectAccessible(page, "[role=dialog]");
    await dialog.getByRole("button", { name: workspace.publish.back }).click();

    // The project's template goes in verbatim; the facts never do.
    const before = await body.inputValue();
    await helpers.getByRole("button", { name: record.template }).click();
    const after = await body.inputValue();
    expect(after).toContain(template);
    expect(after.replace(template, "").replace(/\n/g, "")).toBe(before.replace(/\n/g, ""));
    expect(after).not.toContain(record.claim);
  } finally {
    await context.close();
    await project.stop();
  }
});

test("an unclean Learn-by-hand run's record gives the reason and no claim", async ({ browser }) => {
  test.setTimeout(120_000);
  const project = await startRealProject({
    reviewed: true,
    appSettings: { skipUnderstandingCheck: true },
    run: byHandRun({ agents: [agent("lead", "Guide"), agent("member-1", "Teammate"), agent("reviewer", "Reviewer")] }),
  });
  const { context, page } = await open(browser, project);
  try {
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    const reason = record.unclean({ reason: record.reasons.agents });
    const row = page.locator(".publish-checklist details.byhand-record");
    await row.locator("summary").click();
    await expect(row).toContainText(reason);
    await expect(row).not.toContainText(record.claim);
    await expect(page.locator(".draft-guidance-panel")).not.toContainText(record.claim);
    const dialog = await publishDialog(page);
    const shown = dialog.getByRole("region", { name: record.title });
    await expect(shown).toContainText(reason);
    await expect(shown).not.toContainText(record.claim);
    await expect(shown).not.toContainText(record.quotes);
  } finally {
    await context.close();
    await project.stop();
  }
});

test("a fitted run's quoted confirm stands beside the record, with no reason field, and Publish waits for its tick", async ({ browser }) => {
  test.setTimeout(120_000);
  const rule = "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
  const carveOut = "This policy does not apply to other uses of AI, such as researching APIs or algorithms, static analysis, or debugging.";
  const helpLock = {
    kinds: ["explain", "answer", "test"],
    at,
    rulesCheckedAt: at,
    rules: [
      {
        kind: "ban",
        path: "docs/devel/code-provenance.rst",
        line: 3,
        quote: rule,
        allows: [{ line: 9, quote: carveOut, kinds: ["explain", "answer", "test"] }],
      },
    ],
  };
  const quoted: DraftCheck = {
    id: "by-hand-rules",
    kind: "confirm",
    message:
      "The project declines AI-generated contributions, and its own text says some uses of AI are fine. BELL PR is quoting the project, not deciding for it: the maintainers decide whether your change fits.",
    details: [
      "Maintainers decide what their rules cover; BELL PR only quotes them. If you're not sure, ask the project's people.",
      `docs/devel/code-provenance.rst:3: "${rule}"`,
      `The same rules say: docs/devel/code-provenance.rst:9: "${carveOut}"`,
      "Fitted at the start, the guide offered only explanations, answers, and test help. BELL PR's agents had no write access and gave you no code for this change. You used: explanations and answers.",
      "BELL PR can't see other tools you used, such as editor autocomplete.",
    ],
  };
  const project = await startRealProject({
    reviewed: true,
    appSettings: { skipUnderstandingCheck: true },
    run: byHandRun({}, { helpLock }),
  });
  const { context, page } = await open(browser, project);
  try {
    // The server's checks, as the quoted confirm's decision (W2G) gives them; later with other words.
    const requoted: DraftCheck = { ...quoted, details: [quoted.details[0], `docs/devel/code-provenance.rst:4: "${rule} This applies to all files."`] };
    let changed = false;
    await page.route(`**/api/runs/${runId}/preflight`, (route) => route.fulfill({ json: { checks: [changed ? requoted : quoted] } }));
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    // The Draft tab's checklist shows the server's quoted confirm in the rules row.
    await expect(page.locator('[data-row="rules"]')).toContainText(quoted.message);
    const dialog = await publishDialog(page);
    const rules = dialog.locator("fieldset", { has: page.locator("legend", { hasText: workspace.publish.groups.rules }) });
    // The record first, then the confirm with every quote on the page.
    await expect(rules.locator(":scope > section.byhand-record")).toContainText(record.fitted({ kinds: "explanations, answers, and test help" }));
    const confirm = rules.locator("label", { hasText: quoted.message });
    for (const detail of quoted.details) await expect(confirm).toContainText(detail);
    const order = await rules.evaluate((fieldset) => {
      const section = fieldset.querySelector(":scope > section.byhand-record");
      const label = fieldset.querySelector(":scope > label");
      return !!section && !!label && !!(section.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    // A confirm, never an override: no reason field.
    await expect(dialog.locator("textarea")).toHaveCount(0);
    await expect(dialog.getByText(workspace.publish.overrideLabel)).toHaveCount(0);
    const submit = dialog.getByRole("button", { name: workspace.publish.submit });
    await expect(submit).toBeDisabled();
    await confirm.getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
    await expectAccessible(page, "[role=dialog]");
    // A refused publish reads the checks again: a quoted confirm whose words changed is unticked.
    changed = true;
    await page.route(`**/api/runs/${runId}/publish`, (route) => route.fulfill({ status: 409, json: { error: "The project's rules changed." } }));
    await submit.click();
    await expect(dialog.getByRole("alert").filter({ hasText: "The project's rules changed." })).toBeVisible();
    await expect(confirm).toContainText(requoted.details[1]);
    await expect(confirm.getByRole("checkbox")).not.toBeChecked();
    await expect(submit).toBeDisabled();
  } finally {
    await context.close();
    await project.stop();
  }
});

test("a Learn-by-hand run's dialog says when the server's checks couldn't be read, and reads them again", async ({ browser }) => {
  test.setTimeout(120_000);
  const project = await startRealProject({ reviewed: true, appSettings: { skipUnderstandingCheck: true }, run: byHandRun() });
  const { context, page } = await open(browser, project);
  try {
    // The server's checks can't be read until `failing` is turned off.
    let failing = true;
    await page.route(`**/api/runs/${runId}/preflight`, (route) =>
      failing ? route.fulfill({ status: 500, json: { error: "The checks failed." } }) : route.continue(),
    );
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    const dialog = await publishDialog(page);
    // An unknown is never a pass: the dialog says so, and Submit stays off.
    const alert = dialog.getByRole("alert").filter({ hasText: record.unchecked });
    await expect(alert).toBeVisible();
    await expect(dialog.getByRole("button", { name: workspace.publish.submit })).toBeDisabled();
    await expectAccessible(page, "[role=dialog]");
    failing = false;
    await alert.getByRole("button", { name: workspace.check.retry }).click();
    await expect(alert).toHaveCount(0);
    await expect(dialog.getByRole("region", { name: record.title })).toContainText(record.claim);
    // The retry button is gone; the focus stays in the dialog.
    await expect(dialog.locator("#publish-checks-title")).toBeFocused();
  } finally {
    await context.close();
    await project.stop();
  }
});

test("Check again reads the rules again from the dialog, says when it couldn't, and keeps the focus in the dialog", async ({ browser }) => {
  test.setTimeout(120_000);
  const rule = "We decline AI-generated contributions.";
  const carveOut = "Asking an AI questions about the code is fine.";
  const before = "2026-10-01T00:00:00.000Z";
  const helpLock = {
    kinds: ["explain", "answer"],
    at,
    rulesCheckedAt: before,
    rules: [{ kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: rule, allows: [{ line: 5, quote: carveOut, kinds: ["explain", "answer"] }] }],
  };
  const project = await startRealProject({ reviewed: true, appSettings: { skipUnderstandingCheck: true }, run: byHandRun({}, { helpLock }) });
  const { context, page } = await open(browser, project);
  try {
    // The project's rules as read before the run started; reading them again first fails, then works.
    const rules = (checkedAt: string) => ({
      checkedAt,
      findings: [{ kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: rule, contribution: true }],
      filesRead: ["CONTRIBUTING.md"],
    });
    await page.route("**/api/repos", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { repos: { id: string }[] };
      await route.fulfill({ response, json: { ...body, repos: body.repos.map((repo) => ({ ...repo, contributionRules: rules(before) })) } });
    });
    let refreshed = 0;
    await page.route("**/api/repos/*/contribution-rules/refresh", (route) =>
      ++refreshed === 1
        ? route.fulfill({ status: 502, json: { error: "GitHub didn't answer." } })
        : route.fulfill({ json: { rules: rules(new Date().toISOString()) } }),
    );
    // The server's checks: a block while the rules are unread since the run started, then the quoted confirm.
    const ban: DraftCheck = { id: "ai-ban", kind: "block", message: "BELL PR won't publish this run here yet.", details: ["Why.", `CONTRIBUTING.md:3: "${rule}"`] };
    const quoted: DraftCheck = { id: "by-hand-rules", kind: "confirm", message: "The project declines AI-generated contributions, and its own text says some uses of AI are fine.", details: ["Why.", `CONTRIBUTING.md:3: "${rule}"`] };
    await page.route(`**/api/runs/${runId}/preflight`, (route) => route.fulfill({ json: { checks: refreshed > 1 ? [quoted] : [ban] } }));
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    const dialog = await publishDialog(page);
    const block = dialog.getByRole("alert").filter({ hasText: ban.message });
    const again = block.getByRole("button", { name: mission.rules.checkAgain });
    await again.click();
    // A failed read says why and keeps the button, and the focus on it.
    await expect(block).toContainText(mission.rules.couldntCheck({ reason: "GitHub didn't answer." }));
    await expect(again).toBeFocused();
    await expect(dialog.getByRole("button", { name: workspace.publish.submit })).toBeDisabled();
    await again.click();
    // Read again: the block gives way to the quoted confirm, and the focus stays in the dialog.
    await expect(block).toHaveCount(0);
    await expect(dialog.getByRole("checkbox", { name: quoted.message })).toBeVisible();
    await expect(dialog.locator("#publish-checks-title")).toBeFocused();
    await expectAccessible(page, "[role=dialog]");
  } finally {
    await context.close();
    await project.stop();
  }
});

test("an agent run's dialog leaves the focus where it is when the server's checks change", async ({ browser }) => {
  test.setTimeout(120_000);
  const project = await startRealProject({ reviewed: true, appSettings: { skipUnderstandingCheck: true }, run: { status: "approved", approvedFingerprint: "e2e-approved" } });
  const { context, page } = await open(browser, project);
  try {
    // After a refused publish the dialog reads the checks again, and they bring a confirm when `release` says so.
    const confirm: DraftCheck = { id: "project-rules", kind: "confirm", message: "Rules to weigh.", details: ["Why."] };
    let changed = false;
    let release = () => {};
    const later = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/runs/${runId}/preflight`, async (route) => {
      if (changed) await later;
      await route.fulfill({ json: { checks: changed ? [confirm] : [] } });
    });
    await page.route(`**/api/runs/${runId}/publish`, (route) => route.fulfill({ status: 409, json: { error: "Not now." } }));
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    const dialog = await publishDialog(page);
    changed = true;
    await dialog.getByRole("button", { name: workspace.publish.submit }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Not now." })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    release();
    await expect(dialog.getByRole("checkbox", { name: confirm.message })).toBeVisible();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  } finally {
    await context.close();
    await project.stop();
  }
});

test("a quoted confirm whose words change is never sent ticked, not even by a click as they appear", async ({ browser }) => {
  test.setTimeout(120_000);
  const rule = "We decline AI-generated contributions.";
  const helpLock = { kinds: ["explain", "answer"], at, rulesCheckedAt: at, rules: [{ kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: rule, allows: [] }] };
  const quoted: DraftCheck = { id: "by-hand-rules", kind: "confirm", message: "The project declines AI-generated contributions.", details: ["Why.", `CONTRIBUTING.md:3: "${rule}"`] };
  const requoted: DraftCheck = { ...quoted, details: ["Why.", `CONTRIBUTING.md:4: "${rule} Rewritten."`] };
  const project = await startRealProject({ reviewed: true, appSettings: { skipUnderstandingCheck: true }, run: byHandRun({}, { helpLock }) });
  const { context, page } = await open(browser, project);
  try {
    let changed = false;
    await page.route(`**/api/runs/${runId}/preflight`, (route) => route.fulfill({ json: { checks: [changed ? requoted : quoted] } }));
    const sent: string[][] = [];
    await page.route(`**/api/runs/${runId}/publish`, async (route) => {
      sent.push((route.request().postDataJSON() as { acknowledged: string[] }).acknowledged);
      await route.fulfill({ status: 409, json: { error: "Not now." } });
    });
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    const dialog = await publishDialog(page);
    await dialog.getByRole("checkbox", { name: quoted.message }).check();
    // The moment the new words are on the page, before anything else runs, a click lands on Submit.
    await page.evaluate((words) => {
      const dialog = document.querySelector("[role=dialog]")!;
      const observer = new MutationObserver(() => {
        if (!dialog.textContent?.includes(words)) return;
        observer.disconnect();
        (dialog.querySelector(".modal-actions .button.primary") as HTMLButtonElement).click();
      });
      observer.observe(dialog, { subtree: true, childList: true, characterData: true });
    }, requoted.details[1]);
    changed = true;
    // A refused publish reads the checks again, which bring the new words.
    await dialog.getByRole("button", { name: workspace.publish.submit }).click();
    await expect(dialog).toContainText(requoted.details[1]);
    await expect(dialog.getByRole("checkbox", { name: quoted.message })).not.toBeChecked();
    // Only the first request carried the tick: the one for the words the person read.
    await page.waitForTimeout(500);
    expect(sent).toEqual([["by-hand-rules"]]);
  } finally {
    await context.close();
    await project.stop();
  }
});

test("a refused or failed publish of a Learn-by-hand run says why and keeps the focus in the dialog", async ({ browser }) => {
  test.setTimeout(120_000);
  const project = await startRealProject({ reviewed: true, appSettings: { skipUnderstandingCheck: true }, run: byHandRun() });
  const { context, page } = await open(browser, project);
  try {
    // The server's checks stay the same, so nothing else moves the focus.
    await page.route(`**/api/runs/${runId}/preflight`, (route) => route.fulfill({ json: { checks: [] } }));
    let answer: "refuse" | "drop" = "refuse";
    await page.route(`**/api/runs/${runId}/publish`, (route) =>
      answer === "refuse" ? route.fulfill({ status: 422, json: { error: "Confirm the project's quoted rules first." } }) : route.abort("internetdisconnected"),
    );
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    const dialog = await publishDialog(page);
    const submit = dialog.getByRole("button", { name: workspace.publish.submit });
    for (const next of ["refuse", "drop"] as const) {
      answer = next;
      await submit.click();
      const error = dialog.locator(".inline-error[role=alert]");
      await expect(error).toBeVisible();
      if (next === "refuse") await expect(error).toHaveText("Confirm the project's quoted rules first.");
      else await expect(error).toHaveText(common.errors.serverUnreachable);
      // The focus is still in the dialog, so Tab stays in it too.
      await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    }
  } finally {
    await context.close();
    await project.stop();
  }
});

test("against the real server: no AI draft or AI line, a PR title of the person's own, and approval only after Ready", async ({ browser }) => {
  test.setTimeout(120_000);
  const project = await startRealProject({
    reviewed: true,
    appSettings: { alwaysDiscloseAi: true, skipUnderstandingCheck: true },
    // As the server starts a Learn-by-hand run: no PR title from the task (DESIGN v1.2 F11).
    run: { learnByHand: true, agents: [agent("lead", "Guide")], draft: { title: "", body: "" }, byHand: { events: [] } },
  });
  const context = await browser.newContext({
    baseURL: project.baseURL,
    storageState: project.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  try {
    // The server drafts nothing for a Learn-by-hand run, and nothing on the page offers it.
    const prepare = await page.request.post(`/api/runs/${runId}/draft/prepare`, { data: {} });
    expect(prepare.status()).toBe(409);
    expect(((await prepare.json()) as { error: string }).error).toBe(byHandFlow.draftRefused);
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    await expect(page.locator(".draft-guidance-panel").getByRole("heading", { name: draft.guidance.title })).toBeVisible();
    await expect(page.getByRole("button", { name: draft.guidance.generate.first })).toHaveCount(0);
    // The title starts empty, and the tab asks for the person's own title and description.
    const title = page.getByRole("textbox", { name: workspace.draft.titleLabel });
    const body = page.getByRole("textbox", { name: workspace.draft.bodyLabel });
    await expect(title).toHaveValue("");
    const asks = page.locator(".draft-origin-notice[role=status]", { hasText: workspace.draft.emptyNoticeByHand });
    await expect(asks).toBeVisible();
    // Approval is refused before the person marks the change ready.
    const approve = page.locator(".review-footer").getByRole("button", { name: workspace.footer.approvePr });
    await approve.click();
    await expect(page.locator(".toast-error")).toContainText(byHand.notReady);
    const { files } = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
    const ready = await page.request.post(`/api/runs/${runId}/by-hand/ready`, { data: { changeFingerprint: changeFingerprint(files), review: false } });
    expect(ready.ok()).toBe(true);
    // Ready, but still no title: approval asks for it.
    await page.locator(".toast-error").getByRole("button").click();
    await approve.click();
    await expect(page.locator(".toast-error")).toContainText(serverRun.publish.prTextRequired);
    // The person writes both; the notice goes, and saving never adds the AI line, though "Always add" is on.
    await title.fill("Greet people in their own language");
    await body.fill("## Summary\n\nGreetings come from a table of languages; I wrote and tested it myself.");
    await expect(asks).toHaveCount(0);
    await page.getByRole("button", { name: workspace.draft.save }).click();
    await expect(page.locator(".toast")).toContainText(workspace.notices.draftSaved);
    const saved = await page.request.patch(`/api/runs/${runId}/draft`, {
      data: { title: "Greet people in their own language", body: await body.inputValue(), aiDisclosure: true },
    });
    const { run } = (await saved.json()) as { run: { draft: { title: string; body: string } } };
    expect(run.draft.title).toBe("Greet people in their own language");
    expect(run.draft.body).not.toContain(aiDisclosureLine);
    await expect(body).not.toHaveValue(new RegExp(aiDisclosureLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // Approved on the real server: the publish dialog opens with the record.
    const dialog = await publishDialog(page);
    await expect(dialog.getByRole("region", { name: record.title })).toBeVisible();
  } finally {
    await context.close();
    await project.stop();
  }
});

test("against the real server: a run fitted to a QEMU-shaped project's carve-out gets the quoted confirm, and publishes only with its tick", async ({ browser }) => {
  test.setTimeout(180_000);
  // QEMU's rule and carve-out in the project; the run was fitted to them when it started (as createRun fixes the help set).
  const file = "docs/devel/code-provenance.rst";
  const qemu = readFileSync(path.join(import.meta.dirname, "../server/fixtures/policy/real/qemu-code-provenance.rst"), "utf8");
  const findings = attachCarveOuts(file, qemu, classifyPolicy(file, qemu));
  const started = new Date(Date.now() - 60 * 60_000).toISOString();
  const fitted = byHandRulesCase({ checkedAt: started, findings, filesRead: [file] }, { learningIssue: false, now: started });
  expect(fitted.case).toBe("fitted");
  const project = await startRealProject({
    reviewed: true,
    appSettings: { skipUnderstandingCheck: true },
    extraFiles: [{ path: file, before: qemu, after: qemu }],
    run: {
      learnByHand: true,
      createdAt: started,
      agents: [agent("lead", "Guide"), agent("reviewer", "Reviewer"), agent("tester", "Test analyst")],
      draft: { title: "Greet people in their own language", body: "Greetings come from a table of languages; I wrote and tested it myself." },
      byHand: {
        helpLock: fitted.case === "fitted" ? { ...fitted.lock, at: started } : undefined,
        events: [
          { at: started, kind: "explain", source: "premise" },
          { at: started, kind: "answer", source: "ask" },
        ],
      },
    },
  });
  const context = await browser.newContext({
    baseURL: project.baseURL,
    storageState: project.storageState,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  try {
    // The person marks the change ready, and "Check again" reads the project's rules after the run started.
    const { files } = (await (await page.request.get(`/api/runs/${runId}/diff`)).json()) as { files: { path: string; fingerprint: string }[] };
    expect((await page.request.post(`/api/runs/${runId}/by-hand/ready`, { data: { changeFingerprint: changeFingerprint(files), review: false } })).ok()).toBe(true);
    expect((await page.request.post(`/api/repos/${repoId}/contribution-rules/refresh`, { data: {} })).ok()).toBe(true);
    await page.goto(`/#/runs/${runId}/draft?locale=en`);
    // Approved on the real server; the dialog shows the server's quoted confirm after the record.
    const dialog = await publishDialog(page);
    const rules = dialog.locator("fieldset", { has: page.locator("legend", { hasText: workspace.publish.groups.rules }) });
    await expect(rules.locator(":scope > section.byhand-record")).toContainText(record.fitted({ kinds: "explanations, answers, and test help" }));
    const confirm = rules.locator("label", { hasText: "its own text says some uses of AI are fine" });
    await expect(confirm).toContainText(`${file}:6: "${findings[0].quote}"`);
    await expect(confirm).toContainText(`${file}:10: "${findings[0].allows![0].quote}"`);
    await expect(dialog.locator("textarea")).toHaveCount(0);
    // Every other confirm ticked (the issue's comes with the facts read at approval): Submit still
    // waits for the quoted one, and the server refuses without it.
    const submit = dialog.getByRole("button", { name: workspace.publish.submit });
    await expect(dialog.getByRole("group", { name: workspace.publish.groups.issue })).toBeVisible();
    for (const box of await dialog.getByRole("checkbox").all())
      if (!(await box.evaluate((input) => !!input.closest("label")?.textContent?.includes("its own text says some uses of AI are fine")))) await box.check();
    await expect(submit).toBeDisabled();
    const { checks } = (await (await page.request.get(`/api/runs/${runId}/preflight`)).json()) as { checks: DraftCheck[] };
    const { run } = (await (await page.request.get(`/api/runs/${runId}`)).json()) as { run: { approvedFingerprint: string } };
    const others = checks.filter((check) => check.kind === "confirm" && check.id !== "by-hand-rules").map((check) => check.id);
    const refused = await page.request.post(`/api/runs/${runId}/publish`, {
      headers: { "x-bell-locale": "en" },
      data: { fingerprint: run.approvedFingerprint, acknowledged: others },
    });
    expect(refused.status()).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toContain("its own text says some uses of AI are fine");
    // Ticked, it publishes through the stand-in for GitHub.
    await confirm.getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => ((await (await page.request.get(`/api/runs/${runId}`)).json()) as { run: { status: string } }).run.status, { timeout: 30_000 }).toBe("published");
  } finally {
    await context.close();
    await project.stop();
  }
});

