import assert from "node:assert/strict";
import test from "node:test";
import { assertNoHan } from "../test-utils/render";
import { getDemo } from ".";
import { demoLearningExport } from "./export";

test("the sample's learning record holds its explanations and the questions asked", () => {
  const demo = getDemo("en");
  const [first] = demo.files;
  const markdown = demoLearningExport(
    { ...demo.run, status: "published", prUrl: "#demo-pr" },
    demo.repo,
    demo.files,
    {
      [`${demo.run.id}:${first.path}`]: [
        { role: "user", content: "Why full jitter?", fingerprint: first.fingerprint },
        { role: "assistant", content: "It spreads the retries.", fingerprint: first.fingerprint },
        { role: "assistant", content: "Could not answer.", failed: true },
      ],
    },
    "en",
  );
  assert.match(markdown, new RegExp(`^# Learning record: ${demo.run.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n`));
  assert.match(markdown, /- Repository: openfetch-sample\/open-fetch/);
  for (const file of demo.files)
    assert.ok(markdown.includes(`### \`${file.path}\``), file.path);
  assert.ok(markdown.includes(first.explanation!.summary));
  assert.match(markdown, /Why full jitter\?/);
  assert.match(markdown, /It spreads the retries\./);
  // A failed turn and the sample PR link are no part of the record.
  assert.doesNotMatch(markdown, /Could not answer/);
  assert.doesNotMatch(markdown, /#demo-pr/);
  assert.match(markdown, /No pull request has been opened yet\./);
  assertNoHan(markdown);
});

test("the zh-TW sample record is worded in zh-TW", () => {
  const demo = getDemo("zh-TW");
  assert.match(
    demoLearningExport(demo.run, demo.repo, demo.files, {}, "zh-TW"),
    /^# 學習紀錄：/,
  );
});
