import { safeLink, WebLink } from "../review/MarkdownContent";
import { ExternalLink, Info } from "lucide-react";
import { productLink } from "../../shared/product";
import { useT } from "../i18n";
import { appVersion } from "../version";
import { SettingsGroup, SettingsSectionFrame } from "./controls";

/**
 * About: the version of this build, the About dialog and the product's
 * public links while they are set. The dialog opens over this section, so
 * closing it comes back here; its link keeps the dialog's own address
 * (`#/about`) for a new tab or window.
 */
export function AboutSection({
  aboutHref,
  openAbout,
}: {
  aboutHref: string;
  openAbout: () => void;
}) {
  const t = useT("settings").about;
  const links = [
    { href: productLink("docsUrl"), text: t.docs },
    { href: productLink("homepageUrl"), text: t.website },
  ].filter((link): link is { href: string; text: string } => !!link.href);
  return (
    <SettingsSectionFrame section="about" title={t.title} intro={t.text}>
      <SettingsGroup>
        <dl className="settings-usage settings-about">
          <div>
            <dt>{t.version}</dt>
            <dd>
              <code>{appVersion}</code>
            </dd>
          </div>
        </dl>
        <div className="settings-actions settings-about-links">
          <a
            className="button secondary"
            href={aboutHref}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return;
              event.preventDefault();
              openAbout();
            }}
          >
            <Info size={15} aria-hidden="true" />
            {t.open}
          </a>
          {links.map((link) => (
            <WebLink
              key={link.href}
              className="settings-link"
              href={safeLink(link.href) || undefined}
              target="_blank"
              rel="noreferrer"
            >
              {link.text}
              <ExternalLink size={13} aria-hidden="true" />
            </WebLink>
          ))}
        </div>
      </SettingsGroup>
    </SettingsSectionFrame>
  );
}
