import { useT } from "../i18n";
import "./license.css";

/**
 * The "PRO" chip next to a control that needs Pro. Screen readers hear
 * "Pro feature" instead of the letters.
 */
export function ProBadge({ className }: { className?: string }) {
  const t = useT("license").badge;
  return (
    <span
      className={className ? `pro-badge ${className}` : "pro-badge"}
      role="img"
      aria-label={t.label}
      title={t.label}
    >
      {t.text}
    </span>
  );
}
