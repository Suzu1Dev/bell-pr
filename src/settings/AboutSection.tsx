import { ExternalLink, Info } from "lucide-react";
import { productLink } from "../../shared/product";
import { useT } from "../i18n";
import { appVersion } from "../version";
import { SettingsGroup, SettingsSectionFrame } from "./controls";

/**
 * About: the version of this build, the About dialog (the app opens it at
 * `#/about`) and the product's public links while they are set.
 */
export function AboutSection({ aboutHref }: { aboutHref: string }) {
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
          <a className="button secondary" href={aboutHref}>
            <Info size={15} aria-hidden="true" />
            {t.open}
          </a>
          {links.map((link) => (
            <a
              key={link.href}
              className="settings-link"
              href={link.href}
              target="_blank"
              rel="noreferrer"
            >
              {link.text}
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ))}
        </div>
      </SettingsGroup>
    </SettingsSectionFrame>
  );
}
