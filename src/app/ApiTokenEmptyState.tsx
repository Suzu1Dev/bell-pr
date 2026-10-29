import { useT } from "../i18n";

/** Shown when the page was opened without the API token, or the API answers 401. */
export function ApiTokenEmptyState() {
  const message = useT("common").errors.apiTokenRequired;
  return (
    <div className="empty-state" role="status">
      <p>{message}</p>
    </div>
  );
}
