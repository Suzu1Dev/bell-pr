import { useT } from "../i18n";
import { CopyCommand } from "../setup/CopyCommand";

const ownerName = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]+$/;

/**
 * `owner/name` from a GitHub origin, with any userinfo removed. Anything
 * else, including a credential that did not parse, is not a command.
 */
function githubSlug(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  url.username = "";
  url.password = "";
  const match = url.pathname.match(
    /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/,
  );
  if (!match || match[2] === "." || match[2] === "..") return null;
  return `${match[1]}/${match[2]}`;
}

/** A GitHub owner and name already on the repository, not the local-import stand-in. */
function namedSlug(owner?: string, name?: string): string | null {
  if (!owner || !name || owner === "local") return null;
  const slug = `${owner}/${name}`;
  return ownerName.test(slug) && name !== "." && name !== ".." ? slug : null;
}

function setUrlCommand(slug: string) {
  return `git remote set-url origin https://github.com/${slug}`;
}

/** Standing hint when a local import ignored an origin that had credentials. */
export function OriginIgnoredNotice({
  ignored,
  origin,
  owner,
  name,
}: {
  ignored?: boolean;
  /** A saved origin. Userinfo is removed and is never copied. */
  origin?: string;
  owner?: string;
  name?: string;
}) {
  const messages = useT("repos");
  if (!ignored) return null;
  const slug = (origin ? githubSlug(origin) : null) ?? namedSlug(owner, name);
  const command = slug ? setUrlCommand(slug) : messages.originIgnoredCommand;
  return (
    <div className="callout origin-ignored" role="note">
      <p>{messages.originIgnored}</p>
      <CopyCommand
        command={command}
        label={slug ? undefined : messages.originIgnoredReplace}
        copyLabel={slug ? undefined : messages.originIgnoredReplaceLabel({ command })}
      />
    </div>
  );
}
