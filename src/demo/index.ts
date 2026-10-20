import type { Locale } from "../../shared/i18n/locale";
import type { DiffFile } from "../types";
import en from "./en";
import type { DemoContent } from "./types";

export type { DemoAnswer, DemoAnswerTopic, DemoContent } from "./types";

// The sample is the app's first state, so its English text comes with the
// app, as the English dictionary does. Another locale's text comes in the
// same file as that locale's dictionary (src/locales).
const demos: Partial<Record<Locale, DemoContent>> = { en };

/** Makes the sample available in a locale whose text has loaded. */
export function registerDemo(locale: Locale, content: DemoContent) {
  demos[locale] = content;
}

/** The sample project, run and fixtures in one locale, once its text has loaded. */
export function getDemo(locale: Locale): DemoContent {
  const demo = demos[locale];
  if (!demo) throw new Error(`The ${locale} sample has not loaded (src/locales).`);
  return demo;
}

/**
 * Local fixture responses, never represented as a model-generated answer.
 * The first topic whose keywords match the question answers, in the order of
 * the locale's table; otherwise the generic answer does.
 */
export function demoAnswer(
  file: DiffFile,
  question: string,
  locale: Locale = "zh-TW",
): string {
  const { answers } = getDemo(locale);
  const generic = answers.find((answer) => answer.topic === "generic");
  const answer =
    answers.find(
      (candidate) =>
        candidate !== generic && candidate.keywords.test(question),
    ) ?? generic;
  if (!answer) throw new Error(`The ${locale} demo has no generic answer.`);
  return answer.text({ file });
}
