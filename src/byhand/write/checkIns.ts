import { repeatFailure, type ByHandRecord, type TestRun } from "../../../shared/by-hand";

/** The repeated failures this tab already checked in, by step and failing run. */
const sent = new Set<string>();

/**
 * The repeated-failure check-in a step's card should send now (DESIGN v1.2
 * F6): once per step and failing test run. Not again when the panel mounts
 * once more (another tab and back), and not after a reload either, where
 * the run's own `checkIns` already hold it. Returns the key to send under,
 * or undefined.
 */
export function repeatCheckIn(stepId: string | undefined, tests: readonly TestRun[], checkIns: ByHandRecord["checkIns"] = []) {
  if (!repeatFailure(tests)) return undefined;
  const last = Math.max(...tests.filter((test) => !test.reported).map((test) => Date.parse(test.at)));
  const key = `${stepId ?? ""}:${last}`;
  const recorded = checkIns.some((entry) => entry.signal === "repeat-failure" && entry.stepId === stepId && Date.parse(entry.at) >= last);
  return recorded || sent.has(key) ? undefined : key;
}

/** Marks a check-in as sent from this tab; false when it already was. */
export const claimCheckIn = (key: string) => !sent.has(key) && !!sent.add(key);
