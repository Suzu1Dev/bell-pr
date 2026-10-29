import type { Request, RequestHandler, Response } from "express";
import { tokensMatch } from "./api-token.js";
import { sm } from "./i18n/index.js";

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
 * origin must use HTTPS, since API traffic would otherwise cross the
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
   * When `apiToken` or `readApiToken` is set, every `/api` request except
   * GET and HEAD `/api/health` and POST `/api/pair` must send this token or
   * a paired device token. `readApiToken` is called per request so
   * `bell-pr token rotate` applies immediately.
   */
  apiToken?: string;
  readApiToken?: () => string | undefined;
  /**
   * A paired device's token, checked against the install token: the device
   * id, or undefined. The guard puts the id in `res.locals.deviceId`.
   */
  deviceToken?: (presented: string, installToken: string) => string | undefined;
}

/** No scripts or styles from elsewhere, no framing, no form posts to other sites. */
export const contentSecurityPolicy =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

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
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    // Express matches routes without regard to case, so /API/repos is API too.
    const api = /^\/api(?:\/|$)/i.test(req.path);
    if (api) res.setHeader("Cache-Control", "no-store");
    // Opening the page from a link on another site, or through a sign-in
    // proxy's redirect back from its identity provider. Framing is refused
    // by the headers above.
    const pageNavigation =
      (req.method === "GET" || req.method === "HEAD") &&
      !api &&
      req.get("sec-fetch-mode") === "navigate" &&
      req.get("sec-fetch-dest") === "document";
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
      (req.get("sec-fetch-site") === "cross-site" && !pageNavigation)
    ) {
      res.status(403).json({ error: sm().common.crossOriginNotAllowed });
      return;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.is("application/json")
    ) {
      res.status(415).json({ error: sm().common.jsonRequired });
      return;
    }
    if (api && enforced(opts) && !publicHealth(req) && !publicPairing(req)) {
      const expected = opts.readApiToken?.() ?? opts.apiToken;
      if (
        !expected ||
        (!tokensMatch(expected, presentedToken(req)) && !deviceAuthenticated(req, res, opts, expected))
      ) {
        res.status(401).json({ error: sm().common.apiTokenRequired });
        return;
      }
    }
    next();
  };
}

function enforced(opts: GuardOptions) {
  return opts.apiToken !== undefined || opts.readApiToken !== undefined;
}

/** Health stays open for local probes, `bell-pr open` and container checks. */
function publicHealth(req: Request) {
  return (
    (req.method === "GET" || req.method === "HEAD") &&
    /^\/api\/health$/i.test(req.path)
  );
}

/** Redeeming a pairing code: the device has no token yet. */
function publicPairing(req: Request) {
  return req.method === "POST" && /^\/api\/pair$/i.test(req.path);
}

function hasTokenHeader(req: Request) {
  return req.get("authorization") !== undefined || req.get("x-bell-token") !== undefined;
}

/** A device token in the token headers; never a cookie. */
function deviceAuthenticated(req: Request, res: Response, opts: GuardOptions, expected: string | undefined) {
  if (!expected || !opts.deviceToken || !hasTokenHeader(req)) return false;
  const id = opts.deviceToken(presentedToken(req), expected);
  if (id !== undefined) res.locals.deviceId = id;
  return id !== undefined;
}

/** Authorization: Bearer, or X-Bell-Token when Authorization is absent. */
function presentedToken(req: Request) {
  const authorization = req.get("authorization");
  const raw =
    authorization !== undefined
      ? (/^Bearer\s+(\S+)\s*$/i.exec(authorization)?.[1] ?? "")
      : (req.get("x-bell-token")?.trim() ?? "");
  // A huge header is not a token. The compare still runs on a fixed digest.
  return raw.length > 256 ? "" : raw;
}
