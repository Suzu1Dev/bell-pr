import type { ChatMessage } from "../../shared/chat";
import type { Locale } from "../../shared/i18n/locale";
import { buildSampleLearningExport } from "../../shared/learning-export";
import type { DiffFile, Repo, Run } from "../types";

/**
 * The sample's learning record, built in the browser as the server builds
 * a real run's: the demo run with each file's prewritten explanation and
 * the questions asked here (`messages`, keyed `${runId}:${path}` as the
 * chat keeps them). The sample PR was never opened, so the record names
 * none.
 */
export function demoLearningExport(
  run: Run,
  repo: Repo,
  files: DiffFile[],
  messages: Record<string, ChatMessage[]>,
  locale: Locale,
): string {
  const explanations: NonNullable<Run["explanations"]> = {};
  const conversations: NonNullable<Run["conversations"]> = {};
  for (const file of files) {
    const fingerprint = file.fingerprint ?? "";
    if (file.explanation)
      explanations[file.path] = {
        fingerprint,
        status: "ready",
        content: file.explanation,
      };
    const turns = (messages[`${run.id}:${file.path}`] ?? []).filter(
      (message) => !message.failed,
    );
    if (turns.length)
      conversations[file.path] = {
        fingerprint,
        messages: turns,
        updatedAt: run.createdAt,
      };
  }
  const { prUrl: _prUrl, ...record } = run;
  return buildSampleLearningExport(
    { ...record, explanations, conversations },
    repo,
    locale,
  );
}
