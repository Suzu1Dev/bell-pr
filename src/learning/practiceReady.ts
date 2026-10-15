/**
 * The sidebar's "N ready" on the Learning item: how many practice items
 * are due now, from GET /api/learning/practice. It is the practice deck's
 * only nudge. The deck sends `practiceChangedEvent` after it recorded a
 * grade, so the count is read again.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import { getDemo } from "../demo";
import { useLocale } from "../i18n";

export const practiceChangedEvent = "bellpr:practice-changed";

/**
 * The number of due practice items: 0 while unknown and when the request
 * fails. It reads again when `refreshKey` changes (a run was approved or
 * published, say) and after the deck recorded a grade. In the demo
 * (`demo=play`) it is the sample's count, without a request.
 */
export function usePracticeReady({
  demo,
  refreshKey,
}: {
  demo: boolean;
  refreshKey: string;
}): number {
  const [locale] = useLocale();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (demo) return;
    let current: AbortController | undefined;
    const load = () => {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      api<{ items?: unknown[] }>("/learning/practice", {
        signal: controller.signal,
      }).then(
        (data) => {
          if (!controller.signal.aborted)
            setCount(Array.isArray(data?.items) ? data.items.length : 0);
        },
        () => {
          if (!controller.signal.aborted) setCount(0);
        },
      );
    };
    load();
    window.addEventListener(practiceChangedEvent, load);
    return () => {
      current?.abort();
      window.removeEventListener(practiceChangedEvent, load);
    };
  }, [demo, refreshKey]);
  return demo ? (getDemo(locale).practiceSample?.length ?? 0) : count;
}
