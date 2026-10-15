import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { DraftGuidancePanel, whyShownTimes } from "./DraftGuidancePanel";
import { draftPreflight, type DraftCheck } from "../../shared/draft-checks";
import { reviewabilitySnapshot } from "../../shared/reviewability";
import { sampleRules as buildSampleRules } from "../mission/respect";
import type { ContributionFacts, ContributionRules } from "../../shared/contribution";
import {
  aiDisclosureLine,
  withAiDisclosure,
  type DraftPreparation,
} from "../../shared/drafts";

const demoDraftPreparation = getDemo("zh-TW").draftPreparation;

type PanelOptions = {
  applied?: boolean;
  demo?: boolean;
  busy?: boolean;
  disabled?: boolean;
  issueUrl?: string;
  aiDisclosure?: boolean;
  alwaysDiscloseAi?: boolean;
  draftBody?: string;
  onAiDisclosureChange?: (on: boolean) => void;
  checks?: DraftCheck[];
  readOnly?: boolean;
  rules?: ContributionRules;
  facts?: ContributionFacts;
  changes?: ReturnType<typeof reviewabilitySnapshot>;
  understanding?: { required: boolean; passed: boolean; off: boolean };
};

const panel = (
  preparation: DraftPreparation | undefined,
  options: PanelOptions = {},
) =>
  createElement(DraftGuidancePanel, {
    ...options,
    preparation,
    busy: options.busy ?? false,
    onGenerate: () => {},
    onApply: () => {},
  });
const render = (preparation: DraftPreparation, applied?: boolean) =>
  renderZh(panel(preparation, { applied }));
/** One row of the maintainer checklist. */
const checklistRow = (html: string, id: string) =>
  new RegExp(`<li class="draft-checklist-row is-\\w+" data-row="${id}">[\\s\\S]*?</div></li>`).exec(html)?.[0] ?? "";
const issueRow = (html: string) => checklistRow(html, "issue");

test("an applied proposal says the editor holds its unrevised text and cannot be applied again", () => {
  const pending = render(demoDraftPreparation);
  assert.match(pending, /套用建議草稿/);
  const applied = render(demoDraftPreparation, true);
  assert.match(applied, /已套用/);
  assert.match(applied, /會原樣送到 GitHub/);
  assert.match(applied, /<button[^>]*disabled=""[^>]*>[\s\S]*?已套用/);
});

test("a project's issue rule is quoted in the checklist's issue row with its source", () => {
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
  assert.match(
    issueRow(html),
    /<p class="draft-guidance-issue-rule" role="note"><strong>這個專案的規範：<\/strong>「All PRs must reference an existing issue\.」<small>來源：CONTRIBUTING\.md。/,
  );
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
  assert.match(html, /<h3 id="draft-checklist-[^"]+"><svg[\s\S]*?<\/svg> The maintainer checklist<\/h3>/);
  // The issue rule and the linked issue moved from the unsaved reminders to the issue row.
  assert.match(issueRow(html), /<strong>This project&#x27;s rule: <\/strong>“Every PR must reference an existing issue\.”/);
  assert.match(issueRow(html), /Source: CONTRIBUTING.md\. Without a linked issue/);
  assert.match(issueRow(html), /<a href="https:\/\/github\.com\/acme\/widgets\/issues\/7" target="_blank" rel="noopener noreferrer">Open the issue you linked/);
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

test(
  "the English demo draft suggestion renders without Han",
  {
    skip:
      getDemo("en") === getDemo("zh-TW") &&
      "the English demo content is not filled in yet",
  },
  () => {
    const { draftPreparation } = getDemo("en");
    for (const demo of [true, false])
      assertNoHan(renderEn(panel(draftPreparation, { demo })));
  },
);

/** Renders in English and checks that no zh-TW text is left. */
const renderEnglish = (
  preparation: DraftPreparation | undefined,
  options: PanelOptions = {},
) => {
  const html = renderEn(panel(preparation, options));
  assertNoHan(html);
  return html;
};
/** The rendered body of the suggested draft's preview. */
const preview = (html: string) =>
  /<div class="draft-guidance-proposal-content">([\s\S]*?)<\/div><\/details>/.exec(html)?.[1] ?? "";
const switchOf = (html: string) =>
  /<input type="checkbox" role="switch"[^>]*>/.exec(html)?.[0] ?? "";
const line = aiDisclosureLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("the AI-assistance disclosure is off by default and the preview leaves the line out", () => {
  const html = renderEnglish(english);
  assert.match(html, /<h3 id="draft-disclosure-[^"]+"><svg[\s\S]*?<\/svg> AI-assistance disclosure<\/h3>/);
  assert.doesNotMatch(switchOf(html), /checked/);
  assert.match(html, /<span>Add an AI-assistance line to the description<\/span><b aria-hidden="true">Off<\/b>/);
  assert.match(html, /The description does not mention AI\. Whether to disclose AI help is your decision\./);
  assert.match(preview(html), /Retries temporary GET failures\./);
  assert.doesNotMatch(html, new RegExp(line));
  // Nothing saves the choice here, so it says what Apply and Save do.
  assert.match(html, /The preview below follows this choice/);
});

test("turning the disclosure on adds the editable line to the preview; off removes it", () => {
  const on = renderEnglish(english, { aiDisclosure: true });
  assert.match(switchOf(on), /checked=""/);
  assert.match(preview(on), new RegExp(`<p>${line}</p>`));
  assert.match(on, new RegExp(`The description ends with this line: “${line}” You can reword it`));
  // A suggestion the server prepared with the line loses it when the toggle is off.
  const withLine: DraftPreparation = {
    ...english,
    proposal: { ...english.proposal!, body: withAiDisclosure(english.proposal!.body) },
  };
  const off = renderEnglish(withLine, { aiDisclosure: false });
  assert.doesNotMatch(switchOf(off), /checked/);
  assert.doesNotMatch(preview(off), new RegExp(line));
  assert.match(preview(off), /npm test/);
  assert.match(preview(renderEnglish(withLine, { aiDisclosure: true })), new RegExp(line));
});

test("the setting turns the disclosure on by default and says so", () => {
  const html = renderEnglish(english, { alwaysDiscloseAi: true });
  assert.match(switchOf(html), /checked=""/);
  assert.match(html, /On by default because of your setting “Always add an AI-assistance note to my pull requests”\./);
  assert.match(preview(html), new RegExp(line));
  // Without the setting passed in, a suggestion that carries the line shows it came from the setting.
  const inferred = renderEnglish({
    ...english,
    proposal: { ...english.proposal!, body: withAiDisclosure(english.proposal!.body) },
  });
  assert.match(switchOf(inferred), /checked=""/);
  assert.match(inferred, /On by default because of your setting/);
  // A saved choice is the person's own: no reason is given for it.
  assert.doesNotMatch(
    renderEnglish(english, { alwaysDiscloseAi: true, aiDisclosure: true }),
    /On by default/,
  );
  assert.doesNotMatch(switchOf(renderEnglish(english, { alwaysDiscloseAi: false })), /checked/);
});

test("a project rule that asks for a disclosure turns it on and is quoted with its source", () => {
  const ruled: DraftPreparation = {
    ...english,
    context: {
      ...english.context!,
      sources: [
        ...english.context!.sources,
        {
          id: "ai-policy",
          kind: "contributing",
          label: "AI_POLICY.md",
          content: "# AI policy\n\nIf you use AI tools, you must disclose it in the pull request.",
        },
      ],
    },
  };
  const html = renderEnglish(ruled);
  assert.match(switchOf(html), /checked=""/);
  assert.match(
    html,
    /<p class="draft-guidance-disclosure-rule" role="note"><strong>This project asks for a disclosure: <\/strong>“If you use AI tools, you must disclose it in the pull request\.”<small>Source: AI_POLICY\.md<\/small><\/p>/,
  );
  // Turned off, the rule stays visible so the person decides knowingly.
  const off = renderEnglish(ruled, { aiDisclosure: false });
  assert.doesNotMatch(switchOf(off), /checked/);
  assert.match(off, /This project asks for a disclosure/);
  assert.match(renderZh(panel(ruled)), /這個專案要求揭露：/);
});

test("without a saved choice the switch shows what the description holds, whatever the rules ask", () => {
  const ruled: DraftPreparation = {
    ...english,
    context: {
      ...english.context!,
      sources: [
        ...english.context!.sources,
        {
          id: "ai-policy",
          kind: "contributing",
          label: "AI_POLICY.md",
          content: "# AI policy\n\nIf you use AI tools, you must disclose it in the pull request.",
        },
      ],
    },
  };
  const body = english.proposal!.body;
  // The rule asks for it, but the description lacks the line: Off, rule shown.
  const lacking = renderEnglish(ruled, { onAiDisclosureChange() {}, draftBody: body });
  assert.doesNotMatch(switchOf(lacking), /checked/);
  assert.match(lacking, /The description does not mention AI\./);
  assert.match(lacking, /This project asks for a disclosure/);
  // The suggestion still carries the line the rule asks for, so Apply adds it.
  assert.match(preview(lacking), new RegExp(line));
  const holding = renderEnglish(ruled, {
    onAiDisclosureChange() {},
    draftBody: withAiDisclosure(body),
  });
  assert.match(switchOf(holding), /checked=""/);
  // The setting only explains an On that the description shows.
  const settingOff = renderEnglish(english, {
    alwaysDiscloseAi: true,
    onAiDisclosureChange() {},
    draftBody: body,
  });
  assert.doesNotMatch(switchOf(settingOff), /checked/);
  assert.doesNotMatch(settingOff, /On by default/);
  // The suggestion the server prepared with the line keeps it, and that
  // preview is what Apply puts in the editor.
  const suggested: DraftPreparation = {
    ...english,
    proposal: { ...english.proposal!, body: withAiDisclosure(body) },
  };
  const settingOn = { alwaysDiscloseAi: true, onAiDisclosureChange() {}, draftBody: body };
  const kept = renderEnglish(suggested, settingOn);
  assert.doesNotMatch(switchOf(kept), /checked/);
  assert.match(preview(kept), new RegExp(`<p>${line}</p>`));
  // A saved choice still decides, for the switch and the suggestion.
  assert.match(
    switchOf(renderEnglish(ruled, { aiDisclosure: true, onAiDisclosureChange() {}, draftBody: body })),
    /checked=""/,
  );
  const declined = renderEnglish(suggested, { ...settingOn, aiDisclosure: false });
  assert.doesNotMatch(preview(declined), new RegExp(line));
});

test("a saved choice is controlled by the draft PATCH callback; read-only panels lock it", () => {
  const wired = renderEnglish(english, { aiDisclosure: true, onAiDisclosureChange() {} });
  assert.match(switchOf(wired), /checked=""/);
  assert.doesNotMatch(wired, /The preview below follows this choice/);
  // Without a proposal, a wired toggle still sets the saved draft's line.
  assert.match(renderEnglish(undefined, { onAiDisclosureChange() {} }), /AI-assistance disclosure/);
  assert.doesNotMatch(renderEnglish(undefined), /AI-assistance disclosure/);
  assert.match(switchOf(renderEnglish(english, { disabled: true })), /disabled=""/);
});

const token = `ghp_${"a".repeat(36)}`;
const preflight = draftPreflight(
  {
    title: "Retry GET requests",
    body: `Adds retries.\n\nDebug token: ${token}\nLogs in /home/someone/project/out.log`,
    localDirectories: ["/home/someone"],
    changedPaths: [".github/workflows/ci.yml", "src/client.ts"],
    commitEmails: ["alex@contributor.dev"],
  },
  "en",
);

test("the preflight lists the secret block first, then the path, workflow and e-mail confirmations", () => {
  assert.deepEqual(
    preflight.map((check) => check.id),
    ["secret", "local-paths", "workflows", "author-email"],
  );
  // Confirmations first in the input: the panel still puts the block on top.
  const html = renderEnglish(english, {
    checks: [...preflight.slice(1), preflight[0]],
  });
  assert.match(html, /<h3 id="draft-preflight-[^"]+"><svg[\s\S]*?<\/svg> Checks before publishing<\/h3>/);
  const items = [
    ...html.matchAll(/<li class="is-(block|confirm)"><span class="draft-guidance-preflight-kind"><svg[\s\S]*?<\/svg>([^<]+)<\/span><strong>([^<]+)<\/strong>/g),
  ].map((match) => [match[1], match[2], match[3]]);
  assert.deepEqual(
    items.map(([kind, label]) => [kind, label]),
    [
      ["block", "Blocks publishing"],
      ["confirm", "Confirm before publishing"],
      ["confirm", "Confirm before publishing"],
      ["confirm", "Confirm before publishing"],
    ],
  );
  for (const check of [preflight[0], ...preflight.slice(1)])
    assert.ok(
      items.some(([, , message]) => message === check.message.replace(/'/g, "&#x27;").replace(/"/g, "&quot;")),
      check.id,
    );
  for (const detail of preflight.flatMap((check) => check.details))
    assert.ok(html.includes(`<li>${detail.replace(/'/g, "&#x27;").replace(/"/g, "&quot;")}</li>`), detail);
  assert.ok(html.includes(".github/workflows/ci.yml"));
  assert.ok(html.includes("/home/someone"));
  // The zh-TW panel labels them in its own words.
  const zh = renderZh(panel(english, { checks: draftPreflight({ body: token }, "zh-TW") }));
  assert.match(zh, /阻擋發布/);
});

test("an empty preflight says nothing needs attention; without checks there is no section", () => {
  assert.match(
    renderEnglish(english, { checks: [] }),
    /No check needs your attention in the saved draft\./,
  );
  assert.doesNotMatch(renderEnglish(english), /draft-guidance-preflight/);
});

test("a published run shows the guidance read-only", () => {
  const html = renderEnglish(english, { readOnly: true, aiDisclosure: true, checks: [] });
  assert.match(html, /This pull request is published\. The guidance stays here for reference\./);
  assert.doesNotMatch(html, /draft-guidance-generate/);
  assert.doesNotMatch(html, /Apply the suggested draft|draft-guidance-apply/);
  assert.match(switchOf(html), /checked=""/);
  assert.match(switchOf(html), /disabled=""/);
  // The checklist is facts, not boxes to tick: nothing in it can be changed.
  assert.equal(html.match(/<li class="draft-checklist-row/g)?.length, 8);
  assert.doesNotMatch(html, /<input(?![^>]*role="switch")[^>]*type="checkbox"/);
  // The suggestion, its sources and the saved draft's checks stay readable.
  assert.match(preview(html), new RegExp(line));
  assert.match(html, /Source documents/);
  assert.match(html, /Checks before publishing/);
  assert.doesNotMatch(renderEnglish(undefined, { readOnly: true }), /draft-guidance-empty/);
});

// The live maintainer checklist.
const sampleEn = getDemo("en");
const sampleRules = buildSampleRules(sampleEn);
const sampleChanges = reviewabilitySnapshot({ files: sampleEn.files, mergedSizes: sampleEn.mergedSizes });
const rowStatuses = (html: string) =>
  Object.fromEntries(
    [...html.matchAll(/<li class="draft-checklist-row is-(\w+)" data-row="(\w+)">/g)].map((match) => [match[2], match[1]]),
  );

test("without facts the checklist rows say Couldn't check, never OK", () => {
  const html = renderEnglish(english, { issueUrl: "https://github.com/acme/widgets/issues/7" });
  assert.deepEqual(rowStatuses(html), {
    rules: "unknown",
    door: "unknown",
    issue: "unknown",
    pacing: "unknown",
    words: "unknown",
    reviewability: "unknown",
    disclosure: "unknown",
    understanding: "unknown",
  });
  assert.equal(html.match(/<span class="draft-checklist-status"><svg[^>]*lucide-circle-help[\s\S]*?<\/svg>Couldn&#x27;t check<\/span>/g)?.length, 8);
  assert.match(checklistRow(html, "rules"), /<strong>The project&#x27;s rules<\/strong><p>BELL PR hasn&#x27;t read this project&#x27;s rules yet\.<\/p>/);
  // Each row says why maintainers care, in one whole sentence.
  assert.match(checklistRow(html, "pacing"), /<p class="draft-checklist-why">Every open pull request waits on a maintainer&#x27;s time/);
  assert.equal(html.match(/<p class="draft-checklist-why">/g)?.length, 8);
});

test("with the sample's rules, facts and changes every row is green", () => {
  const html = renderEnglish(sampleEn.draftPreparation, {
    demo: true,
    draftBody: sampleEn.run.draft.body,
    issueUrl: sampleEn.run.contributionSettings?.issueUrl,
    rules: sampleRules,
    facts: sampleEn.contributionFacts,
    changes: sampleChanges,
    understanding: { required: true, passed: true, off: false },
  });
  assert.deepEqual(new Set(Object.values(rowStatuses(html))), new Set(["ok"]));
  assert.match(checklistRow(html, "door"), /<p>Pull requests: open to you\.<\/p><ul class="draft-checklist-sources"><li>GitHub pull_request_creation_policy: all<\/li><\/ul>/);
  assert.match(checklistRow(html, "pacing"), /Your open PRs here: 0 of 1/);
  assert.match(checklistRow(html, "understanding"), /You explained the change back\./);
  assert.match(html, /Rules read [^<]+2026/);
  assert.match(html, /GitHub read [^<]+2026/);
  // The editor's text without the disclosure the rules ask for blocks that row at once.
  const withoutLine = renderEnglish(sampleEn.draftPreparation, {
    demo: true,
    draftBody: sampleEn.run.draft.body.replace(aiDisclosureLine, ""),
    issueUrl: sampleEn.run.contributionSettings?.issueUrl,
    rules: sampleRules,
    facts: sampleEn.contributionFacts,
    changes: sampleChanges,
  });
  assert.equal(rowStatuses(withoutLine).disclosure, "block");
  assert.match(checklistRow(withoutLine, "disclosure"), /The project requires a disclosure, and publishing waits for it\./);
});

test("a passed check counts with the setting off: the sample's rule on explaining a change asks nothing", () => {
  const props = {
    demo: true,
    draftBody: sampleEn.run.draft.body,
    issueUrl: sampleEn.run.contributionSettings?.issueUrl,
    rules: sampleRules,
    facts: sampleEn.contributionFacts,
    changes: sampleChanges,
  };
  const passed = renderEnglish(sampleEn.draftPreparation, {
    ...props,
    understanding: { required: false, passed: true, off: true },
  });
  assert.deepEqual(new Set(Object.values(rowStatuses(passed))), new Set(["ok"]));
  assert.doesNotMatch(passed, /your understanding check is off/);
  // Not passed with the setting off, the rule asks to be confirmed.
  const off = renderEnglish(sampleEn.draftPreparation, {
    ...props,
    understanding: { required: false, passed: false, off: true },
  });
  assert.equal(rowStatuses(off).understanding, "off");
  assert.match(checklistRow(off, "rules"), /your understanding check is off/);
});

test("the respect checks move from the preflight list to the checklist rows", () => {
  const facts = {
    ...sampleEn.contributionFacts!,
    issue: { ...sampleEn.contributionFacts!.issue!, state: "CLOSED", stateReason: "COMPLETED" },
  };
  const checks = draftPreflight(
    { body: `${sampleEn.run.draft.body}\n\nToken: ${token}`, rules: sampleRules, facts, changes: sampleChanges, issueUrl: "#sample-issue-42" },
    "en",
  );
  assert.deepEqual(checks.map((check) => check.id), ["secret", "issue-closed"]);
  const html = renderEnglish(english, { checks, rules: sampleRules, facts, changes: sampleChanges, issueUrl: "#sample-issue-42" });
  const list = /<section class="draft-guidance-preflight"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.match(list, /<li class="is-block">[\s\S]*Blocks publishing/);
  assert.doesNotMatch(list, /linked issue is closed/);
  assert.equal(rowStatuses(html).issue, "block");
  assert.match(checklistRow(html, "issue"), /The linked issue is closed\. Link an open issue/);
  assert.match(checklistRow(html, "issue"), /GitHub state: CLOSED \(COMPLETED\)/);
  // Only respect checks left: the list says the text is clear and points below.
  const respectOnly = renderEnglish(english, { checks: checks.slice(1), rules: sampleRules, facts, issueUrl: "#sample-issue-42" });
  assert.match(respectOnly, /The checks on the text are clear\. The maintainer checklist below shows the rest\./);
  assert.doesNotMatch(respectOnly, /No check needs your attention/);
});

test("checks made without the facts still leave no row OK against the facts passed in", () => {
  // The editor's checks on the text, before the server's arrive.
  const checks = draftPreflight({ body: sampleEn.run.draft.body, sources: english.context!.sources }, "en");
  assert.ok(!checks.some((check) => check.id === "pacing-max"));
  const facts = {
    ...sampleEn.contributionFacts!,
    pacing: { openPrs: 2, mergedPrs: 0, viewerPermission: "READ" },
  };
  const html = renderEnglish(english, { checks, rules: sampleRules, facts, changes: sampleChanges, issueUrl: "#sample-issue-42" });
  assert.equal(rowStatuses(html).pacing, "block");
  assert.match(checklistRow(html, "pacing"), /Blocks publishing/);
  // The not-required check is the switched-off one, never a block, and
  // publishing asks nothing about it.
  const off = renderEnglish(english, { checks, understanding: { required: false, passed: false, off: false } });
  assert.equal(rowStatuses(off).understanding, "off");
  assert.match(checklistRow(off, "understanding"), /Off/);
});

test("a why sentence folds away after it has been shown 3 times", () => {
  const storage = new Map<string, string>([
    ["bellpr-checklist-why-seen", JSON.stringify({ rules: 3, door: 2 })],
  ]);
  const globals = globalThis as { localStorage?: unknown };
  const saved = globals.localStorage;
  globals.localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };
  try {
    const html = renderEnglish(english);
    assert.match(
      checklistRow(html, "rules"),
      /<details class="draft-checklist-why"><summary>Why maintainers care<\/summary><p>Maintainers write their rules down/,
    );
    assert.match(checklistRow(html, "door"), /<p class="draft-checklist-why">Maintainers decide who may open pull requests/);
  } finally {
    globals.localStorage = saved;
  }
  // Blocked storage keeps every sentence open.
  globals.localStorage = {
    getItem() {
      throw new Error("blocked");
    },
  };
  try {
    assert.equal(renderEnglish(english).match(/<p class="draft-checklist-why">/g)?.length, 8);
  } finally {
    globals.localStorage = saved;
  }
  assert.equal(whyShownTimes, 3);
});

test("the zh-TW checklist uses its own words", () => {
  const html = renderZh(panel(english));
  assert.match(html, /維護者檢查清單/);
  assert.match(html, /無法確認/);
  assert.match(html, /維護者為什麼在意|維護者把規範寫下來/);
});

test("an unlinked description under an issue rule asks to confirm in the issue row, quoting the rule once", () => {
  const checks = draftPreflight({ body: "Adds retries.", sources: english.context!.sources }, "en");
  assert.deepEqual(checks.map((check) => check.id), ["issue"]);
  const html = renderEnglish(english, { checks });
  assert.equal(rowStatuses(html).issue, "confirm");
  assert.match(checklistRow(html, "issue"), /does not reference one\./);
  assert.equal(html.match(/Every PR must reference an existing issue\./g)?.length, 2);
  // Once in the row's sources, once in the source document's own text.
  assert.doesNotMatch(checklistRow(html, "issue"), /draft-guidance-issue-rule/);
  assert.match(html, /The checks on the text are clear\. The maintainer checklist below shows the rest\./);
});
