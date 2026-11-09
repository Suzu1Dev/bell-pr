import { useT } from "../i18n";

/** Standing hint when a local import ignored an origin that had credentials. */
export function OriginIgnoredNotice({ ignored }: { ignored?: boolean }) {
  const messages = useT("repos");
  if (!ignored) return null;
  return (
    <div className="callout" role="note">
      <p>
        {messages.originIgnored} <code>{messages.originIgnoredCommand}</code>
      </p>
    </div>
  );
}
