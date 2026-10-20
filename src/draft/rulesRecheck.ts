/**
 * "Check again" in the publish dialog of a Learn-by-hand run (DESIGN v1.2
 * F12 condition d): when a block stands because the project's rules were
 * read before the run started, the person reads them again from the
 * dialog, which then reads the server's checks again.
 */
import { useState } from "react";
import { byHandPreflight } from "../../shared/by-hand";
import type { ContributionRules } from "../../shared/contribution";
import type { DraftCheck } from "../../shared/draft-checks";
import { api, send } from "../api";
import type { Run } from "../types";

/**
 * Whether a Learn-by-hand block in the server's list stands on "the rules
 * weren't read since this run started": a clean run fitted to the
 * project's rules when it started passed conditions (a) and (b) then, so
 * with the rules read before it started, (d) is the condition its ban or
 * reserved-issue block names. Never read from the block's text.
 */
export function namesRulesUnread(run: Run, rules: ContributionRules | undefined, checks: readonly DraftCheck[]) {
  return (
    !!run.byHand?.helpLock &&
    !!byHandPreflight(run, run.createdAt) &&
    !!rules &&
    Date.parse(rules.checkedAt) < Date.parse(run.createdAt) &&
    checks.some((check) => check.kind === "block" && ["ai-ban", "area-reserved"].includes(check.id))
  );
}

/**
 * The dialog's "Check again" for `run` (absent for any other run): POST
 * /api/repos/:id/contribution-rules/refresh, then `reload` the server's
 * checks. Undefined while no block names the rules as unread.
 */
export function useRulesRecheck(
  run: Run | undefined,
  stored: ContributionRules | undefined,
  checks: readonly DraftCheck[] | undefined,
  reload: (id: string, fingerprint?: string) => Promise<void>,
) {
  const [state, setState] = useState<{ checking: boolean; rules?: ContributionRules }>({ checking: false });
  if (!run || !namesRulesUnread(run, state.rules ?? stored, checks ?? [])) return undefined;
  return {
    checking: state.checking,
    async onCheck() {
      setState((previous) => ({ ...previous, checking: true }));
      const read = await api<{ rules?: ContributionRules | null }>(
        `/repos/${encodeURIComponent(run.repoId)}/contribution-rules/refresh`,
        send("POST"),
      ).catch(() => undefined);
      setState((previous) => ({ checking: false, rules: read?.rules ?? previous.rules }));
      await reload(run.id, run.approvedFingerprint);
    },
  };
}
