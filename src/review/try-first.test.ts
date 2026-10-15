import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../api";
import { getDemo } from "../demo";
import {
  attemptError,
  currentAttempt,
  demoSamples,
  dontKnowInput,
  revealInput,
  saveFirst,
} from "./try-first";

test("Show answer saves the answer with its confidence, or a skip when the field is empty", () => {
  assert.deepEqual(revealInput("", "sure"), { skipped: true });
  assert.deepEqual(revealInput("  \n "), { skipped: true });
  assert.deepEqual(revealInput("  Up to 4 seconds. ", "think"), {
    answer: "Up to 4 seconds.",
    confidence: "think",
  });
  // An answer without a confidence is saved; it just cannot count toward the check.
  assert.deepEqual(revealInput("Up to 4 seconds."), { answer: "Up to 4 seconds." });
});

test("I don't know records a missed attempt at Guessing", () => {
  assert.deepEqual(dontKnowInput(""), { confidence: "guess", grade: "missed" });
  assert.deepEqual(dontKnowInput("  something with jitter "), {
    answer: "something with jitter",
    confidence: "guess",
    grade: "missed",
  });
});

test("an attempt is revealed only after its save resolves, and a failed save reveals nothing", async () => {
  let resolve!: () => void;
  const sent: unknown[] = [];
  const save = (input: unknown) => {
    sent.push(input);
    return new Promise<void>((done) => {
      resolve = done;
    });
  };
  let revealed: unknown;
  const reveal = saveFirst({ answer: "Up to 4 seconds.", confidence: "think" as const }, save).then(
    (input) => {
      revealed = input;
    },
  );
  // The save is under way and nothing is revealed, however long it takes.
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  assert.deepEqual(sent, [{ answer: "Up to 4 seconds.", confidence: "think" }]);
  assert.equal(revealed, undefined);
  resolve();
  await reveal;
  assert.deepEqual(revealed, { answer: "Up to 4 seconds.", confidence: "think" });

  const conflict = new ApiError("changed", { status: 409 });
  await assert.rejects(
    saveFirst({ skipped: true }, () => Promise.reject(conflict)),
    (error) => error === conflict,
  );
  // Without onAttempt the attempt stays in the card and shows at once.
  assert.deepEqual(await saveFirst({ grade: "got" }), { grade: "got" });
});

test("a saved attempt counts only for the version of the file it was made on", () => {
  const attempt = { fingerprint: "a".repeat(64), quiz: { skipped: true, at: "2026-10-15T00:00:00.000Z" } };
  assert.equal(currentAttempt(attempt, "a".repeat(64)), attempt);
  assert.equal(currentAttempt(attempt, "b".repeat(64)), undefined);
  // The demo diff has no fingerprints.
  assert.equal(currentAttempt(attempt, undefined), attempt);
  assert.equal(currentAttempt(undefined, "a".repeat(64)), undefined);
});

test("a 409 shows the file-changed message; other failures keep their own", () => {
  const changed = "This file changed.";
  assert.equal(attemptError(new ApiError("Locked", { status: 409 }), changed), changed);
  assert.equal(
    attemptError(new ApiError("The server is unreachable.", { status: 0 }), changed),
    "The server is unreachable.",
  );
  assert.equal(attemptError("boom", changed), changed);
});

test("the demo samples come from the sample project in the UI language", () => {
  for (const locale of ["en", "zh-TW"] as const) {
    const demo = getDemo(locale);
    for (const file of demo.files) {
      const samples = demoSamples(locale, file.path);
      assert.ok(samples.quiz, `${locale} ${file.path} quiz`);
      const quizzes: Record<string, { answer: string }> = demo.quizSamples ?? {};
      assert.equal(samples.quiz, quizzes[file.path].answer);
      assert.ok(samples.road?.guess && samples.road.why, `${locale} ${file.path} road`);
    }
  }
  assert.deepEqual(demoSamples("en", "src/elsewhere.ts"), { quiz: undefined, road: undefined });
});
