import { activeFollowUp, reviewBaseSha } from "../../shared/followups";
import type { Messages } from "../i18n";
import type { Run } from "../types";

/** A different run, round, base or published head starts on the current diff. */
export function diffRoundKey(run: Run) {
  return `${run.id}:${activeFollowUp(run.followUps)?.id ?? ""}:${reviewBaseSha(run) ?? ""}:${run.publishCommit ?? ""}`;
}

export function diffRoundOptions(run: Run, t: Messages["workspace"]["diffRounds"]) {
  const active = activeFollowUp(run.followUps);
  return [
    { value: "current", label: active?.kind === "sync" ? t.currentSync : active ? t.currentRound : t.current },
    { value: "initial", label: t.initial },
    ...(run.followUps ?? []).flatMap((round, index) =>
      round.status === "published" && round.commit
        ? [{ value: round.id, label: round.adopted
          ? t.adopted({ number: index + 1 })
          : round.kind === "sync"
            ? t.sync({ number: index + 1 })
            : t.published({ number: index + 1 }) }]
        : []),
    { value: "all", label: t.all },
  ];
}
