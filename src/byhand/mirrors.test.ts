// The client mirrors of the respect checks (src/workspace/respect.ts for
// the sample, src/draft/DraftGuidancePanel.tsx for the Draft tab's live
// checklist) fill the Learn-by-hand input under the same rule as the
// server: only a clean Learn-by-hand run gets its copy; an unclean one gets
// the agent run's copy and outcome.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { ContributionRules } from "../../shared/contribution";
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
  const sample = { ...getDemo("en"), contributingText: `# Contributing\n\n${qemu}\n` };
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
  const render = (run?: Run) =>
    renderEn(
      createElement(DraftGuidancePanel, {
        preparation: undefined,
        busy: false,
        onGenerate: () => {},
        onApply: () => {},
        draftBody: "Fixes the cap.",
        rules,
        ...(run ? { byHandRun: run } : {}),
      }),
    );
  const escape = (text: string) => text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
  const clean = render(byHandRun(true));
  assertNoHan(clean);
  assert.ok(clean.includes(escape(byHandCopy)));
  assert.ok(!clean.includes(escape(agentCopy)));
  for (const html of [render(byHandRun(false)), render()]) {
    assert.ok(html.includes(escape(agentCopy)));
    assert.ok(!html.includes("BELL PR&#x27;s agents had no write access"));
  }
});
