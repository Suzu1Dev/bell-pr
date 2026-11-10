/**
 * The Today feed of the BELL Suite contract (docs/bell-suite.md): the runs
 * that wait for the person or for BELL PR, read from the stored runs.
 */
import { activeFollowUp } from "../shared/followups.js";
import { suiteLimits, type SuiteTodayFeed, type SuiteTodayItem } from "../shared/suite.js";
import type { RunCore } from "../shared/types.js";
import { sm, type ServerMessages } from "./i18n/index.js";
import { suiteObjectId, suiteRunHref, unsafeText } from "./suite-contract.js";

type Detail = keyof ServerMessages["common"]["suite"]["detail"];

/**
 * What the feed says about a run; undefined for a run it leaves out. The
 * first match wins. Published and cancelled runs are left out, and so is a
 * run that was split, which would be counted beside its parts.
 */
function runState(run: RunCore): [SuiteTodayItem["state"], Detail] | undefined {
  if (run.workspaceRemovedAt || run.splitInto?.length) return undefined;
  // Also a follow-up round on its way to GitHub: nothing for the person to do.
  if (run.status === "approved" && run.publishing) return ["waiting", "publishing"];
  // A round answers maintainer feedback or merges the target branch, so the wording names neither.
  if (activeFollowUp(run.followUps)) {
    if (run.status === "running") return ["waiting", "followUpRunning"];
    if (run.status === "review" || run.status === "approved") return ["needs-you", "followUpReady"];
  }
  switch (run.status) {
    case "awaiting_plan":
      return ["needs-you", run.learnByHand ? "byHandPlan" : "planReady"];
    case "review":
      // As in the app's lists: a Learn-by-hand run is the person's turn until its first Ready.
      return [
        "needs-you",
        run.learnByHand && run.team?.phase !== "complete" ? "byHandChange" : "review",
      ];
    case "approved":
      return ["needs-you", "approved"];
    case "failed":
      return ["needs-you", "failed"];
    case "queued":
      return ["waiting", "queued"];
    case "running":
      return ["waiting", "running"];
    default:
      return undefined;
  }
}

/** The latest time the run records: its creation, its last log line or its last follow-up round. */
function updatedAt(run: RunCore): string | undefined {
  const created = Date.parse(run.createdAt);
  if (Number.isNaN(created)) return undefined;
  const round = run.followUps?.at(-1);
  const later = [run.logs.at(-1)?.time, round?.requestedAt, round?.publishedAt]
    .map((time) => Date.parse(time ?? ""))
    .filter((time) => !Number.isNaN(time));
  return new Date(Math.max(created, ...later)).toISOString();
}

const unsafeCharacters = new RegExp(unsafeText.source, "gu");
/** Half of a character pair, as a title cut from the request's first 72 UTF-16 units can end with. */
const loneSurrogates = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** The run's title as one line of plain text within the contract's limit. */
function plainTitle(title: string): string {
  const text = title
    .replace(loneSurrogates, "")
    .replace(unsafeCharacters, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = [...text];
  if (!characters.length) return sm().common.suite.untitled;
  return characters.length > suiteLimits.title
    ? `${characters.slice(0, suiteLimits.title - 1).join("").trimEnd()}…`
    : text;
}

const ascending = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The Today feed for `runs`, in the language in effect. It sends the run's
 * id, title, state and time only: no request text, plan, log line, project
 * name, path, branch, PR address, provider or usage.
 */
export function buildTodayFeed(runs: readonly RunCore[], now = new Date()): SuiteTodayFeed {
  const detail = sm().common.suite.detail;
  const eligible = runs.flatMap((run) => {
    const state = runState(run);
    const updated = updatedAt(run);
    return state && updated && suiteObjectId(run.id)
      ? [{ run, state: state[0], detail: detail[state[1]], updatedAt: updated }]
      : [];
  });
  // What needs the person first, then the newest; the id keeps equal times in one order.
  eligible.sort(
    (a, b) =>
      Number(b.state === "needs-you") - Number(a.state === "needs-you") ||
      ascending(b.updatedAt, a.updatedAt) ||
      ascending(a.run.id, b.run.id),
  );
  const needsYou = eligible.filter((entry) => entry.state === "needs-you").length;
  return {
    schemaVersion: 1,
    appId: "pr",
    generatedAt: now.toISOString(),
    counts: {
      needsYou: Math.min(needsYou, suiteLimits.countMax),
      waiting: Math.min(eligible.length - needsYou, suiteLimits.countMax),
    },
    items: eligible.slice(0, suiteLimits.items).map(({ run, ...entry }) => ({
      sourceApp: "pr",
      type: "run",
      id: run.id,
      title: plainTitle(run.title),
      href: suiteRunHref(run.id),
      ...entry,
    })),
    truncated: eligible.length > suiteLimits.items,
  };
}
