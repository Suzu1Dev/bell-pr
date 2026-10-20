/** The rules behind "How a reader sees your change" (ReaderView): what is asked for, and when. */
import type { UnderstandingView } from "../../shared/understanding";
import type { DiffFile } from "../types";

/** Nobody asked for the file's explanation or walkthrough yet; a held-back file gets neither. */
export function unasked(file: DiffFile, part: "explanation" | "walkthrough") {
  const status = part === "explanation" ? file.explanationStatus : file.walkthroughStatus;
  return !file.blocked && !file[part] && (!status || status === "pending");
}

/** What "Show how a reader sees it" asks for: what this file still lacks, and nothing for another file. */
export function readerRequests(file: DiffFile) {
  const status = file.explanationStatus ?? "";
  return {
    explanation: !file.explanation && !["generating", "unavailable"].includes(status),
    walkthrough: unasked(file, "walkthrough"),
  };
}

/**
 * Whether the file may be explained now, by the server's rule (DESIGN v1.2
 * F10): the check is off in Settings, or the file's own question has an
 * answer saved at the file's current version, or the file has no question
 * and every question has one. Not while the check is still loading.
 */
export function readerAllowed(check: UnderstandingView | undefined, file: Pick<DiffFile, "path">) {
  if (!check) return false;
  if (!check.required) return true;
  const answered = (id: string) =>
    !check.missing.some((part) => part.part === "answer" && part.itemId === id);
  const own = check.plan.find((item) => item.path === file.path);
  return own ? answered(own.id) : check.plan.every((item) => answered(item.id));
}
