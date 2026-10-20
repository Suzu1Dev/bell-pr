/**
 * The Draft tab's learning and respect panels, loaded on demand: the draft
 * guide with its live maintainer checklist, "Your words in the PR" and the
 * reviewability snapshot. Each computes its facts here (the rules, the
 * snapshot), so the shared checks load with them and not with the first
 * screen. The panels themselves are the draft workstream's components.
 */
import type { ComponentProps } from "react";
import type { RunUnderstanding } from "../../shared/understanding";
import { getDemo } from "../demo";
import { DraftGuidancePanel } from "../draft/DraftGuidancePanel";
import ReviewabilitySnapshot from "../draft/ReviewabilitySnapshot";
import YourWordsCard from "../draft/YourWordsCard";
import { useLocale } from "../i18n";
import type { DiffFile, Repo, Run } from "../types";
import { changesOf, projectLanguageAllowed, rulesOf } from "./respect";

interface RunFacts {
  run: Run;
  files: DiffFile[];
  repo?: Repo;
  demo: boolean;
}

/** The sample in the UI language, when the run is the sample. */
function useSample(demo: boolean) {
  const [locale] = useLocale();
  return demo ? getDemo(locale) : undefined;
}

/** The draft guide, with the rules, the GitHub facts, the change's size and the check's state. */
export function DraftGuide({
  run,
  files,
  repo,
  demo,
  check,
  ...panel
}: Omit<ComponentProps<typeof DraftGuidancePanel>, "rules" | "facts" | "understanding" | "changes"> &
  RunFacts & { check: { required: boolean; passed: boolean; off: boolean } }) {
  const sample = useSample(demo);
  const facts = run.contributionFacts ?? sample?.contributionFacts;
  const rules = rulesOf(repo, sample);
  return (
    <DraftGuidancePanel
      {...panel}
      demo={demo}
      {...(rules ? { rules } : {})}
      {...(facts ? { facts } : {})}
      understanding={check}
      changes={changesOf(run, files, repo, sample)}
      byHandRun={run}
    />
  );
}

/** "Your words in the PR": the person's explanation and not-tested answer from the check. */
export function YourWords({
  run,
  record,
  body,
  onInsert,
  disabled,
}: {
  run: Run;
  record?: RunUnderstanding;
  body: string;
  onInsert(next: string): void;
  disabled?: boolean;
}) {
  const untested = record?.items?.find((item) => item.id === "untested");
  return (
    <YourWordsCard
      summary={record?.summary?.text}
      untested={untested && !untested.dontKnow ? untested.answer : undefined}
      body={body}
      projectLanguageAllowed={projectLanguageAllowed(run)}
      onInsert={onInsert}
      disabled={disabled}
    />
  );
}

/** How reviewable the change is, with a reason for each weakened test. */
export function Reviewability({
  run,
  files,
  repo,
  demo,
  onSaveReasons,
  onAskSplit,
}: RunFacts & {
  onSaveReasons?(reasons: Record<string, string>): void | Promise<void>;
  onAskSplit?(): void;
}) {
  const snapshot = changesOf(run, files, repo, useSample(demo));
  return (
    <ReviewabilitySnapshot
      snapshot={snapshot}
      weakened={snapshot.weakened}
      reasons={run.reviewability?.testReasons ?? {}}
      onSaveReasons={onSaveReasons}
      // The sample has no agent to ask.
      onAskSplit={demo ? undefined : onAskSplit}
    />
  );
}
