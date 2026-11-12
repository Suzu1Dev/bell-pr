import { useT } from "../i18n";

/** Shown when the page was opened without the API token, or the API answers 401. */
export function ApiTokenEmptyState() {
  const t = useT("common");
  const message = t.errors.apiTokenRequired;
  return (
    <div className="empty-state" role="status">
      <p>{message}</p>
      <p>{t.pair.explainer}</p>
      <a className="button primary" href="/pair">{t.pair.open}</a>
    </div>
  );
}
