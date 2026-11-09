import { useT } from "../i18n";

/** Shown on the repository list and the project page when an origin was ignored. */
export function OriginIgnoredNotice({ ignored }: { ignored?: boolean }) {
  const messages = useT("repos");
  if (!ignored) return null;
  return (
    <div className="callout" role="alert">
      <p>
        {messages.originIgnored} <code>{messages.originIgnoredCommand}</code>
      </p>
    </div>
  );
}
