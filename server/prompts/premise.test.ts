import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { premiseCheckPrompt } from "./premise.js";
import { contributionContext } from "./team.js";
import type { Locale } from "../../shared/i18n/locale.js";
import { outputLanguage, respondIn } from "../prompt-language.js";

const cjk = new RegExp("(?!\\u00B7)[\\p{Script_Extensions=Han}\\u3000-\\u303F\\uFF00-\\uFFEF]", "u");

/**
 * The fixture holds each prompt as its lines. It was recorded in English
 * from the upstream wording (1fb6329) once the prompt took the run's
 * locale, so a failure means the text the premise check receives changed.
 */
async function fixture() {
  const lines = JSON.parse(
    await readFile(
      path.join(import.meta.dirname, "fixtures", "premise-prompts.json"),
      "utf8",
    ),
  ) as Record<string, string[]>;
  return Object.fromEntries(
    Object.entries(lines).map(([key, value]) => [key, value.join("\n")]),
  );
}

const run = {
  prompt: "Assumption (unverified): the caller hands the browser an id it made itself.",
  contributionSettings: undefined,
};

const prompts = (locale: Locale) => ({
  premiseCheckPrompt: premiseCheckPrompt({
    locale,
    contributionContext: contributionContext(run),
    findings: {
      plan: "The only caller already uses the returned id.",
      integration: "The caller uses the returned id.",
      review: null,
      testAnalysis: "No web test.",
    },
    diffContext: "<diff context>",
  }),
  "premiseCheckPrompt:checked": premiseCheckPrompt({
    locale,
    contributionContext: contributionContext({
      ...run,
      team: {
        premise: {
          verdict: "refuted",
          statement: "The caller hands over an id it made.",
          evidence: "id.ts:2 returns the id it was given.",
        },
      },
    }),
    findings: { plan: "", integration: null, review: null, testAnalysis: null },
    diffContext: "<diff context>",
  }),
});

test("the premise check prompt keeps its recorded wording", async () => {
  assert.deepEqual(prompts("en"), await fixture());
});

test("the premise check answers in the run's locale and stays English text", () => {
  const english = prompts("en");
  const chinese = prompts("zh-TW");
  for (const [name, prompt] of Object.entries(english)) {
    assert.doesNotMatch(prompt, cjk, name);
    assert.ok(prompt.startsWith(respondIn("en")), name);
    assert.equal(
      chinese[name as keyof typeof chinese],
      prompt
        .replace(respondIn("en"), respondIn("zh-TW"))
        .replaceAll(` in ${outputLanguage("en")}`, ` in ${outputLanguage("zh-TW")}`),
      name,
    );
  }
  assert.match(english.premiseCheckPrompt, /path:line, with no Markdown and no preamble about how you read; both in English;/);
  // A verdict already found reaches the next check through the shared context.
  assert.match(english["premiseCheckPrompt:checked"], /Premise check by the lead[^\n]*\n\{"verdict":"refuted"/);
});
