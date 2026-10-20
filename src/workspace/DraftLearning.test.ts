import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn } from "../test-utils/render";
import type { Repo, Run } from "../types";
import { DraftGuide } from "./DraftLearning";

test("the Draft tab's guide passes a Learn-by-hand run to the panel, which shows its helpers instead of a suggestion", () => {
  const demo = getDemo("en");
  const repo: Repo = {
    ...demo.repo,
    contributionRules: {
      checkedAt: "2026-10-20T08:00:00.000Z",
      findings: [{ kind: "ban", path: "docs/policy.md", line: 4, quote: "We decline AI-generated contributions.", contribution: true }],
      filesRead: ["docs/policy.md"],
    },
  };
  const run: Run = {
    ...demo.run,
    learnByHand: true,
    agents: demo.run.agents.filter((agent) => agent.id === "lead"),
    byHand: { events: [{ at: "2026-10-20T09:00:00.000Z", kind: "answer", source: "ask" }] },
  };
  const guide = (props: { run: Run }) =>
    renderEn(
      createElement(DraftGuide, {
        ...props,
        files: demo.files,
        repo,
        demo: false,
        check: { required: true, passed: false, off: false },
        busy: false,
        onGenerate: () => {},
        onApply: () => {},
        draftBody: "My own words.",
      }),
    );
  const html = guide({ run });
  assertNoHan(html);
  assert.doesNotMatch(html, /draft-guidance-generate|draft-guidance-empty/);
  // The helpers load with the byhand chunk.
  assert.match(html, /<svg[^>]*class="lucide lucide-loader-circle spin"/);
  // The clean run's rule row waits for the server's list instead of the mirror's copy.
  assert.match(html, /data-row="rules">[\s\S]*?The saved draft hasn&#x27;t been checked yet\./);
  assert.doesNotMatch(html, /AI agents wrote this change/);
  // An agent run keeps the suggestion and the mirror's copy.
  const agent = guide({ run: { ...demo.run, contributionFacts: undefined } });
  assert.match(agent, /draft-guidance-generate/);
  assert.match(agent, /AI agents wrote this change/);
});
