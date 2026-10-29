import type { CookieOptions, Express, Request } from "express";
import { z } from "zod";
import {
  createApiSession,
  readApiSession,
  rememberedApiSessionLifetime,
} from "../api-session.js";
import { readApiToken, rotateApiToken } from "../api-token.js";
import { apiRequestAuthenticated, apiSessionCookieScope } from "../http-guard.js";
import { sm } from "../i18n/index.js";

function cookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure: apiSessionCookieScope(req).secure,
  };
}

/** Registered only with the same token file the request guard reads. */
export function registerApiSessionRoutes(app: Express, tokenFile: string) {
  app.get("/api/session", (req, res) => {
    const token = readApiToken(tokenFile);
    const session = token ? readApiSession(req.get("cookie"), token, apiSessionCookieScope(req).name) : undefined;
    res.json({ remembered: session?.remembered ?? false });
  });
  app.post("/api/session", (req, res) => {
    const { remember } = z.object({ remember: z.boolean() }).strict().parse(req.body);
    const token = readApiToken(tokenFile);
    // JSON parsing can wait for the request body after the guard ran.
    // A rotation during that wait must not exchange old credentials for
    // a session signed by the new token.
    if (!token || !apiRequestAuthenticated(req, token)) {
      res.status(401).json({ error: sm().common.apiTokenRequired });
      return;
    }
    res.cookie(apiSessionCookieScope(req).name, createApiSession(token, remember), {
      ...cookieOptions(req),
      ...(remember ? { maxAge: rememberedApiSessionLifetime * 1000 } : {}),
    });
    res.json({ remembered: remember });
  });
  app.delete("/api/session", (req, res) => {
    z.object({}).strict().parse(req.body);
    res.clearCookie(apiSessionCookieScope(req).name, cookieOptions(req));
    res.status(204).end();
  });
  app.post("/api/session/revoke", async (req, res) => {
    z.object({}).strict().parse(req.body);
    if (!apiRequestAuthenticated(req, readApiToken(tokenFile))) {
      res.status(401).json({ error: sm().common.apiTokenRequired });
      return;
    }
    await rotateApiToken(tokenFile);
    res.clearCookie(apiSessionCookieScope(req).name, cookieOptions(req));
    res.status(204).end();
  });
}
