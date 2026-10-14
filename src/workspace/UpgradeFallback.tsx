import { useEffect, useRef, useState } from "react";
import type { ApiErrorBody } from "../../shared/errors";
import type { LicenseSummary } from "../../shared/plans";
import { proRequiredEvent } from "../api";
import { UpgradeDialog } from "../license/UpgradeDialog";

/** Dialogs open now; a `bellpr:pro-required` answer adds one. */
const openDialogs = () => document.querySelectorAll('[role="dialog"]').length;

/**
 * The upgrade dialog for the workspace's Pro controls when the app shell
 * has none mounted. It answers a `bellpr:pro-required` event only if no
 * other dialog opened for it: a shell dialog renders in the same commit as
 * this component's check, so two dialogs never open for one request. Once
 * it has opened, its UpgradeDialog listens for the next events itself.
 */
export function UpgradeFallback({
  demo,
  summary,
}: {
  demo: boolean;
  summary?: LicenseSummary;
}) {
  const [pending, setPending] = useState<ApiErrorBody | null>(null);
  const [first, setFirst] = useState<ApiErrorBody | null>(null);
  const before = useRef(0);
  useEffect(() => {
    const heard = (event: CustomEvent<ApiErrorBody>) => {
      before.current = openDialogs();
      setPending(event.detail ?? { error: "" });
    };
    window.addEventListener(proRequiredEvent, heard);
    return () => window.removeEventListener(proRequiredEvent, heard);
  }, []);
  useEffect(() => {
    if (!pending) return;
    setPending(null);
    if (!first && openDialogs() <= before.current) setFirst(pending);
  }, [pending, first]);
  return first ? (
    <UpgradeDialog demo={demo} summary={summary} initialRequest={first} />
  ) : null;
}
