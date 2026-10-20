// Learn by hand's own words and run record on a real (not sample) run
// (DESIGN v1.2 F11, F12, F13): the Draft tab offers no AI draft and no
// agent line, even with "Always add" on, and shows the facts list, which
// nothing inserts; the publish dialog shows the record, with the claim only
// for a run whose history is clean, and the quoted confirm beside it. Each
// test runs its own server (e2e/helpers/real-project.ts) with fake codex,
// claude and gh first on PATH. The approval request answers with the
// seeded approved run, so the dialog opens on it as it is; the PR template
// and, for the quoted confirm, the server's checks are stubbed (the
// template route and the confirm's decision are W2A's and W2G's).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { DraftCheck } from "../shared/draft-checks";
import { aiDisclosureLine } from "../shared/drafts";
import record from "../src/byhand/record/i18n/en";
import draft from "../src/i18n/en/draft";
import workspace from "../src/i18n/en/workspace";
import { runId, startRealProject, type RealProject } from "./helpers/real-project";

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
    // The server's checks, as the quoted confirm's decision (W2G) gives them.
    await page.route(`**/api/runs/${runId}/preflight`, (route) => route.fulfill({ json: { checks: [quoted] } }));
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
  } finally {
    await context.close();
    await project.stop();
  }
});
