/** Browser sessions signed by the current install token; rotation revokes them. */
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { tokensMatch } from "./api-token.js";

export const apiSessionCookie = "bellpr-session";
export const apiSessionLifetime = 12 * 60 * 60;
export const rememberedApiSessionLifetime = 30 * 24 * 60 * 60;

const sessionSchema = z.object({
  v: z.literal(1),
  iat: z.number().int().nonnegative().safe(),
  exp: z.number().int().nonnegative().safe(),
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  remembered: z.boolean(),
}).strict();

function signature(payload: string, token: string) {
  return createHmac("sha256", token)
    .update(`bellpr-session:v1:${payload}`)
    .digest("base64url");
}

export function createApiSession(token: string, remembered: boolean, now = Date.now()): string {
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    iat: issued,
    exp: issued + (remembered ? rememberedApiSessionLifetime : apiSessionLifetime),
    nonce: randomBytes(16).toString("hex"),
    remembered,
  })).toString("base64url");
  return `${payload}.${signature(payload, token)}`;
}

/** Reject duplicate names rather than choosing between cookies from different paths. */
export function readApiSession(cookie: string | undefined, token: string, cookieName: string, now = Date.now()) {
  const matches = (cookie ?? "").split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0].slice(cookieName.length + 1);
  if (value.length > 1024) return undefined;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match || !tokensMatch(signature(match[1], token), match[2])) return undefined;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")));
    if (!parsed.success) return undefined;
    const session = parsed.data;
    const seconds = Math.floor(now / 1000);
    const lifetime = session.remembered ? rememberedApiSessionLifetime : apiSessionLifetime;
    if (session.iat > seconds || session.exp <= seconds || session.exp - session.iat !== lifetime)
      return undefined;
    return session;
  } catch {
    return undefined;
  }
}
