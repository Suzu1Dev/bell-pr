import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { htmlLang } from "../shared/i18n/locale.js";
import { currentLocale, sm } from "./i18n/index.js";

const invalidOrigins = () => sm().security.invalidOrigins;

/** localhost, 127.0.0.0/8 and [::1]: addresses only this computer can reach. */
function loopbackHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * Parses BELLPR_ALLOWED_ORIGINS. Each entry is one origin; a non-loopback
 * origin must use HTTPS, since the session cookie would otherwise cross the
 * network in clear text.
 */
export function parseAllowedOrigins(value = ""): string[] {
  if (!value.trim()) return [];
  return value.split(",").map((entry) => {
    const value = entry.trim();
    try {
      const url = new URL(value);
      if (
        !/^https?:\/\/[^/?#\\\s@*]+$/i.test(value) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.hostname.includes("*") ||
        value.endsWith(":") ||
        url.port === "0" ||
        (url.protocol === "http:" && !loopbackHost(url.hostname))
      )
        throw new Error("Invalid origin");
      return url.origin;
    } catch {
      throw new Error(invalidOrigins());
    }
  });
}

export interface GuardOptions {
  /** Ports whose localhost, 127.0.0.1 and [::1] hosts are trusted. */
  ports: number[];
  /**
   * Extra trusted origins, such as a TLS proxy in front of BELL PR. Each
   * entry is one origin under the BELLPR_ALLOWED_ORIGINS rules; an invalid
   * one throws.
   */
  allowedOrigins: string[];
  /**
   * The session secret. When set, every request outside `publicPaths`
   * needs the `bellpr_session` cookie holding it; without it there is no
   * sign-in (development mode).
   */
  sessionToken?: string;
  /** Paths reachable without a session, with everything below them. */
  publicPaths: string[];
}

/** The cookie that carries the session secret. */
export const sessionCookie = "bellpr_session";
/** How long a browser stays signed in: 30 days. */
export const sessionMaxAgeSeconds = 2_592_000;

/** No scripts or styles from elsewhere, no framing, no form posts to other sites. */
export const contentSecurityPolicy =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Compares two secrets in constant time, whatever their lengths. */
export function sameSecret(value: string, secret: string) {
  return timingSafeEqual(digest(value), digest(secret));
}

/** One cookie from the request, without a cookie-parsing dependency. */
export function requestCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name)
      return part.slice(at + 1).trim();
  }
  return undefined;
}

/** True when the request carries the session cookie for `sessionToken`. */
export function hasSession(req: Request, sessionToken: string) {
  const value = requestCookie(req, sessionCookie);
  return !!value && sameSecret(value, sessionToken);
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

/** Escaped text in which `backticked` parts are shown as code. */
const prose = (text: string) =>
  escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");

/**
 * A small self-contained page in the request's locale for the sign-in
 * flow: inline styles only (the CSP allows them) and no script.
 */
export function authPage(options: {
  title: string;
  heading: string;
  paragraphs: string[];
  link?: { href: string; text: string };
  /** Navigates there at once with a meta refresh. */
  refresh?: string;
}) {
  return `<!doctype html>
<html lang="${htmlLang(currentLocale())}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
${options.refresh ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(options.refresh)}">\n` : ""}<title>${escapeHtml(options.title)}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f5;color:#1d2420;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:34rem;margin:1.5rem;padding:2rem;background:#fff;border:1px solid #dfe4e0;border-radius:12px}
h1{margin:0 0 1rem;font-size:1.35rem}
p{margin:0 0 .85rem}
code{padding:.1rem .3rem;border-radius:4px;background:#eef1ee;font:.92em ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
a{color:#1f6d50;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#151a17;color:#e7ece8}main{background:#1d2420;border-color:#2e3832}code{background:#2a332d}a{color:#7fd3ae}}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(options.heading)}</h1>
${options.paragraphs.map((text) => `<p>${prose(text)}</p>`).join("\n")}
${options.link ? `<p><a href="${escapeHtml(options.link.href)}">${escapeHtml(options.link.text)}</a></p>` : ""}
</main>
</body>
</html>
`;
}

/** The page shown to a browser without a session, with the status it needs. */
export function sendSignInPage(
  res: Response,
  status: number,
  options: { linkInvalid?: boolean } = {},
) {
  const messages = sm().security.signIn;
  res
    .status(status)
    .set("Cache-Control", "no-store")
    .type("html")
    .send(
      authPage({
        title: messages.title,
        heading: messages.heading,
        paragraphs: [
          ...(options.linkInvalid ? [messages.linkInvalid] : []),
          messages.howTo,
        ],
      }),
    );
}

export function localhostGuard(opts: GuardOptions): RequestHandler {
  const localHosts = new Set(
    opts.ports.flatMap((port) => [
      `localhost:${port}`,
      `127.0.0.1:${port}`,
      `[::1]:${port}`,
    ]),
  );
  const localOrigins = new Set([...localHosts].map((host) => `http://${host}`));
  // Each entry is exactly one origin: an empty entry or a comma-separated
  // list in one entry throws like a malformed origin.
  const allowedOrigins = new Set(
    opts.allowedOrigins.map((entry) => {
      const origins = parseAllowedOrigins(entry);
      if (origins.length !== 1) throw new Error(invalidOrigins());
      return origins[0];
    }),
  );
  const allowedHosts = new Set([
    ...localHosts,
    ...[...allowedOrigins].map((origin) => new URL(origin).host),
  ]);
  const sessionToken = opts.sessionToken;
  const publicPath = (requestPath: string) =>
    opts.publicPaths.some(
      (entry) => requestPath === entry || requestPath.startsWith(`${entry}/`),
    );
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    const api = req.path === "/api" || req.path.startsWith("/api/");
    if (api) res.setHeader("Cache-Control", "no-store");
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHosts.has(host)) {
      res.status(403).json({ error: sm().common.hostNotAllowed });
      return;
    }
    const origin = req.get("origin");
    if (
      (origin &&
        !(
          (localHosts.has(host) && localOrigins.has(origin)) ||
          (allowedOrigins.has(origin) && new URL(origin).host === host)
        )) ||
      req.get("sec-fetch-site") === "cross-site"
    ) {
      res.status(403).json({ error: sm().common.crossOriginNotAllowed });
      return;
    }
    if (sessionToken && !publicPath(req.path) && !hasSession(req, sessionToken)) {
      if (api)
        res
          .status(401)
          .json({ error: sm().security.authRequired, code: "auth_required" });
      else sendSignInPage(res, 401);
      return;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.is("application/json")
    ) {
      res.status(415).json({ error: sm().common.jsonRequired });
      return;
    }
    next();
  };
}
