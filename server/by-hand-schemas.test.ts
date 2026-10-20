// The Learn-by-hand agent output schemas (server/by-hand-schemas.ts) and the
// prompt builder stubs (server/prompts/by-hand.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import {
  guideAnswerJsonSchema,
  guideAnswerSchema,
  orientationJsonSchema,
  orientationSchema,
  parseByHandAnswer,
  reviewerAnswerJsonSchema,
  reviewerAnswerSchema,
  withSchemaFile,
} from "./by-hand-schemas.js";
import {
  byHandPlanPrompt,
  byHandReviewerPrompt,
  byHandTesterPrompt,
  guidePrompt,
  planQuestionsPrompt,
} from "./prompts/by-hand.js";
import { AppError } from "./types.js";

/** Every object closed and every property required, as the CLIs' strict modes want. */
function assertStrict(schema: unknown, where = "$") {
  if (!schema || typeof schema !== "object") return;
  const node = schema as Record<string, unknown>;
  if (node.type === "object" || (Array.isArray(node.type) && node.type.includes("object"))) {
    assert.equal(node.additionalProperties, false, where);
    assert.deepEqual([...(node.required as string[])].sort(), Object.keys(node.properties as object).sort(), where);
  }
  for (const [key, value] of Object.entries(node))
    if (typeof value === "object") assertStrict(value, `${where}.${key}`);
}

test("the JSON Schemas are strict, and the zod schemas accept what they describe", () => {
  for (const schema of [orientationJsonSchema, guideAnswerJsonSchema, reviewerAnswerJsonSchema]) assertStrict(schema);
  const orientation = {
    summary: "A 503 fails every GET at once.",
    steps: [{ title: "Find where the client throws", files: ["src/client.ts"] }],
    readFirst: [{ path: "src/client.ts", startLine: 36, endLine: 48, why: "Every request goes through get()." }],
    premise: null,
  };
  assert.deepEqual(parseByHandAnswer(orientationSchema, JSON.stringify(orientation)), orientation);
  const guide = {
    text: "Look at where get() reads the status.",
    question: null,
    refs: [{ path: "src/client.ts", line: 41, endLine: null }],
    quotes: [{ path: "src/client.ts", startLine: 40, endLine: 42, from: "base", anchor: "if (response.status" }],
    options: null,
    topic: "change",
    askedForCode: false,
  };
  assert.deepEqual(parseByHandAnswer(guideAnswerSchema, `\`\`\`json\n${JSON.stringify(guide)}\n\`\`\``), guide);
});

test("the guide's answer carries no code of its own, and the review has no fix field", () => {
  const guide = {
    text: "Wrap it in a loop.",
    question: null,
    refs: [],
    quotes: [],
    options: null,
    topic: "change",
    askedForCode: true,
  };
  // A quote is a reference: text in it is not accepted.
  assert.throws(
    () => parseByHandAnswer(guideAnswerSchema, JSON.stringify({ ...guide, quotes: [{ path: "a.ts", startLine: 1, endLine: 2, from: "base", anchor: null, text: "for (;;) {}" }] })),
    (error: AppError) => error.statusCode === 422,
  );
  assert.throws(() => parseByHandAnswer(guideAnswerSchema, JSON.stringify({ ...guide, code: "x" })), AppError);
  assert.throws(() => parseByHandAnswer(guideAnswerSchema, JSON.stringify({ ...guide, options: [{ name: "One", tradeoff: "Only one." }] })), AppError);
  const review = {
    verified: "Your last run passed.",
    checked: ["the retry loop"],
    findings: [
      {
        path: "src/client.ts",
        line: 44,
        observed: "A POST is retried too.",
        evidence: { type: "rule", path: "CONTRIBUTING.md", line: 30, quote: "Only idempotent requests may be retried." },
        why: "A retried POST can create twice.",
        question: "Which methods should the loop cover?",
        dimension: "risk",
      },
    ],
  };
  assert.deepEqual(parseByHandAnswer(reviewerAnswerSchema, JSON.stringify(review)), review);
  assert.throws(() => parseByHandAnswer(reviewerAnswerSchema, JSON.stringify({ ...review, findings: [{ ...review.findings[0], fix: "Check the method." }] })), AppError);
  // A bare "looks good" checked nothing.
  assert.throws(() => parseByHandAnswer(reviewerAnswerSchema, JSON.stringify({ ...review, checked: [] })), AppError);
  assert.throws(() => parseByHandAnswer(reviewerAnswerSchema, JSON.stringify({ ...review, findings: Array(4).fill(review.findings[0]) })), AppError);
  assert.equal("fix" in (reviewerAnswerJsonSchema.properties.findings.items.properties as object), false);
  assert.throws(() => parseByHandAnswer(reviewerAnswerSchema, "not json"), (error: AppError) => error.statusCode === 422);
});

test("a schema file lives only for its turn", async () => {
  let kept = "";
  const answer = await withSchemaFile(guideAnswerJsonSchema, async (schemaPath) => {
    kept = schemaPath;
    assert.deepEqual(JSON.parse(await readFile(schemaPath, "utf8")), guideAnswerJsonSchema);
    return "done";
  });
  assert.equal(answer, "done");
  await assert.rejects(access(kept));
});

test("each prompt builder stub already names the output language", () => {
  const run = { prompt: "Retry a GET twice after a 503." };
  const plan = { steps: [{ id: "s1", title: "Read retry.ts" }], savedAt: "2026-10-20T00:00:00.000Z" };
  for (const [locale, language] of [["en", "Respond in English."], ["zh-TW", "Respond in Traditional Chinese (Taiwan usage)."]] as const) {
    for (const prompt of [
      byHandPlanPrompt(locale, run),
      planQuestionsPrompt(locale, { run, plan }),
      guidePrompt(locale, { run, kind: "hint", rung: 1, diff: "", history: [] }),
      byHandReviewerPrompt(locale, { run, diff: "" }),
      byHandTesterPrompt(locale, { run, diff: "" }),
    ])
      assert.ok(prompt.endsWith(language), prompt);
  }
});
