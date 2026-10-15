import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import type { ContributionRules, PolicyFinding } from "../../shared/contribution";
import { getDemo } from "../demo";
import { demoContributionRules } from "../demo/rules";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import ContributionRulesCard, {
  findingEffect,
  type ContributionRulesCardProps,
} from "./ContributionRulesCard";
import { mount } from "./test-dom";

const demo = getDemo("en");
const sampleRules = demoContributionRules(demo);

const card = (props: Partial<ContributionRulesCardProps> = {}) =>
  createElement(ContributionRulesCard, { repoId: "repo-1", demo: false, ...props });
const english = (props: Partial<ContributionRulesCardProps> = {}) => {
  const html = renderEn(card(props));
  assertNoHan(html);
  return html;
};

const finding = (kind: PolicyFinding["kind"], contribution = true): PolicyFinding => ({
  kind,
  path: "docs/AI_POLICY.md",
  line: 12,
  quote: `A ${kind} rule.`,
  contribution,
});
const stored: ContributionRules = {
  checkedAt: "2026-10-10T08:00:00.000Z",
  door: { hasPullRequests: true, pullRequestCreationPolicy: "all", viewerPermission: "READ" },
  findings: [finding("ban"), finding("ban", false), finding("disclose"), finding("agent")],
  filesRead: ["CONTRIBUTING.md", "docs/AI_POLICY.md", ".github/PULL_REQUEST_TEMPLATE.md"],
  orgDefaults: "acme/.github",
  unknown: ["mergedSizes: gh is not signed in"],
};

test("the sample card quotes its 3 rules with path:line and what publishing does", () => {
  const html = english({ demo: true });
  assert.match(html, /<h2 id="rules-card-title">Before you contribute<\/h2>/);
  assert.match(html, /Sample: the project and its CONTRIBUTING\.md are fictional/);
  assert.match(html, /<p class="rules-card-door is-ok"><svg[\s\S]*?<\/svg>Pull requests: open to you<\/p>/);
  assert.equal(html.match(/<figure>/g)?.length, 3);
  assert.match(html, /3 rules quoted from the 2 files BELL PR read\./);
  for (const quote of [
    "Open an issue before changing behavior.",
    "You must be able to explain your change in review.",
    "If you used AI tools, say so in the PR description.",
  ])
    assert.ok(html.includes(`<blockquote>${quote}</blockquote>`), quote);
  assert.match(html, /<code>CONTRIBUTING\.md:\d+<\/code><span class="rules-card-effect is-block">[\s\S]*?Blocks publishing<\/span><span>Publishing waits until the description says that AI helped\.<\/span>/);
  assert.match(html, /<span class="rules-card-effect is-confirm">[\s\S]*?Asks you to confirm<\/span><span>Publishing asks you to confirm when no issue is linked\.<\/span>/);
  assert.match(html, /<span class="rules-card-effect is-info">[\s\S]*?For your information<\/span><span>Your understanding check covers it\./);
  // The sample has nothing to check again, and no date that means anything.
  assert.doesNotMatch(html, /Check again|Checked /);
  assert.deepEqual(sampleRules.findings.map((entry) => entry.kind), ["issue-first", "understand", "disclose"]);
});

test("stored rules are grouped by kind, each with the effect publishing has", () => {
  const html = english({ rules: stored });
  const groups = [...html.matchAll(/<section class="rules-card-group"><h3>([^<]+)<\/h3>/g)].map((match) => match[1]);
  assert.deepEqual(groups, ["AI-assisted contributions", "Saying that AI helped", "Notes addressed to AI agents"]);
  assert.match(html, /4 rules quoted from the 3 files BELL PR read\./);
  assert.match(html, /BELL PR&#x27;s agents write every change, so it won&#x27;t publish one here\./);
  assert.match(html, /Publishing asks you to decide whether it covers AI-assisted contributions\./);
  assert.match(html, /<code>docs\/AI_POLICY\.md:12<\/code>/);
  assert.match(html, /Files BELL PR read · 3/);
  assert.match(html, /<li><code>\.github\/PULL_REQUEST_TEMPLATE\.md<\/code><\/li>/);
  assert.match(html, /Includes the default files of acme\/\.github\./);
  // A part BELL PR does not name keeps its reason, never its id.
  assert.match(html, /Couldn&#x27;t read part of the project&#x27;s rules: gh is not signed in</);
  assert.doesNotMatch(html, /mergedSizes/);
  assert.match(html, /Checked [^<]*2026/);
  assert.match(html, /Check again<\/button>/);
  assert.equal(findingEffect(finding("ban")), "block");
  assert.equal(findingEffect(finding("ban", false)), "confirm");
  assert.equal(findingEffect(finding("own-words")), "block");
  assert.equal(findingEffect(finding("area")), "block");
  assert.equal(findingEffect(finding("issue-first")), "confirm");
  assert.equal(findingEffect(finding("understand")), "info");
});

test("the three explicit states: found, not found in the files read, couldn't check", () => {
  const notFound = english({ rules: { ...stored, findings: [] } });
  assert.match(
    notFound,
    /<p class="rules-card-state">Not found in the 3 files BELL PR read\. Some projects publish their rules on a website or wiki; check before you publish\.<\/p>/,
  );
  const nothingRead = english({ rules: { ...stored, findings: [], filesRead: [] } });
  assert.match(nothingRead, /No contributing guide, policy or pull request template was there to read\./);
  for (const html of [notFound, nothingRead]) assert.doesNotMatch(html, /no policy/i);
  // The door, by GitHub's own fields.
  const door = (value: ContributionRules["door"]) =>
    /<p class="rules-card-door is-(\w+)"><svg[\s\S]*?<\/svg>([^<]+)<\/p>/.exec(english({ rules: { ...stored, door: value } }))?.slice(1);
  assert.deepEqual(door({ pullRequestCreationPolicy: "collaborators_only", viewerPermission: "READ" }), [
    "bad",
    "Pull requests: collaborators only (you can practise here, not publish)",
  ]);
  assert.deepEqual(door({ archived: true }), ["bad", "Archived: the project takes no changes (you can practise here, not publish)"]);
  assert.deepEqual(door({ hasPullRequests: false }), ["bad", "Pull requests: turned off (you can practise here, not publish)"]);
  assert.deepEqual(door(undefined), ["unknown", "Couldn&#x27;t check whether pull requests are open to you."]);
  assert.match(
    english({ rules: { ...stored, door: undefined, unknown: ["door: gh is not installed"] } }),
    /Couldn&#x27;t check whether pull requests are open to you: gh is not installed/,
  );
});

test("the zh-TW card names the vocabulary in its own words", () => {
  const html = renderZh(card({ demo: true }));
  assert.match(html, /貢獻之前/);
  assert.match(html, /Pull Request：對你開放/);
  assert.match(html, /會阻擋發布/);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(answer: (url: string, method: string) => { status: number; body: unknown }) {
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    const { status, body } = answer(url, method);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return requests;
}

test("before the rules route exists, the card says it couldn't check, never a pass", async () => {
  const requests = stubFetch(() => ({ status: 404, body: { error: "API endpoint not found." } }));
  const view = await mount(card());
  try {
    assertNoHan(view.text());
    assert.ok(view.text().includes("Couldn't check: API endpoint not found."), view.text());
    assert.ok(!view.text().includes("Pull requests: open to you"));
    assert.deepEqual(requests, ["GET /api/repos/repo-1/contribution-rules"]);
  } finally {
    await view.unmount();
  }
});

test("rules stored with the repository need no request; a missing set is read once", async () => {
  const requests = stubFetch(() => ({ status: 200, body: { rules: stored } }));
  const withRules = await mount(card({ rules: stored }));
  try {
    assert.ok(withRules.text().includes("4 rules quoted"));
    assert.deepEqual(requests, []);
  } finally {
    await withRules.unmount();
  }
  const view = await mount(card());
  try {
    assert.ok(view.text().includes("4 rules quoted"), view.text());
    assert.deepEqual(requests, ["GET /api/repos/repo-1/contribution-rules"]);
  } finally {
    await view.unmount();
  }
  // A route that answers without rules: not read yet.
  stubFetch(() => ({ status: 200, body: {} }));
  const empty = await mount(card());
  try {
    assert.ok(empty.text().includes("Couldn't check: BELL PR hasn't read this project's rules yet."), empty.text());
  } finally {
    await empty.unmount();
  }
});

test("the sample reads nothing from the server", async () => {
  const requests = stubFetch(() => ({ status: 500, body: {} }));
  const view = await mount(card({ demo: true }));
  try {
    assert.ok(view.text().includes("3 rules quoted"));
    assert.deepEqual(requests, []);
  } finally {
    await view.unmount();
  }
});

test("rule files or default files that could not be read are named in words, never by their ids", () => {
  const unread: ContributionRules = {
    ...stored,
    unknown: [
      "door: GitHub answered with an error.",
      "orgDefaults: GitHub answered with an error.",
      "rules: The project's files could not be read.",
    ],
  };
  const html = english({ rules: unread });
  assert.match(html, /Couldn&#x27;t read the account&#x27;s default contribution files: GitHub answered with an error\./);
  assert.match(html, /Couldn&#x27;t read the project&#x27;s rule files: The project&#x27;s files could not be read\./);
  assert.doesNotMatch(html, /orgDefaults|rules:/);
  const zh = renderZh(card({ rules: unread }));
  assert.match(zh, /無法讀取帳號預設的貢獻檔案：GitHub answered with an error\./);
  assert.doesNotMatch(zh, /orgDefaults/);
});
