import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { LocalOverlap } from "../../shared/team";
import { api } from "../api";
import { useFormat, useT } from "../i18n";
import type { Run } from "../types";
import "./team.css";

/** What GET /api/runs/:id/overlaps returns: the overlaps, and the digest approving sends back for them. */
export interface PlanOverlaps {
  overlaps: LocalOverlap[];
  digest: string;
}

/**
 * The person's other contributions of this project whose files meet the
 * plan, read while the plan waits for approval, again when `busy` ends or
 * `attempt` changes (after each approval attempt) and whenever the plan's
 * files change. `read` is undefined while unread, when the read failed and
 * for a plan other than the one read; `reading` is true until this plan was
 * read once, so approving waits for it. After a failed read, approving
 * checks on the server.
 */
export function usePlanOverlaps(
  run: Pick<Run, "id" | "team" | "byHand">,
  active: boolean,
  busy: boolean,
  attempt = 0,
) {
  const plan = JSON.stringify([
    run.id,
    run.team?.tasks.map((task) => task.files),
    run.byHand?.plan?.steps.map((step) => step.files),
  ]);
  const [read, setRead] = useState<{ plan: string; result?: PlanOverlaps }>();
  useEffect(() => {
    if (!active || busy) return;
    let current = true;
    api<PlanOverlaps>(`/runs/${encodeURIComponent(run.id)}/overlaps`)
      .then((result) => current && setRead({ plan, result }))
      .catch(() => current && setRead({ plan }));
    return () => {
      current = false;
    };
  }, [run.id, active, busy, plan, attempt]);
  const fresh = active && read?.plan === plan;
  return { read: fresh ? read.result : undefined, reading: active && !fresh };
}

/**
 * Other contributions that change files the plan covers, with the paths
 * they share, and the tick that lets the plan be approved anyway.
 */
export function OverlapNotice({
  overlaps,
  confirmed,
  onConfirm,
  disabled,
  byHand = false,
}: {
  overlaps?: readonly LocalOverlap[];
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  disabled: boolean;
  /** A Learn-by-hand plan, which the person changes and confirms instead of approving. */
  byHand?: boolean;
}) {
  // In workspace, as the premise check: the Learn-by-hand plan shows it too.
  const t = useT("workspace").overlap;
  const statuses = useT("common").runStatus;
  const fmt = useFormat();
  if (!overlaps?.length) return null;
  return (
    <section className="overlap-notice" aria-label={t.label}>
      <h3>
        <TriangleAlert size={15} aria-hidden="true" />
        <strong>{t.heading({ count: overlaps.length })}</strong>
      </h3>
      <ul>
        {overlaps.map((overlap) => (
          <li key={overlap.runId}>
            <b>{t.item({ title: overlap.title, status: statuses[overlap.status] ?? overlap.status })}</b>{" "}
            <span>{fmt.list(overlap.paths, { type: "unit" })}</span>
          </li>
        ))}
      </ul>
      <p>{byHand ? t.hintByHand : t.hint}</p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled}
          onChange={(event) => onConfirm(event.target.checked)}
        />
        {byHand ? t.confirmByHand : t.confirm}
      </label>
    </section>
  );
}
