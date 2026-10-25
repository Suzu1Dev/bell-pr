import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn } from "../test-utils/render";
import type { Repo, Run } from "../types";
import { DraftGuide, Reviewability } from "./DraftLearning";

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
  assert.match(html, /<svg[^>]*class="lucide lucide-loader-circle[^"]* spin"/);
  // The clean run's rule row waits for the server's list instead of the mirror's copy.
  assert.match(html, /data-row="rules">[\s\S]*?The saved draft hasn&#x27;t been checked yet\./);
  assert.doesNotMatch(html, /AI agents wrote this change/);
  // An agent run keeps the suggestion and the mirror's copy.
  const agent = guide({ run: { ...demo.run, contributionFacts: undefined } });
  assert.match(agent, /draft-guidance-generate/);
  assert.match(agent, /AI agents wrote this change/);
});

test("a run fitted to rules that don't name planning help offers no question on how to split it", () => {
  const demo = getDemo("en");
  const lock = (kinds: string[]) => ({ kinds, at: "2026-10-20T09:00:00.000Z", rulesCheckedAt: "2026-10-20T09:00:00.000Z", rules: [] });
  const card = (byHand?: Run["byHand"]) =>
    renderEn(
      createElement(Reviewability, {
        run: { ...demo.run, learnByHand: true, byHand },
        files: demo.files,
        repo: demo.repo,
        demo: false,
        onAskSplit() {},
      }),
    );
  const fitted = card({ helpLock: lock(["explain", "answer", "test"]) });
  assertNoHan(fitted);
  assert.doesNotMatch(fitted, /Ask how to split it/);
  // The same card with planning help in the run's help set, or with every kind of help, keeps the question.
  assert.match(card({ helpLock: lock(["explain", "answer", "plan"]) }), /Ask how to split it/);
  assert.match(card({}), /Ask how to split it/);
  // Whoever answers (the agent or the guide), the card names no agent.
  assert.doesNotMatch(card({}), /ask the agent/);
});

test("an open contribution of two files or more offers to split; the sample, learn-by-hand, published and removed runs do not", () => {
  const demo = getDemo("en");
  const open: Run = { ...demo.run, status: "review", learnByHand: undefined, prUrl: undefined, workspaceRemovedAt: undefined };
  const card = (props: Partial<Run> = {}, files = demo.files, sample = false) =>
    renderEn(
      createElement(Reviewability, {
        run: { ...open, ...props },
        files,
        repo: demo.repo,
        demo: sample,
        onAskSplit() {},
        onSplit() {},
      }),
    );
  const html = card();
  assertNoHan(html);
  assert.match(html, /Split into contributions/);
  assert.doesNotMatch(card({}, demo.files, true), /Split into contributions/);
  assert.doesNotMatch(card({ learnByHand: true }), /Split into contributions/);
  assert.doesNotMatch(card({ prUrl: "https://github.com/octo/widgets/pull/9" }), /Split into contributions/);
  assert.doesNotMatch(card({ workspaceRemovedAt: "2026-10-20T09:00:00.000Z" }), /Split into contributions/);
  assert.doesNotMatch(card({}, demo.files.slice(0, 1)), /Split into contributions/);
});
