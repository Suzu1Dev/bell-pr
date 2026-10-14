/**
 * Sign-in: the session cookie, one-time sign-in links and the page shown
 * without a session.
 *
 * The server keeps one session secret in memory (AppOptions.sessionToken)
 * and prints `/auth?t=<secret>` at startup. `bell-pr open` asks the running
 * server for a one-time link instead, so the secret itself is never written
 * to disk. Either link sets the session cookie; localhostGuard then lets
 * the browser through.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Express, Request } from "express";
import {
  authPage,
  hasSession,
  sameSecret,
  sendSignInPage,
  sessionCookie,
  sessionMaxAgeSeconds,
} from "../http-guard.js";
import { sm } from "../i18n/index.js";
import { setAgentDataDirectory } from "../sandbox.js";
import type { RouteDeps } from "./types.js";

/** How long a one-time link works, and how many may be open at once. */
export const oneTimeTokenLifetimeMs = 120_000;
export const oneTimeTokenLimit = 5;

/** What app.locals keeps for sign-in; one-time tokens are stored as digests. */
interface SignInState {
  /** The session secret; sign-in links exist only when there is one. */
  sessionToken?: string;
  /** Digest of each outstanding one-time token → when it expires (ms). */
  oneTimeTokens: Map<string, number>;
}

const tokenDigest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function signInState(app: Express): SignInState | undefined {
  return app.locals.signIn as SignInState | undefined;
}

function pruneExpired(state: SignInState, now: number) {
  for (const [key, expiresAt] of state.oneTimeTokens)
    if (expiresAt <= now) state.oneTimeTokens.delete(key);
}

/** Uses up a one-time token: true once, within its lifetime. */
function consumeOneTimeToken(state: SignInState, token: string) {
  const now = Date.now();
  pruneExpired(state, now);
  const key = tokenDigest(token);
  const expiresAt = state.oneTimeTokens.get(key);
  if (expiresAt === undefined) return false;
  state.oneTimeTokens.delete(key);
  return expiresAt > now;
}

/** `Secure` only over HTTPS (through a TLS proxy BELL trusts), never on plain HTTP. */
function cookieHeader(req: Request, value: string) {
  return [
    `${sessionCookie}=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${sessionMaxAgeSeconds}`,
    ...(req.secure ? ["Secure"] : []),
  ].join("; ");
}

export function registerAuthRoutes(app: Express, deps: RouteDeps) {
  const state: SignInState = {
    sessionToken: deps.options.sessionToken,
    oneTimeTokens: new Map(),
  };
  app.locals.signIn = state;
  // Agents are denied reading this data directory, one-time links included.
  setAgentDataDirectory(deps.workbench.store.directory);

  /**
   * GET /auth?t=<token> takes the session secret or a one-time token and
   * sets the session cookie. It answers 200 with a page that moves on to
   * the app, not a redirect: a SameSite=Strict cookie set while following a
   * link from another site would not be sent with the redirected request.
   */
  app.get("/auth", (req, res) => {
    const token = typeof req.query.t === "string" ? req.query.t : "";
    const session = state.sessionToken;
    // Without a session secret there is nothing to sign in to.
    if (session) {
      const accepted =
        !!token &&
        token.length <= 512 &&
        (sameSecret(token, session) || consumeOneTimeToken(state, token));
      if (accepted) res.setHeader("Set-Cookie", cookieHeader(req, session));
      else if (!hasSession(req, session)) {
        sendSignInPage(res, 401, { linkInvalid: !!token });
        return;
      }
    }
    const messages = sm().security.signIn;
    res
      .status(200)
      .set("Cache-Control", "no-store")
      .type("html")
      .send(
        authPage({
          title: messages.signedInTitle,
          heading: messages.signedInTitle,
          paragraphs: [messages.signedIn],
          link: { href: "/", text: messages.continue },
          refresh: "/",
        }),
      );
  });
}

/**
 * Mints a one-time sign-in token for `bell-pr open`: 32 random bytes in
 * base64url, accepted once by GET /auth within two minutes. At most five
 * are outstanding; a sixth replaces the oldest. Only a digest is kept, in
 * memory. Returns undefined when the server has no session secret (sign-in
 * is off) or the auth routes are not registered on `app`.
 */
export function mintOneTimeToken(app: Express): string | undefined {
  const state = signInState(app);
  if (!state?.sessionToken) return undefined;
  const now = Date.now();
  pruneExpired(state, now);
  while (state.oneTimeTokens.size >= oneTimeTokenLimit) {
    const [oldest] = [...state.oneTimeTokens].sort((a, b) => a[1] - b[1])[0];
    state.oneTimeTokens.delete(oldest);
  }
  const token = randomBytes(32).toString("base64url");
  state.oneTimeTokens.set(tokenDigest(token), now + oneTimeTokenLifetimeMs);
  return token;
}
