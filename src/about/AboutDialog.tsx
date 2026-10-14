import { useEffect, useState } from "react";
import { ClipboardCopy, Copy, ExternalLink, TriangleAlert } from "lucide-react";
import type { LicenseSummary } from "../../shared/plans";
import { productEmail, productLink } from "../../shared/product";
import { api } from "../api";
import { Logo } from "../brand/Logo";
import { useT } from "../i18n";
import { PlanChip } from "../license/PlanChip";
import { Modal } from "../modals/Modal";
import { appVersion } from "../version";
import "./about.css";

/** A link the About dialog offers; empty product values give none. */
export interface AboutLink {
  id: "docs" | "changelog" | "security" | "issue";
  href: string;
}

/**
 * The help links from shared/product.ts, each left out while its value is
 * empty: the docs, the changelog in the public repository, the security
 * address, and the issue tracker (else the support address).
 */
export function aboutLinks(
  link = productLink,
  email = productEmail,
): AboutLink[] {
  const repository = link("publicRepoUrl")?.replace(/\/+$/, "");
  const docs = link("docsUrl");
  const security = email("securityEmail");
  const support = email("supportEmail");
  const issue = repository
    ? `${repository}/issues`
    : support
      ? `mailto:${support}`
      : undefined;
  const links: (AboutLink | undefined)[] = [
    docs ? { id: "docs", href: docs } : undefined,
    repository
      ? { id: "changelog", href: `${repository}/blob/HEAD/CHANGELOG.md` }
      : undefined,
    security ? { id: "security", href: `mailto:${security}` } : undefined,
    issue ? { id: "issue", href: issue } : undefined,
  ];
  return links.filter((item): item is AboutLink => item !== undefined);
}

/** The documents the server ships next to the app (dist/legal, dist/). */
export const aboutDocuments = [
  { id: "eula", href: "/legal/EULA.txt" },
  { id: "privacy", href: "/legal/PRIVACY.txt" },
  { id: "terms", href: "/legal/TERMS.txt" },
  { id: "security", href: "/legal/SECURITY.txt" },
  { id: "notices", href: "/THIRD_PARTY_NOTICES.txt" },
] as const;

export interface AboutDialogProps {
  onClose: () => void;
  /** The license; the plan row waits for it. */
  license?: LicenseSummary;
  /** The data directory from the environment report; undefined until it came. */
  dataDir?: string;
  /** present=1: the licensee and the data directory are masked, nothing to copy. */
  presenting: boolean;
  maskUser: (value: string) => string;
  maskPath: (value: string) => string;
  /** The server's version when the caller knows it; else /api/health is asked. */
  serverVersion?: string;
}

type CopyState = "idle" | "busy" | "copied" | "failed";

/**
 * About BELL PR: the app's and the server's versions (with a warning when
 * they differ), the plan and licensee, the help links and the legal
 * documents, the data directory, "Copy diagnostics" and the notices.
 */
export function AboutDialog({
  onClose,
  license,
  dataDir,
  presenting,
  maskUser,
  maskPath,
  serverVersion: knownVersion,
}: AboutDialogProps) {
  const t = useT("about");
  const legal = useT("legal");
  const [health, setHealth] = useState<string | null>();
  const [pathCopy, setPathCopy] = useState<CopyState>("idle");
  const [diagnostics, setDiagnostics] = useState<{ state: CopyState; text: string }>({
    state: "idle",
    text: "",
  });
  useEffect(() => {
    let current = true;
    api<{ version?: string }>("/health").then(
      (body) => current && setHealth(body.version ?? null),
      () => current && setHealth(null),
    );
    return () => {
      current = false;
    };
  }, []);
  const serverVersion = health ?? knownVersion;
  const mismatch = !!serverVersion && serverVersion !== appVersion;
  const licensee = license?.name || license?.email;
  const links = aboutLinks();

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setPathCopy("copied");
    } catch {
      setPathCopy("failed");
    }
  };
  const copyDiagnostics = async () => {
    setDiagnostics({ state: "busy", text: "" });
    let text: string;
    try {
      text = JSON.stringify(await api<unknown>("/diagnostics"), null, 2);
    } catch (error) {
      setDiagnostics({
        state: "failed",
        text: t.diagnostics.failed({
          message: error instanceof Error ? error.message : String(error),
        }),
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setDiagnostics({ state: "copied", text: "" });
    } catch {
      // Shown below to select by hand.
      setDiagnostics({ state: "idle", text });
    }
  };

  return (
    <Modal
      wide
      title={t.title}
      subtitle={t.subtitle}
      onClose={onClose}
      mark={<Logo variant="mark" size={28} title="" />}
    >
      <dl className="about-facts">
        <div>
          <dt>{t.appVersion}</dt>
          <dd>
            <code>{appVersion}</code>
          </dd>
        </div>
        <div>
          <dt>{t.serverVersion}</dt>
          <dd>
            {serverVersion ? (
              <code>{serverVersion}</code>
            ) : health === undefined ? (
              t.checking
            ) : (
              t.unavailable
            )}
          </dd>
        </div>
        <div>
          <dt>{t.plan}</dt>
          <dd className="about-plan">
            {license ? <PlanChip summary={license} /> : t.checking}
            {licensee && <span>{t.licensee({ name: maskUser(licensee) })}</span>}
          </dd>
        </div>
        <div>
          <dt>{t.dataDir}</dt>
          <dd className="about-path">
            {dataDir ? (
              <>
                <code>{maskPath(dataDir)}</code>
                {!presenting && (
                  <button
                    type="button"
                    className="button secondary about-copy"
                    aria-label={t.copyDataDir}
                    title={t.copyDataDir}
                    onClick={() => void copyPath(dataDir)}
                  >
                    <Copy size={14} aria-hidden="true" />
                    <span>{t.copy}</span>
                  </button>
                )}
              </>
            ) : (
              t.checking
            )}
          </dd>
        </div>
      </dl>
      <p className="visually-hidden" role="status">
        {pathCopy === "copied" ? t.copied : pathCopy === "failed" ? t.copyFailed : ""}
      </p>
      {mismatch && (
        <p className="about-warning" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{t.mismatch({ app: appVersion, server: serverVersion })}</span>
        </p>
      )}
      {links.length > 0 && (
        <section className="about-section" aria-labelledby="about-help">
          <h3 id="about-help">{t.help}</h3>
          <ul className="about-links">
            {links.map((item) => (
              <li key={item.id}>
                <a href={item.href} target="_blank" rel="noreferrer">
                  {t.links[item.id]}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="about-section" aria-labelledby="about-documents">
        <h3 id="about-documents">{t.documents}</h3>
        <ul className="about-links">
          {aboutDocuments.map((item) => (
            <li key={item.id}>
              <a href={item.href} target="_blank" rel="noreferrer">
                {t.documentNames[item.id]}
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </section>
      <div className="about-diagnostics">
        <button
          type="button"
          className="button secondary"
          disabled={diagnostics.state === "busy"}
          onClick={() => void copyDiagnostics()}
        >
          <ClipboardCopy size={15} aria-hidden="true" />
          {diagnostics.state === "busy" ? t.diagnostics.collecting : t.diagnostics.copy}
        </button>
        <p role="status" className="about-status">
          {diagnostics.state === "copied"
            ? t.diagnostics.copied
            : diagnostics.state === "failed"
              ? diagnostics.text
              : diagnostics.text
                ? t.diagnostics.copyFailed
                : ""}
        </p>
        {diagnostics.state === "idle" && diagnostics.text && (
          <pre className="about-diagnostics-text" tabIndex={0}>
            {diagnostics.text}
          </pre>
        )}
      </div>
      <p className="about-notice">{legal.trademark}</p>
      <p className="about-notice">{legal.ponytailCredit}</p>
      <div className="modal-actions">
        <button type="button" className="button primary" onClick={onClose}>
          {t.close}
        </button>
      </div>
    </Modal>
  );
}
