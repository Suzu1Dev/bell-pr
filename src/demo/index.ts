import type { Locale } from "../../shared/i18n/locale";
import type { DiffFile } from "../types";
import en from "./en";
import type { DemoContent } from "./types";
import zhTW from "./zh-TW";

export type { DemoAnswer, DemoAnswerTopic, DemoContent } from "./types";

const demos: Record<Locale, DemoContent> = { en, "zh-TW": zhTW };

/** The sample project, run and fixtures in one locale. */
export function getDemo(locale: Locale): DemoContent {
  return demos[locale];
}

// The zh-TW fixtures under their old names, for the current UI and the tests
// written before getDemo(); remove each one once nothing imports it.
export const demoRepo = zhTW.repo;
export const demoFiles = zhTW.files;
export const demoRun = zhTW.run;
export const demoInsights = zhTW.insights;
export const demoContributionBrief = zhTW.contributionBrief;
export const demoTeam = zhTW.team;
export const demoDraftPreparation = zhTW.draftPreparation;

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
