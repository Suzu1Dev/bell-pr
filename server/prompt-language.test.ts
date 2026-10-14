import test from "node:test";
import assert from "node:assert/strict";
import { locales } from "../shared/i18n/locale.js";
import {
  lengthHint,
  outputLanguage,
  respondIn,
  termsInParentheses,
} from "./prompt-language.js";

test("outputLanguage names English and Taiwan's Traditional Chinese", () => {
  assert.equal(outputLanguage("en"), "English");
  assert.equal(
    outputLanguage("zh-TW"),
    "Traditional Chinese (Taiwan usage)",
  );
});

test("respondIn is one directive sentence in each locale", () => {
  assert.equal(respondIn("en"), "Respond in English.");
  assert.equal(
    respondIn("zh-TW"),
    "Respond in Traditional Chinese (Taiwan usage).",
  );
  assert.doesNotMatch(respondIn("en"), /Chinese/);
});

test("lengthHint counts words in English and characters in Chinese", () => {
  const limits = { words: 8, chars: 25 };
  assert.equal(lengthHint("en", limits), "at most 8 words");
  assert.equal(lengthHint("zh-TW", limits), "at most 25 Chinese characters");
  assert.equal(lengthHint("en", { words: 1, chars: 3 }), "at most 1 word");
  assert.equal(
    lengthHint("zh-TW", { words: 3, chars: 1 }),
    "at most 1 Chinese character",
  );
});

test("termsInParentheses adds the English-terms clause only for zh-TW", () => {
  assert.equal(termsInParentheses("en"), "");
  assert.equal(
    termsInParentheses("zh-TW"),
    " (English terms in parentheses)",
  );
  // Appended to a noun, the zh-TW prompt reads as the existing one does.
  assert.equal(
    `1–3 searchable keywords${termsInParentheses("zh-TW")}`,
    "1–3 searchable keywords (English terms in parentheses)",
  );
  assert.equal(
    `1–3 searchable keywords${termsInParentheses("en")}`,
    "1–3 searchable keywords",
  );
});

test("prompt language text stays English for every locale", () => {
  // Prompts are written in English; only the requested language changes.
  for (const locale of locales) {
    for (const text of [
      outputLanguage(locale),
      respondIn(locale),
      lengthHint(locale, { words: 8, chars: 25 }),
      termsInParentheses(locale),
    ]) {
      assert.match(text, /^[\x20-\x7e]*$/, `${locale}: ${text}`);
    }
  }
});
