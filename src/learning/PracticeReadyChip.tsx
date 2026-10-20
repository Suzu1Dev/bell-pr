import { useT } from "../i18n";

/**
 * "N ready" on the sidebar's Learning item, while practice items are due;
 * nothing at 0. Screen readers hear what is ready.
 */
export function PracticeReadyChip({ count }: { count: number }) {
  const t = useT("app").sidebar;
  if (count <= 0) return null;
  const label = t.practiceReadyLabel({ count });
  return (
    <span
      className="nav-count learning-ready"
      role="img"
      aria-label={label}
      title={label}
    >
      {t.practiceReady({ count })}
    </span>
  );
}
