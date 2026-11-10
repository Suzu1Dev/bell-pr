import { useT } from "../i18n";
import { CopyCommand } from "../setup/CopyCommand";

/** Standing hint when a local import ignored an origin that had credentials. */
export function OriginIgnoredNotice({ ignored }: { ignored?: boolean }) {
  const messages = useT("repos");
  if (!ignored) return null;
  const command = messages.originIgnoredCommand;
  return (
    <div className="callout origin-ignored" role="note">
      <p>{messages.originIgnored}</p>
      <CopyCommand
        command={command}
        label={messages.originIgnoredReplace}
        copyLabel={messages.originIgnoredReplaceLabel({ command })}
      />
    </div>
  );
}
