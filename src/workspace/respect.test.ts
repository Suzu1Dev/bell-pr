import assert from "node:assert/strict";
import test from "node:test";
import { locales } from "../../shared/i18n/locale";
import { getDemo } from "../demo";
import { sampleRules as missionSampleRules } from "../mission/respect";
import { assertNoHan } from "../test-utils/render";
import {
  changesOf,
  pacingOf,
  projectLanguageAllowed,
  rulesOf,
  samplePublishChecks,
  sampleRules,
} from "./respect";

test("the sample's rules are the ones its own rules card shows", () => {
  for (const locale of locales) {
    const demo = getDemo(locale);
    assert.equal(sampleRules, missionSampleRules, "one implementation");
    assert.deepEqual(rulesOf(undefined, demo), sampleRules(demo));
  }
  // A real repository brings what BELL read from it.
  const rules = { checkedAt: "2026-10-01T00:00:00.000Z", findings: [], filesRead: ["CONTRIBUTING.md"] };
  assert.equal(rulesOf({ ...getDemo("en").repo, contributionRules: rules }), rules);
});

test("the sample publishes with every check passing, and asks to confirm its rule when the check is off", () => {
  for (const locale of locales) {
    const demo = getDemo(locale);
    const run = { ...demo.run, status: "approved" as const };
    assert.deepEqual(samplePublishChecks(demo, run, demo.files, locale), [], locale);
    const off = samplePublishChecks(demo, run, demo.files, locale, true);
    assert.deepEqual(off.map((check) => [check.id, check.kind]), [["project-rules", "confirm"]], locale);
    if (locale === "en") assertNoHan(JSON.stringify(off));
  }
  // The sample's draft without its AI line: the project's own rule blocks it.
  const demo = getDemo("en");
  const bare = { ...demo.run, draft: { ...demo.run.draft, body: "## Summary\n\nRetries GET requests with backoff." } };
  assert.ok(
    samplePublishChecks(demo, bare, demo.files, "en").some(
      (check) => check.id === "ai-disclosure" && check.kind === "block",
    ),
  );
});

test("the snapshot measures the sample's diff against its plan and its merged sizes", () => {
  const demo = getDemo("en");
  const snapshot = changesOf(demo.run, demo.files, undefined, demo);
  assert.equal(snapshot.changedLines, 97);
  assert.equal(snapshot.band, "small");
  assert.deepEqual(snapshot.mergedSizes, demo.mergedSizes);
  assert.deepEqual(snapshot.weakened, []);
});

test("the pacing line says k of the budget, never a count it does not know", () => {
  const demo = getDemo("en");
  assert.deepEqual(pacingOf(demo.contributionFacts), { open: 0, budget: 1, first: true });
  const facts = { checkedAt: "2026-10-01T00:00:00.000Z" };
  assert.equal(pacingOf(undefined), undefined);
  assert.equal(pacingOf({ ...facts, unknown: ["pacing: gh failed"] }), undefined);
  assert.deepEqual(pacingOf({ ...facts, pacing: { openPrs: 1, mergedPrs: 3 } }), { open: 1, budget: 2, first: false });
  // An unknown merged count keeps the smaller budget and claims no first contribution.
  assert.deepEqual(pacingOf({ ...facts, pacing: { openPrs: 1 } }), { open: 1, budget: 1, first: false });
  // People who can write to the repository are not paced.
  assert.equal(pacingOf({ ...facts, pacing: { openPrs: 4, viewerPermission: "WRITE" } }), "exempt");
  assert.equal(pacingOf({ ...facts, door: { viewerPermission: "ADMIN" }, pacing: { openPrs: 4 } }), "exempt");
});

test("your words go into the description as they are only when the project's rules ask for another language", () => {
  const proposal = { title: "Fix retries", summary: "", body: "## Summary", policy: "repository" as const, rules: [], checklist: [], templateSourceId: "" };
  const preparation = (body: string, policy: "repository" | "linux" = "repository") => ({
    draftPreparation: { status: "ready" as const, fingerprint: "f", proposal: { ...proposal, body, policy } },
  });
  assert.equal(projectLanguageAllowed({}), false);
  assert.equal(projectLanguageAllowed(preparation("## Summary\n\nRetries GET requests.")), false);
  // A description the project's rules had written in Japanese.
  assert.equal(projectLanguageAllowed(preparation("## 概要\n\n再試行")), true);
  // BELL's own fallback writing guide is English, whatever the person wrote.
  assert.equal(projectLanguageAllowed(preparation("再試行", "linux")), false);
});
