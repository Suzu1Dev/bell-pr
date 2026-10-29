import { safeLink, WebLink } from "../../review/MarkdownContent";
import type { HelpChannel } from "../../../shared/contribution";

/**
 * "Ask a human" (DESIGN v1.2 F6, F14, headroom item 1): the project's own
 * places to ask people, as its files name them, with where; web links only.
 */
export function Channels({ channels = [] }: { channels?: HelpChannel[] }) {
  const links = channels.filter((channel) => /^https?:\/\//.test(channel.url));
  if (!links.length) return null;
  return (
    <ul>
      {links.map((channel) => (
        <li key={channel.url}>
          <WebLink href={safeLink(channel.url) || undefined} target="_blank" rel="noreferrer">
            {channel.label}
          </WebLink>{" "}
          {channel.path && <code>{`${channel.path}:${channel.line ?? 1}`}</code>}
        </li>
      ))}
    </ul>
  );
}
