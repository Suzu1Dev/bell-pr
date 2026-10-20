/**
 * "Check again" in the publish dialog of a Learn-by-hand run (DESIGN v1.2
 * F12 condition d): when a block stands while the project's rules were
 * read before the run started, the person reads them again from the
 * dialog, which then reads the server's checks again.
 */
import { useState } from "react";
import { byHandPreflight } from "../../shared/by-hand";
import type { ContributionRules } from "../../shared/contribution";
import type { DraftCheck } from "../../shared/draft-checks";
import { api, send } from "../api";
import { useFormat, useT } from "../i18n";
import type { Run } from "../types";

/**
 * Whether reading the rules again is due for a Learn-by-hand block in the
 * server's list: a clean run fitted to the project's rules when it started
 * passed conditions (a) and (b) then, and with the rules read before it
 * started, (d) fails too. The block may still name an earlier condition
 * (an outdated checked-list entry, changed rules), so nothing here says
 * which one it names; it is never read from the block's text.
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
 * checks. `offer` while reading again is due; after a check, `note` says
 * when the rules were read or why they couldn't be, in the rules card's
 * words. Undefined while there is neither.
 */
export function useRulesRecheck(
  run: Run | undefined,
  stored: ContributionRules | undefined,
  checks: readonly DraftCheck[] | undefined,
  reload: (id: string, fingerprint?: string) => Promise<void>,
) {
  const t = useT("mission").rules;
  const fmt = useFormat();
  const [state, setState] = useState<{ checking: boolean; rules?: ContributionRules; error?: string; read?: true }>({ checking: false });
  const offer = !!run && namesRulesUnread(run, state.rules ?? stored, checks ?? []);
  if (!run || (!offer && !state.read)) return undefined;
  const checkedAt = state.rules && new Date(state.rules.checkedAt);
  return {
    offer,
    checking: state.checking,
    note: !state.read
      ? undefined
      : state.error !== undefined
        ? t.couldntCheck({ reason: state.error })
        : checkedAt && !Number.isNaN(checkedAt.getTime())
          ? t.checkedAt({ date: fmt.dateTime(checkedAt) })
          : undefined,
    async onCheck() {
      setState((previous) => ({ ...previous, checking: true }));
      const read = await api<{ rules?: ContributionRules | null }>(
        `/repos/${encodeURIComponent(run.repoId)}/contribution-rules/refresh`,
        send("POST"),
      ).then(
        (body) => ({ rules: body.rules ?? undefined, error: undefined }),
        (error: unknown) => ({ rules: undefined, error: error instanceof Error ? error.message : "" }),
      );
      setState((previous) => ({ checking: false, read: true, rules: read.rules ?? previous.rules, error: read.error }));
      await reload(run.id, run.approvedFingerprint);
    },
  };
}
