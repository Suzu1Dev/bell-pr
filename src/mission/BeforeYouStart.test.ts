import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { act, createElement } from "react";
import type { ContributionFacts, ContributionRules } from "../../shared/contribution";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import BeforeYouStart, { issueCheckDelayMs, type BeforeYouStartProps } from "./BeforeYouStart";
import type { StartCheck } from "./StartConfirm";
import { mount } from "./test-dom";

const demo = getDemo("en");
const issueUrl = "https://github.com/acme/widgets/issues/7";

const view = (props: Partial<BeforeYouStartProps> = {}) =>
  createElement(BeforeYouStart, { repoId: "repo-1", demo: false, ...props });
const chips = (html: string) =>
  [...html.matchAll(/<li class="before-start-chip is-(\w+)"[^>]*><svg[\s\S]*?<\/svg><span>([^<]+)<\/span><\/li>/g)].map(
    (match) => [match[1], match[2]],
  );

test("the sample shows issue #42 without a link, green chips and the maintainer's quote", () => {
  const html = renderEn(view({ demo: true }));
  assertNoHan(html);
  assert.match(html, /<h4 id="before-start-[^"]+">Before you start<span class="before-start-issue">#42 \(sample\)<\/span><\/h4>/);
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /Sample facts; nothing was read from GitHub\./);
  assert.deepEqual(chips(html), [
    ["ok", "Open"],
    ["ok", "Unassigned"],
    ["ok", "No other open PR"],
    // A quote, not a verdict: it may as well ask to wait.
    ["info", "A maintainer said: “PRs welcome for the retry cap.” (Oct 2, 2026)"],
    ["ok", "Your open PRs here: 0 of 1"],
  ]);
  assert.match(html, /title="The budget is a BELL PR default, the same on every plan/);
  assert.match(renderZh(view({ demo: true })), /#42（示範）/);
});

test("without a GitHub issue link nothing is read, and the field says what would be", () => {
  const empty = renderEn(view());
  assertNoHan(empty);
  assert.match(empty, /Link the issue you will work on, and BELL PR checks that it is still open/);
  assert.deepEqual(chips(empty), []);
  assert.match(renderEn(view({ issueUrl: "#42" })), /Issue facts are read for GitHub issue links/);
  // A valid link names the issue and links to it while its facts load.
  assert.match(
    renderEn(view({ issueUrl })),
    /<a class="before-start-issue" href="https:\/\/github\.com\/acme\/widgets\/issues\/7" target="_blank" rel="noopener noreferrer">Issue #7<\/a>/,
  );
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(answer: (url: string) => { status: number; body: unknown }) {
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    const { status, body } = answer(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return requests;
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, issueCheckDelayMs + 100));
  });

const badFacts: ContributionFacts = {
  checkedAt: "2026-10-12T00:00:00.000Z",
  door: { login: "me_myself", viewerPermission: "READ", pullRequestCreationPolicy: "all", hasPullRequests: true },
  issue: {
    url: issueUrl,
    number: 7,
    state: "CLOSED",
    stateReason: "NOT_PLANNED",
    labels: ["good first issue", "bug"],
    assignees: ["other_dev"],
    claims: [{ author: "claimer", at: "2026-10-01T00:00:00.000Z" }, { author: "helper-bot", at: "2026-10-02T00:00:00.000Z", bot: true }],
    otherPrs: [{ number: 9, author: "other_dev", state: "OPEN", willClose: true }, { number: 4, author: "old_dev", state: "CLOSED" }],
  },
  pacing: { openPrs: 2, mergedPrs: 0, viewerPermission: "READ" },
  unknown: ["door: rate limited"],
};
const rules: ContributionRules = {
  checkedAt: "2026-10-10T00:00:00.000Z",
  findings: [{ kind: "ban", path: "AI_POLICY.md", line: 2, quote: "No AI-generated pull requests.", contribution: true }],
  filesRead: ["AI_POLICY.md"],
};

test("the facts for an issue link are read once, after the link stops changing", async () => {
  const requests = stubFetch((url) =>
    url.includes("contribution-check")
      ? { status: 200, body: badFacts }
      : { status: 200, body: { rules } },
  );
  const reports: StartCheck[] = [];
  const mounted = await mount(view({ issueUrl, onFacts: (check) => reports.push(check) }));
  try {
    assert.deepEqual(requests, ["GET /api/repos/repo-1/contribution-rules"]);
    await settle();
    assert.deepEqual(requests, [
      "GET /api/repos/repo-1/contribution-rules",
      `GET /api/repos/repo-1/contribution-check?issue=${encodeURIComponent(issueUrl)}`,
    ]);
    const text = mounted.text();
    assertNoHan(text);
    for (const chip of [
      "The project's rules don't accept AI-assisted contributions",
      "Closed (not planned)",
      "Assigned to @other_dev",
      "Claimed by @claimer on Oct 1, 2026",
      "Claimed by @helper-bot (a bot) on Oct 2, 2026",
      "@other_dev's PR #9 would close this",
      "@old_dev's PR #4 was closed without merging",
      "Labelled for newcomers: good first issue",
      "Your open PRs here: 2 of 1",
      "Couldn't check whether pull requests are open to you: rate limited",
    ])
      assert.ok(text.includes(chip), chip);
    // The door read now is open, so it has no chip of its own.
    assert.ok(!text.includes("This repository doesn't take pull requests from you"));
    const tones = mounted.container
      .querySelectorAll((element) => element.tagName === "li")
      .map((element) => element.getAttribute("class"));
    assert.ok(!tones.includes("before-start-chip is-ok"), tones.join());
    const last = reports.at(-1)!;
    assert.deepEqual(last.facts, badFacts);
    assert.deepEqual(last.reasons, [
      { id: "issue-closed" },
      { id: "other-pr", author: "other_dev", number: 9 },
      { id: "ban" },
      { id: "learning" },
      { id: "pacing", open: 2, budget: 1 },
    ]);
    // The same link again: no second read.
    await mounted.rerender(view({ issueUrl: `${issueUrl} `, onFacts: (check) => reports.push(check) }));
    await settle();
    assert.equal(requests.filter((request) => request.includes("contribution-check")).length, 1);
  } finally {
    await mounted.unmount();
  }
  // Unmounted, the dialog hears that nothing needs asking any more.
  assert.deepEqual(reports.at(-1), { reasons: [] });
});

test("before the check route exists, the field says it couldn't check, never a pass", async () => {
  stubFetch(() => ({ status: 404, body: { error: "API endpoint not found." } }));
  const reports: StartCheck[] = [];
  const mounted = await mount(view({ issueUrl, onFacts: (check) => reports.push(check) }));
  try {
    await settle();
    const text = mounted.text();
    assertNoHan(text);
    assert.ok(text.includes("Couldn't check: API endpoint not found."), text);
    assert.ok(text.includes("Check again"));
    // No chip at all: an unanswered check is never shown as a pass.
    assert.deepEqual(
      mounted.container.querySelectorAll((element) => element.tagName === "li"),
      [],
    );
    assert.deepEqual(reports.at(-1), { facts: undefined, reasons: [] });
  } finally {
    await mounted.unmount();
  }
});

test("the sample reads nothing from the server", async () => {
  const requests = stubFetch(() => ({ status: 500, body: {} }));
  const reports: StartCheck[] = [];
  const mounted = await mount(view({ demo: true, issueUrl, onFacts: (check) => reports.push(check) }));
  try {
    await settle();
    assert.deepEqual(requests, []);
    assert.ok(mounted.text().includes("Your open PRs here: 0 of 1"));
    assert.deepEqual(reports.at(-1)?.reasons, []);
    assert.equal(reports.at(-1)?.facts, demo.contributionFacts);
  } finally {
    await mounted.unmount();
  }
});
