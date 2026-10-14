import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { demoDraftPreparation } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { DraftGuidancePanel } from "./DraftGuidancePanel";
import type { DraftPreparation } from "../../shared/drafts";

const panel = (
  preparation: DraftPreparation | undefined,
  options: { applied?: boolean; demo?: boolean; busy?: boolean; issueUrl?: string } = {},
) =>
  createElement(DraftGuidancePanel, {
    preparation,
    busy: options.busy ?? false,
    demo: options.demo,
    issueUrl: options.issueUrl,
    onGenerate: () => {},
    onApply: () => {},
    applied: options.applied,
  });
const render = (preparation: DraftPreparation, applied?: boolean) =>
  renderZh(panel(preparation, { applied }));

test("an applied proposal says the editor holds its unrevised text and cannot be applied again", () => {
  const pending = render(demoDraftPreparation);
  assert.match(pending, /套用建議草稿/);
  const applied = render(demoDraftPreparation, true);
  assert.match(applied, /已套用/);
  assert.match(applied, /會原樣送到 GitHub/);
  assert.match(applied, /<button[^>]*disabled=""[^>]*>[\s\S]*?已套用/);
});

test("a project's issue rule is quoted next to the issue reminders with its source", () => {
  const preparation: DraftPreparation = {
    ...demoDraftPreparation,
    context: {
      ...demoDraftPreparation.context!,
      sources: [
        ...demoDraftPreparation.context!.sources,
        {
          id: "base:CONTRIBUTING.md",
          kind: "contributing",
          label: "CONTRIBUTING.md",
          content: "**All PRs must reference an existing issue.**",
        },
        {
          id: "base:.github/workflows/pr-standards.yml",
          kind: "automation",
          label: ".github/workflows/pr-standards.yml",
          content: "on: pull_request",
        },
      ],
    },
  };
  const html = render(preparation);
  assert.match(html, /這個專案的規範/);
  assert.match(html, /All PRs must reference an existing issue\./);
  assert.match(html, /來源：CONTRIBUTING\.md/);
  assert.match(html, /自動檢查/);
  // The demo sources carry no issue rule, so no quote is invented.
  assert.doesNotMatch(render(demoDraftPreparation), /這個專案的規範/);
});

test("the zh-TW template note and commit explanation keep their inline markup", () => {
  const html = render({
    ...demoDraftPreparation,
    proposal: { ...demoDraftPreparation.proposal!, rules: [] },
  });
  assert.match(html, /依照「<strong>[^<]+<\/strong>」整理段落。/);
  assert.match(html, /附上 <code>Signed-off-by: 姓名 &lt;email&gt;<\/code>，表示/);
});

// English sample data with the demo's structure, so English renders carry no
// Chinese fixture text.
const english: DraftPreparation = {
  status: "ready",
  fingerprint: "english-sample",
  context: {
    checkedAt: "2026-10-03T01:36:00.000Z",
    baseSha: "0123456789abcdef",
    warnings: ["Only the first 40 lines of CONTRIBUTING.md were read."],
    sources: [
      {
        id: "contributing",
        kind: "contributing",
        label: "CONTRIBUTING.md",
        path: "CONTRIBUTING.md",
        url: "https://example.com/acme/widgets/blob/main/CONTRIBUTING.md",
        content: "Use Conventional Commits.\n\nEvery PR must reference an existing issue.",
      },
      {
        id: "template",
        kind: "template",
        label: "PR template",
        path: ".github/PULL_REQUEST_TEMPLATE.md",
        content: "## Summary\n\n## Testing",
      },
      { id: "guide", kind: "documentation", label: "Docs", content: "Keep it short." },
      { id: "maintainer", kind: "maintainer", label: "Maintainer note", content: "Thanks!" },
      { id: "example", kind: "example", label: "Merged PR #12", content: "Example." },
      { id: "ci", kind: "automation", label: "pr-check.yml", content: "on: pull_request" },
    ],
  },
  proposal: {
    title: "Retry idempotent GET requests with backoff",
    body: "## Summary\n\nRetries temporary GET failures.\n\n## Testing\n\n- npm test",
    policy: "repository",
    summary: "Follows the template's Summary and Testing sections.",
    rules: [
      { text: "Use a Conventional Commits subject.", sourceId: "contributing", quote: "Use Conventional Commits." },
      { text: "Mention how you tested.", sourceId: "missing", quote: "Describe your testing." },
    ],
    checklist: ["Link the issue this PR fixes."],
    templateSourceId: "template",
    commitMessageSuggestion: {
      message: "feat(client): retry idempotent GET requests",
      rationale: "The guidelines ask for Conventional Commits.",
      sources: ["contributing", "missing"],
    },
  },
};

test("the English panel renders every state, label and source kind without Han", () => {
  const states: [string, DraftPreparation | undefined, Parameters<typeof panel>[1]][] = [
    ["empty", undefined, {}],
    ["empty demo", undefined, { demo: true }],
    ["generating", { ...english, status: "generating" }, {}],
    ["busy", english, { busy: true }],
    ["failed", { ...english, status: "failed", proposal: undefined }, {}],
    ["stale", { ...english, status: "stale" }, {}],
    ["ready", english, { issueUrl: "https://github.com/acme/widgets/issues/7" }],
    ["applied", english, { applied: true }],
    ["demo", english, { demo: true }],
    [
      "linux",
      { ...english, proposal: { ...english.proposal!, policy: "linux", rules: [] } },
      {},
    ],
    [
      "no rules",
      { ...english, proposal: { ...english.proposal!, rules: [] } },
      {},
    ],
    [
      "no template",
      { ...english, proposal: { ...english.proposal!, rules: [], templateSourceId: "none" } },
      {},
    ],
  ];
  for (const [name, preparation, options] of states) {
    const html = renderEn(panel(preparation, options));
    assert.doesNotThrow(() => assertNoHan(html), name);
  }
  const html = renderEn(panel(english, { issueUrl: "https://github.com/acme/widgets/issues/7" }));
  assert.match(html, /Write a PR that maintainers can follow/);
  assert.match(html, /Follows the project&#x27;s rules/);
  assert.match(html, /What was read and what to confirm/);
  assert.match(html, /No source to check against/);
  assert.match(html, /Apply the suggested draft/);
  assert.match(html, /Suggested commit message/);
  assert.match(html, /Based on:<a /);
  assert.match(html, /Why do projects ask for <code>type\(scope\)<\/code> or a sign-off\?/);
  assert.match(html, /<code>Signed-off-by: Your Name &lt;email&gt;<\/code>/);
  assert.match(html, /Base <code>0123456<\/code>/);
  assert.match(html, /Checked <time dateTime="2026-10-03T01:36:00.000Z">/);
  assert.match(html, /Source documents <small>6 documents<\/small>/);
  for (const kind of [
    "Project documentation",
    "Maintainer guidance",
    "Reference example",
    "Automated check",
    "Template used for this draft",
  ])
    assert.match(html, new RegExp(kind), kind);
  assert.match(html, /aria-label="CONTRIBUTING.md, original text"/);
  assert.match(html, /Before you publish, say hello to the community/);
  assert.match(html, /<strong>This project&#x27;s rule: <\/strong>“Every PR must reference an existing issue\.”/);
  assert.match(html, /Source: CONTRIBUTING.md\. Without a linked issue/);
  assert.match(html, /Open the issue you linked/);
  assert.match(
    renderEn(panel({ ...english, proposal: { ...english.proposal!, rules: [] } })),
    /Sections follow the template “<strong>PR template<\/strong>”\./,
  );
  const linux = renderEn(
    panel({ ...english, proposal: { ...english.proposal!, policy: "linux", rules: [] } }),
  );
  assert.match(linux, /Default writing principles/);
  assert.match(linux, /A specific, concise title that says what changes\./);
  assert.match(linux, /Linux principles · adapted for PRs/);
  assert.match(
    linux,
    /The motivation, change and verification principles in the <a href="https:\/\/docs\.kernel\.org\/[^"]+"[^>]*>Linux kernel&#x27;s patch submission guidelines <svg/,
  );
  assert.match(renderEn(panel(undefined)), /Suggest a draft from the project&#x27;s rules/);
  assert.match(renderEn(panel(undefined, { demo: true })), /View the sample draft suggestion/);
  assert.match(
    renderEn(panel({ ...english, status: "failed", proposal: undefined })),
    /The draft suggestion could not be prepared this time\.[\s\S]*Try again/,
  );
});
