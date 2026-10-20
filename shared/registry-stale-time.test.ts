// The 90-day line of a checked-list entry is measured in UTC from the day
// its quotes were checked, whatever offset `now` is written with; and the
// rules count as read during the run from the run's own instant on
// (DESIGN v1.2 F12 (b), (d); W2G red team: no false lift).
import assert from "node:assert/strict";
import test from "node:test";
import { byHandRulesDecision, registryStale } from "./by-hand-rules.js";
import type { PolicyFinding } from "./contribution.js";

test("exactly 90 days after the check still lifts, a moment later never, at any offset", () => {
  // 2026-07-22T00:00Z + 90 days = 2026-10-20T00:00Z.
  assert.equal(registryStale("2026-07-22", "2026-10-20T09:00:00+09:00"), false);
  assert.equal(registryStale("2026-07-22", "2026-10-20T09:00:00.001+09:00"), true);
  assert.equal(registryStale("2026-07-22", "2026-10-19T19:00:00-05:00"), false);
  assert.equal(registryStale("2026-07-22", "2026-10-19T19:00:01-05:00"), true);
  assert.equal(registryStale("2026-07-22", "2026-10-20"), false);
  assert.equal(registryStale("2026-07-22", "2026-10-21"), true);
});

test("rules read at the run's own instant count as read during it; a moment before, not", () => {
  const finding: PolicyFinding = {
    kind: "ban",
    path: "CONTRIBUTING.md",
    line: 1,
    quote: "AI-generated contributions are declined.",
    contribution: true,
    allows: [{ line: 3, quote: "It is fine to use AI to understand the code.", kinds: ["explain", "answer"] }],
  };
  const lock = {
    kinds: ["explain" as const, "answer" as const],
    at: "2026-10-20T09:00:00.000Z",
    rulesCheckedAt: "2026-10-20T08:00:00.000Z",
    rules: [{ kind: finding.kind, path: finding.path, line: 1, quote: finding.quote, allows: finding.allows! }],
  };
  const reason = (checkedAt: string, createdAt: string) =>
    byHandRulesDecision(
      { bans: [finding], areas: [], rules: { checkedAt, findings: [finding], filesRead: [] } },
      { helps: ["explain"], helpLock: lock, createdAt, now: "2026-10-20T12:00:00.000Z" },
    ).blocked[0]?.reason ?? "confirm";
  assert.equal(reason("2026-10-20T09:00:00.000Z", "2026-10-20T09:00:00.000Z"), "confirm");
  assert.equal(reason("2026-10-20T18:00:00.000+09:00", "2026-10-20T09:00:00.000Z"), "confirm");
  assert.equal(reason("2026-10-20T08:59:59.999Z", "2026-10-20T09:00:00.000Z"), "rules-unread");
  assert.equal(reason("2026-10-20T17:59:59.999+09:00", "2026-10-20T09:00:00.000Z"), "rules-unread");
});
