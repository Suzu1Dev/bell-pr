import { getCurrentMessages } from "../i18n";
import type { Messages } from "../i18n";
import { activeFollowUp } from "../../shared/followups";
import type { WorkSession } from "../../shared/session";
import type { Run, RunLogEntry } from "../types";

/** The run fields the working session rules read. */
export type SessionRun = Pick<
  Run,
  "status" | "publishing" | "followUps" | "session" | "logs" | "learnByHand"
> & { agents?: Run["agents"] };

const sessionTabStatuses: readonly string[] = [
  "review",
  "approved",
  "published",
  "failed",
  "cancelled",
];

/** The collaboration tab shows for every real run past its first agent turn, and for any run that already has a session. */
export function showSessionTab(run: SessionRun, demo: boolean) {
  return !demo && !run.learnByHand && (!!run.session || sessionTabStatuses.includes(run.status));
}

/** Why a new agent turn cannot start now, or undefined when it can. Mirrors the server's checks. */
export function sessionTurnBlock(
  run: SessionRun,
  messages: Messages["session"]["blocks"] = getCurrentMessages().session.blocks,
): string | undefined {
  if (run.learnByHand) return messages.byHand;
  if (run.session?.running) return messages.running;
  if (run.publishing) return messages.publishing;
  if (run.status === "published") return messages.published;
  if (run.status === "failed" || run.status === "cancelled") return messages.ended;
  if (run.status !== "review" && run.status !== "approved") return messages.active;
  if (activeFollowUp(run.followUps)) return messages.followUp;
  if (run.agents?.some((agent) => agent.status === "running")) return messages.active;
  return undefined;
}

/** The agent's latest message asks the person something and nothing has answered it yet. */
export function sessionAwaitsAnswer(session: WorkSession | undefined) {
  const last = session?.messages.at(-1);
  return last?.role === "agent" && !!last.questions?.length;
}

/** The running turn's own log entries, newest last. Log times and `startedAt` are ISO strings, so they compare as text. */
export function sessionActivity(run: SessionRun, limit = 8): RunLogEntry[] {
  const since = run.session?.startedAt;
  if (!since) return [];
  return run.logs
    .filter((entry) => entry.agent === "session" && entry.time >= since)
    .slice(-limit);
}

/** True when a turn ended or changed the checkout since the previous reading, so the diff must be read again. */
export function sessionMovedFiles(
  previous: { running?: boolean; revision: number } | undefined,
  next: WorkSession | undefined,
) {
  if (!previous || !next) return false;
  return (
    (previous.running === true && !next.running) ||
    next.revision > previous.revision
  );
}
