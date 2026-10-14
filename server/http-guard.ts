import type { RequestHandler } from "express";

const invalidOrigins =
  "BELLPR_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins without credentials, paths, queries, fragments, or wildcards.";

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
        url.port === "0"
      )
        throw new Error("Invalid origin");
      return url.origin;
    } catch {
      throw new Error(invalidOrigins);
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
  /** The session secret requests must carry. Accepted but unused until 3B. */
  sessionToken?: string;
  /** Paths reachable without a session. Accepted but unused until 3B. */
  publicPaths: string[];
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
      if (origins.length !== 1) throw new Error(invalidOrigins);
      return origins[0];
    }),
  );
  const allowedHosts = new Set([
    ...localHosts,
    ...[...allowedOrigins].map((origin) => new URL(origin).host),
  ]);
  return (req, res, next) => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHosts.has(host)) {
      res.status(403).json({ error: "不允許此服務網址。" });
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
      res.status(403).json({ error: "不允許跨來源請求。" });
      return;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.is("application/json")
    ) {
      res.status(415).json({ error: "變更操作必須使用 application/json。" });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    next();
  };
}
