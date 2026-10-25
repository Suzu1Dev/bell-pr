import type { RequestHandler } from "express";
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
