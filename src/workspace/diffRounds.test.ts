import assert from "node:assert/strict";
import test from "node:test";
import { getDemo } from "../demo";
import en from "../i18n/en/workspace";
import zh from "../i18n/zh-TW/workspace";
import type { FollowUpRound } from "../../shared/followups";
import { diffRoundKey, diffRoundOptions } from "./diffRounds";

test("round choices distinguish published reviews, syncs and takeovers, and never offer unfinished history", () => {
  const sample = getDemo("en").run;
  const base = { requestedAt: sample.createdAt, feedbackUrls: [], parentCommit: "a".repeat(40) };
  const rounds: FollowUpRound[] = [
    { ...base, id: "old", status: "published", commit: "b".repeat(40) },
    { ...base, id: "sync", kind: "sync", status: "published", commit: "c".repeat(40) },
    { ...base, id: "adopted", adopted: true, status: "published", commit: "d".repeat(40) },
    { ...base, id: "discarded", status: "discarded" },
    { ...base, id: "now", status: "review" },
  ];
  const run = { ...sample, followUps: rounds };
  const choices = diffRoundOptions(run, en.diffRounds);
  assert.deepEqual(choices.map((option) => option.value), ["current", "initial", "old", "sync", "adopted", "all"]);
  assert.deepEqual(choices.map((option) => option.label), [
    en.diffRounds.currentRound, en.diffRounds.initial, en.diffRounds.published({ number: 1 }),
    en.diffRounds.sync({ number: 2 }), en.diffRounds.adopted({ number: 3 }), en.diffRounds.all,
  ]);
  assert.equal(diffRoundOptions({ ...run, followUps: rounds.slice(0, -1) }, en.diffRounds)[0].label, en.diffRounds.current);
  assert.equal(diffRoundOptions({ ...run, followUps: [{ ...rounds[4], kind: "sync" }] }, zh.diffRounds)[0].label, zh.diffRounds.currentSync);
  for (const changed of [
    { ...run, id: "other-run" },
    { ...run, publishCommit: "e".repeat(40) },
    { ...run, followUps: [{ ...rounds[4], id: "next-round" }] },
  ]) assert.notEqual(diffRoundKey(changed), diffRoundKey(run));
});
