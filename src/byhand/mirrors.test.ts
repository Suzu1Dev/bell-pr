// The client mirrors of the respect checks (src/workspace/respect.ts for
// the sample, src/draft/DraftGuidancePanel.tsx for the Draft tab's live
// checklist) fill the Learn-by-hand input under the same rule as the
// server: only a clean Learn-by-hand run gets its copy; an unclean one gets
// the agent run's copy and outcome.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { byHandPreflight } from "../../shared/by-hand";
import { byHandRulesCase } from "../../shared/by-hand-rules";
import { respectChecks, type ContributionRules } from "../../shared/contribution";
import type { DraftCheck } from "../../shared/draft-checks";
import { attachCarveOuts, classifyPolicy } from "../../shared/project-policy";
import { checklistCheck } from "../draft/checklist";
import { getDemo } from "../demo";
import { DraftGuidancePanel } from "../draft/DraftGuidancePanel";
import { assertNoHan, renderEn } from "../test-utils/render";
import type { Run } from "../types";
import { samplePublishChecks } from "../workspace/respect";

const qemu =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
const agentCopy = "The project's rules do not accept AI-assisted contributions, and AI agents wrote this change.";
const byHandCopy = "The project's rules decline AI-generated content. BELL PR's agents had no write access and gave you no code for this change.";

function byHandRun(clean: boolean): Run {
  const run = structuredClone(getDemo("en").run);
  return {
    ...run,
    learnByHand: true,
    agents: run.agents.filter((agent) => ["lead", "reviewer", "tester"].includes(agent.id)),
    team: run.team && { ...run.team, tasks: [] },
    byHand: { events: [{ at: run.createdAt, kind: "explain", source: "premise" }], ...(clean ? {} : { agentWrites: 1 }) },
  };
}

test("the sample's publish checks follow the clean-run rule", () => {
  const text = `# Contributing\n\n${qemu}\n`;
  // Its rules as the server reads them: the client runs no classifier.
  const sample = {
    ...getDemo("en"),
    contributingText: text,
    contributingFindings: attachCarveOuts("CONTRIBUTING.md", text, classifyPolicy("CONTRIBUTING.md", text)),
  };
  const banOf = (run: Run) =>
    samplePublishChecks(sample, run, sample.files, "en").find((check) => check.id === "ai-ban");
  assert.ok(banOf(byHandRun(true))!.message.startsWith(byHandCopy));
  assert.equal(banOf(byHandRun(false))!.message.startsWith(agentCopy), true);
  // The sample itself is an agent run.
  assert.equal(banOf(getDemo("en").run)!.message.startsWith(agentCopy), true);
});

test("the Draft tab's live checklist follows the clean-run rule", () => {
  const rules: ContributionRules = {
    checkedAt: "2026-10-20T00:00:00.000Z",
    findings: [{ kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: qemu, contribution: true }],
    filesRead: ["CONTRIBUTING.md"],
  };
  const render = (run?: Run, checks?: DraftCheck[]) =>
    renderEn(
      createElement(DraftGuidancePanel, {
        preparation: undefined,
        busy: false,
        onGenerate: () => {},
        onApply: () => {},
        draftBody: "Fixes the cap.",
        rules,
        ...(run ? { byHandRun: run } : {}),
        ...(checks ? { checks } : {}),
      }),
    );
  const escape = (text: string) => text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
  // A clean run's rule rows come from the server's list (W2F): until it
  // arrives they wait, and then they say what the server says.
  const waiting = render(byHandRun(true));
  assertNoHan(waiting);
  assert.ok(waiting.includes("The saved draft hasn&#x27;t been checked yet."));
  assert.ok(!waiting.includes(escape(byHandCopy)) && !waiting.includes(escape(agentCopy)));
  const server = respectChecks(
    { body: "Fixes the cap.", rules, learnByHand: byHandPreflight(byHandRun(true), rules.checkedAt, { createdAt: true }) },
    "en",
  );
  const clean = render(byHandRun(true), server);
  assertNoHan(clean);
  assert.ok(clean.includes(escape(byHandCopy)));
  assert.ok(!clean.includes(escape(agentCopy)));
  for (const html of [render(byHandRun(false)), render()]) {
    assert.ok(html.includes(escape(agentCopy)));
    assert.ok(!html.includes("BELL PR&#x27;s agents had no write access"));
  }
});

test("with the real quoted-confirm decision, a clean fitted run's live checklist has the server's rule rows, ids and outcomes", () => {
  // QEMU's rule and carve-out, and Kubernetes' AI Guidance as another file's rules to weigh, read as the rules card reads them.
  const read = (file: string, fixture: string) => {
    const text = readFileSync(path.join(import.meta.dirname, "../../server/fixtures/policy/real", fixture), "utf8");
    return attachCarveOuts(file, text, classifyPolicy(file, text));
  };
  const file = "docs/devel/code-provenance.rst";
  const findings = [...read(file, "qemu-code-provenance.rst"), ...read("CONTRIBUTING.md", "kubernetes-pull-requests.md")];
  const createdAt = "2026-10-20T09:00:00.000Z";
  const now = "2026-10-20T12:00:00.000Z";
  const rulesAt = (checkedAt: string): ContributionRules => ({ checkedAt, findings, filesRead: [file, "CONTRIBUTING.md"] });
  const fitted = byHandRulesCase(rulesAt(createdAt), { learningIssue: false, now: createdAt });
  assert.equal(fitted.case, "fitted");
  const run: Run = {
    ...byHandRun(true),
    createdAt,
    byHand: {
      helpLock: fitted.case === "fitted" ? { ...fitted.lock, at: createdAt } : undefined,
      events: [
        { at: createdAt, kind: "explain", source: "premise" },
        { at: createdAt, kind: "test", source: "test" },
      ],
    },
  };
  const body = "Retries a GET twice after a 503.";
  const outcomes = (checks: readonly DraftCheck[]) =>
    checks.filter(checklistCheck).map((check) => `${check.id}:${check.kind}`).sort();
  const rowsOf = (html: string) =>
    Object.fromEntries([...html.matchAll(/class="draft-checklist-row is-(\w+)" data-row="(\w+)"/g)].map((match) => [match[2], match[1]]));
  // Rules read before the run started (the server blocks: condition d), and after it (the confirm).
  for (const [checkedAt, expected] of [
    ["2026-10-20T08:00:00.000Z", ["ai-ban:block", "ai-disclosure:block", "project-rules:confirm"]],
    ["2026-10-20T10:00:00.000Z", ["ai-disclosure:block", "by-hand-rules:confirm", "project-rules:confirm"]],
  ] as const) {
    const rules = rulesAt(checkedAt);
    // The server's list (publishChecks fills the input with the run's start).
    const server = respectChecks({ body, rules, learnByHand: byHandPreflight(run, now, { createdAt: true }) }, "en");
    assert.deepEqual(outcomes(server), expected);
    // The client's mirror (DraftGuidancePanel: no run start, so the rule rows are left to the server).
    const mirror = respectChecks({ body, rules, learnByHand: byHandPreflight(run, now) }, "en").filter(
      (check) => !["ai-ban", "area-reserved", "by-hand-rules"].includes(check.id),
    );
    assert.deepEqual(outcomes(mirror), outcomes(server.filter((check) => !["ai-ban", "area-reserved", "by-hand-rules"].includes(check.id))));
    // Rendered with the server's list, the rules row says what the server says.
    const html = renderEn(
      createElement(DraftGuidancePanel, {
        preparation: undefined,
        busy: false,
        onGenerate: () => {},
        onApply: () => {},
        draftBody: body,
        rules,
        byHandRun: run,
        checks: server,
      }),
    );
    assertNoHan(html);
    const rulesRow = server.find((check) => check.id === "ai-ban" || check.id === "by-hand-rules")!;
    assert.equal(rowsOf(html).rules, rulesRow.kind);
    for (const check of server.filter(checklistCheck))
      assert.ok(html.includes(check.message.replace(/'/g, "&#x27;").replace(/"/g, "&quot;")), check.message);
  }
});
