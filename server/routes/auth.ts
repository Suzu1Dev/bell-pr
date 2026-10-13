/**
 * Sign-in: the session cookie, one-time sign-in links and the page shown
 * without a session.
 *
 * Owned by 3B-security-hardening, which adds the routes. createApp already
 * registers this module in its fixed place, before the /api 404 handler.
 */
import type { Express } from "express";
import type { RouteDeps } from "./types.js";

export function registerAuthRoutes(_app: Express, _deps: RouteDeps) {}

/**
 * Mints a one-time sign-in token for `bell-pr open`. Returns undefined
 * until sign-in links exist.
 */
export function mintOneTimeToken(_app: Express): string | undefined {
  return undefined;
}
