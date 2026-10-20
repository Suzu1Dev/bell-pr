/**
 * "Check again" in the publish dialog of a Learn-by-hand run (DESIGN v1.2
 * F12 condition d): when a block stands because the project's rules were
 * not read since the run started, the person reads them again from the
 * dialog, which then reads the server's checks again.
 */
import { useState } from "react";
import type { ContributionRules } from "../../shared/contribution";
import type { DraftCheck } from "../../shared/draft-checks";
import { api, send } from "../api";
import { useFormat, useT } from "../i18n";
import type { Run } from "../types";

/**
 * Whether reading the rules again is due: a block whose reason (the
 * condition its copy names, set by the server for a clean Learn-by-hand
 * run) is rules not read during the run, fitted or not. Never read from
 * the block's text.
 */
export function rulesUnread(checks: readonly DraftCheck[]) {
  return checks.some((check) => check.kind === "block" && check.reason === "rules-unread");
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
  checks: readonly DraftCheck[] | undefined,
  reload: (id: string, fingerprint?: string) => Promise<void>,
) {
  const t = useT("mission").rules;
  const fmt = useFormat();
  const [state, setState] = useState<{ checking: boolean; rules?: ContributionRules; error?: string; read?: true }>({ checking: false });
  const offer = !!run && rulesUnread(checks ?? []);
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
