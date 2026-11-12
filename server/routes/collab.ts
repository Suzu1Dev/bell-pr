/**
 * Group work: GET /api/collab, POST /api/collab/setup, POST
 * /api/collab/invites, POST /api/collab/join and POST
 * /api/collab/people/:id/remove, and the group's repositories and boards
 * (routes/collab-board.ts). Registered only when BELL PR was started with
 * --group.
 *
 * The guard runs first, so every request already carries the app token
 * (install or device). Who is asking within the group is the participant
 * token in `x-bell-participant`, and the coordinator alone decides whose
 * it is. A participant problem is answered 403 `notJoined`, never 401: the
 * interface takes a 401 to mean this device is no longer paired.
 *
 * Every refusal leaves through collabErrors (collab-refusal.ts): a reason
 * and a sentence of group work's own, and nothing the coordinator or git
 * wrote.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type {
  CollabAuthStatus,
  CollabInfo,
  CollabInviteInfoResponse,
  CollabInviteResponse,
  CollabJoinResponse,
  CollabMemberRecord,
  CollabRemoveResponse,
  CollabSetupResponse,
} from "../../shared/collab.js";
import type { AppOptions } from "../app.js";
import { readApiToken, tokensMatch } from "../api-token.js";
import {
  accountTokenPattern,
  AuthRateLimiter,
  extractInviteToken,
  hashPassword,
  issueAccountSessionToken,
  issueInviteToken,
  normalizeEmail,
  normalizeUsername,
  readTailscaleIdentity,
  validPassword,
  verifyAccountSessionToken,
  verifyInviteToken,
  verifyPassword,
} from "../collab-auth.js";
import { dropHoldEntries, taskKey } from "../collab-board.js";
import { collabId, sideEntry, type CollabHost, type CollabSide } from "../collab-host.js";
import { CollabInvites, inviteTtl, maxInvites, type Invite } from "../collab-invites.js";
import { adminOnly, collabErrors, notJoined, reasonOf, refuse } from "../collab-refusal.js";
import { participantHeader } from "../coordination-routes.js";
import type { Actor } from "../coordination.js";
import type { DeviceTokens } from "../device-tokens.js";
import { sm } from "../i18n/index.js";
import { log } from "../log.js";
import type { Store } from "../store.js";
import { AppError } from "../types.js";
import { registerCollabBoardRoutes } from "./collab-board.js";
import { deviceName } from "./pairing.js";

type Person = NonNullable<CollabSide["people"]>[string];

const emptySchema = z.strictObject({});
const inviteSchema = z.union([
  z.strictObject({ name: deviceName.max(40), admin: z.literal(true).optional() }),
  z.strictObject({ self: z.literal(true) }),
  z.strictObject({
    email: z.string().trim().min(3).max(160),
    link: z.literal(true).optional(),
    admin: z.literal(true).optional(),
  }),
  z.strictObject({
    link: z.literal(true),
    email: z.string().trim().min(3).max(160).optional(),
    admin: z.literal(true).optional(),
  }),
]);
const joinSchema = z.strictObject({
  code: z.string().max(32),
  username: z.string().max(40).optional(),
  password: z.string().max(128).optional(),
});
const removeSchema = z.strictObject({ unpair: z.literal(true).optional() });
const loginSchema = z.strictObject({
  username: z.string().max(160),
  password: z.string().max(128),
  deviceName: deviceName.max(40).optional(),
});
const inviteInfoSchema = z.strictObject({
  code: z.string().max(300),
});
const optionalDisplayName = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  deviceName.max(40).optional(),
);
const registerSchema = z.strictObject({
  code: z.string().max(300),
  email: z.string().max(160).optional(),
  name: optionalDisplayName,
  username: z.string().max(64).optional(),
  password: z.string().max(128),
  deviceName: optionalDisplayName,
});
const tailscaleLoginSchema = z.strictObject({
  code: z.string().max(300).optional(),
  deviceName: deviceName.max(40).optional(),
});
const bootstrapSchema = z.strictObject({
  name: deviceName.max(40),
  username: z.string().max(64).optional(),
  password: z.string().max(128).optional(),
});
const createPersonSchema = z.strictObject({
  name: deviceName.max(40),
  username: z.string().max(64).optional(),
  email: z.string().max(160).optional(),
  password: z.string().max(128),
  admin: z.boolean().optional(),
  tailscaleLogin: z.string().max(120).optional(),
});
const updatePersonSchema = z.strictObject({
  name: deviceName.max(40).optional(),
  admin: z.boolean().optional(),
  disabled: z.boolean().optional(),
  username: z.string().max(64).optional(),
  email: z.union([z.string().max(160), z.null()]).optional(),
  password: z.string().max(128).optional(),
  tailscaleLogin: z.union([z.string().max(120), z.null()]).optional(),
});
const maxSessionsPerPerson = 12;
const emailInviteTtl = 7 * 24 * 60 * 60_000;
const maxEmailInvites = 50;

const invalidCode = () => refuse(400, "invalidCode", (m) => m.collab.invalidCode);
const invalidCredentials = () =>
  refuse(403, "invalidCredentials", (m) => m.collab.invalidCredentials);
const usernameTaken = () => refuse(409, "usernameTaken", (m) => m.collab.usernameTaken);
const emailTaken = () => refuse(409, "emailTaken", (m) => m.collab.emailTaken);
const invalidEmail = () => refuse(400, "invalidEmail", (m) => m.collab.invalidEmail);
const invalidAccountInput = () =>
  refuse(400, "invalidAccountInput", (m) => m.collab.invalidAccountInput);

const personOf = (host: CollabHost, id: string): Person | undefined =>
  sideEntry(host.side().people, id);

/** Who a participant token (`bpc_` or `bpa_`) belongs to; undefined when missing, unknown, disabled or removed. */
export function participantOf(
  host: CollabHost,
  token: unknown,
): { actor: Actor; person: Person } | undefined {
  let actor: Actor | undefined;
  if (typeof token === "string" && accountTokenPattern.test(token)) {
    const participantId = verifyAccountSessionToken(token, host.side().sessions);
    if (!participantId) return undefined;
    actor = host.coordinator().actorForHost(participantId);
    if (!actor) return undefined;
  } else {
    try {
      actor = host.coordinator().authenticate(token);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 401) return undefined;
      throw error;
    }
  }
  const person = personOf(host, actor.id);
  return person && !person.removedAt && !person.disabledAt ? { actor, person } : undefined;
}

/**
 * True when group work is ready; else answers 503 with the state. Answered
 * here, not thrown, so a board that keeps asking does not fill the log.
 */
function ready(host: CollabHost, res: Response) {
  const { state } = host.status();
  if (state === "ready") return true;
  res.status(503).json({ reason: state, error: sm().collab[state] });
  return false;
}

/**
 * For routes only a participant may use: 503 while group work is not
 * ready, one 403 `notJoined` for a missing, unknown or removed participant;
 * else res.locals.actor and res.locals.person are set.
 */
export function collabParticipant(host: CollabHost): RequestHandler {
  return (req, res, next) => {
    if (!ready(host, res)) return;
    const found = participantOf(host, req.get(participantHeader));
    if (!found) throw notJoined();
    res.locals.actor = found.actor;
    res.locals.person = found.person;
    next();
  };
}

export function registerCollabRoutes(
  app: Express,
  host: CollabHost,
  {
    store,
    devices,
    tokenFile,
    publicUrl,
    tailscaleAuth = false,
    remoteBootstrap = false,
  }: {
    store: Store;
    devices?: DeviceTokens;
    tokenFile?: string;
    publicUrl?: AppOptions["publicUrl"];
    tailscaleAuth?: boolean;
    remoteBootstrap?: boolean;
  },
) {
  const invites = new CollabInvites();
  const authLimiter = new AuthRateLimiter();
  const hub = registerCollabBoardRoutes(app, host, { store, participant: collabParticipant(host) });
  app.locals.collabHub = hub;
  /** The person at the host: the install token, not a paired device. */
  const atHost = (res: Response) => res.locals.deviceId === undefined;
  const identity = ({ actor, person }: { actor: Actor; person: Person }) => ({
    id: actor.id,
    name: person.name ?? actor.id,
    ...(actor.role === "admin" ? { admin: true as const } : {}),
    ...(person.username ? { username: person.username } : {}),
    ...(person.email ? { email: person.email } : {}),
    ...(person.tailscaleLogin ? { tailscaleLogin: person.tailscaleLogin } : {}),
  });

  const dropPersonSessions = (draft: CollabSide, personId: string) => {
    if (!draft.sessions) return;
    for (const [hash, entry] of Object.entries(draft.sessions)) {
      if (entry.participantId === personId) delete draft.sessions[hash];
    }
    if (!Object.keys(draft.sessions).length) delete draft.sessions;
  };

  const dropPersonEmailInvites = (draft: CollabSide, personId: string) => {
    if (!draft.emailInvites) return;
    for (const [id, entry] of Object.entries(draft.emailInvites)) {
      if (entry.createdBy === personId) delete draft.emailInvites[id];
    }
    if (!Object.keys(draft.emailInvites).length) delete draft.emailInvites;
  };

  const pruneEmailInvites = (draft: CollabSide, nowMs = Date.now()) => {
    if (!draft.emailInvites) return;
    for (const [id, entry] of Object.entries(draft.emailInvites)) {
      const expires = Date.parse(entry.expiresAt);
      if (!Number.isFinite(expires) || expires <= nowMs) delete draft.emailInvites[id];
    }
    if (!Object.keys(draft.emailInvites).length) delete draft.emailInvites;
  };

  const saveAccountSession = (draft: CollabSide, personId: string, tokenHash: string) => {
    const sessions = (draft.sessions ??= {});
    const existing = Object.entries(sessions)
      .filter(([, entry]) => entry.participantId === personId)
      .sort((a, b) =>
        (a[1].createdAt ?? "") < (b[1].createdAt ?? "")
          ? -1
          : (a[1].createdAt ?? "") > (b[1].createdAt ?? "")
            ? 1
            : 0,
      );
    for (let i = 0; i <= existing.length - maxSessionsPerPerson; i += 1) {
      delete sessions[existing[i][0]];
    }
    sessions[tokenHash] = {
      participantId: personId,
      createdAt: new Date().toISOString(),
    };
  };

  const usernameOwner = (side: CollabSide, username: string): string | undefined => {
    for (const [id, person] of Object.entries(side.people ?? {})) {
      if (!person.removedAt && person.username?.toLowerCase() === username) return id;
    }
    return undefined;
  };

  const emailOwner = (side: CollabSide, email: string): string | undefined => {
    for (const [id, person] of Object.entries(side.people ?? {})) {
      if (!person.removedAt && person.email?.toLowerCase() === email) return id;
    }
    return undefined;
  };

  const activeEmailInvite = (code: unknown) => {
    const matched = verifyInviteToken(code, host.side().emailInvites);
    if (!matched) return undefined;
    if (matched.invite.createdBy !== undefined) {
      const inviter = personOf(host, matched.invite.createdBy);
      if (!inviter || inviter.removedAt || inviter.disabledAt) return undefined;
    }
    return matched;
  };

  const activeAdminIds = (side: CollabSide): Set<string> => {
    const ids = new Set<string>();
    for (const [id, person] of Object.entries(side.people ?? {})) {
      if (person.removedAt || person.disabledAt) continue;
      const actor = host.coordinator().actorForHost(id);
      if (actor?.role === "admin") ids.add(id);
    }
    return ids;
  };

  /**
   * On a remote VPN/Tailscale server (--trust-vpn or --tailscale-auth), the
   * owner connects from a remote browser rather than localhost. Until the
   * first admin joins, an authenticated remote caller may initialize group
   * work and claim the initial admin seat; once an active admin exists, only
   * admins can invite or promote others.
   */
  const canRemoteBootstrap = (): boolean => {
    if (!remoteBootstrap) return false;
    const { state } = host.status();
    if (state === "notSetUp") return true;
    if (state === "ready") return activeAdminIds(host.side()).size === 0;
    return false;
  };

  /**
   * When a team member signs in from `/pair` or over VPN/Tailscale before
   * pairing a device, mints a revocable `bpd_` device token automatically.
   */
  const mintDeviceIfNeeded = async (
    req: Request,
    res: Response,
    label: string,
  ): Promise<{ deviceId?: string; deviceToken?: string }> => {
    if (res.locals.deviceId) return { deviceId: res.locals.deviceId };
    if (!devices || !tokenFile) return {};
    const installToken = readApiToken(tokenFile);
    if (!installToken) return {};
    const authHeader = req.get("authorization");
    const raw =
      authHeader !== undefined
        ? (/^Bearer\s+(\S+)\s*$/i.exec(authHeader)?.[1] ?? "")
        : (req.get("x-bell-token")?.trim() ?? "");
    if (raw && (tokensMatch(installToken, raw) || devices.verify(raw, installToken))) {
      return { deviceId: res.locals.deviceId };
    }
    const added = await devices.add(label.slice(0, 64), installToken);
    return { deviceId: added.id, deviceToken: added.token };
  };

  const checkRateLimit = (req: Request) => {
    const key = req.ip || req.socket?.remoteAddress || "local";
    const retryAfter = authLimiter.check(key);
    if (retryAfter !== undefined)
      throw refuse(429, "slowDown", (m) => m.collab.slowDown({ seconds: retryAfter }), {
        retryAfter,
      });
    return key;
  };

  const revokeAllHoldsOf = async (actor: Actor, personId: string): Promise<number> => {
    let revoked = 0;
    const coordinator = host.coordinator();
    const revokedKeys: string[] = [];
    for (const projectId of Object.keys(host.side().projects ?? {})) {
      for (const claim of coordinator.project(actor, projectId).claims) {
        if (claim.status !== "held" || claim.holder !== personId) continue;
        try {
          await coordinator.revoke(actor, projectId, claim.id, {});
          revoked += 1;
          revokedKeys.push(taskKey(projectId, claim.taskId));
        } catch (error) {
          if (reasonOf(error) !== "ended") throw error;
        }
      }
    }
    if (revokedKeys.some((key) => sideEntry(host.side().holds, key) !== undefined))
      await host.saveSide((draft) => dropHoldEntries(draft, revokedKeys));
    return revoked;
  };

  app.get("/api/collab/auth/status", (req, res) => {
    const status = host.status();
    const people = Object.values(host.side().people ?? {});
    const hasAccounts = people.some(
      (person) =>
        !person.removedAt &&
        !person.disabledAt &&
        Boolean((person.username || person.email) && person.passwordHash),
    );
    const ts = readTailscaleIdentity(req, tailscaleAuth);
    const body: CollabAuthStatus = {
      enabled: true,
      state: status.state,
      ...(hasAccounts ? { hasAccounts: true } : {}),
      ...(ts
        ? {
            tailscaleAvailable: true,
            tailscaleLogin: ts.login,
            tailscaleName: ts.name,
          }
        : {}),
    };
    res.json(body);
  });

  app.post("/api/collab/auth/invite-info", (req, res) => {
    const body = inviteInfoSchema.parse(req.body);
    if (!ready(host, res)) return;
    const rateKey = checkRateLimit(req);
    const matched = activeEmailInvite(body.code);
    if (!matched) {
      authLimiter.recordFailure(rateKey);
      res.json({ valid: false } satisfies CollabInviteInfoResponse);
      return;
    }
    res.json({
      valid: true,
      ...(matched.invite.email ? { email: matched.invite.email } : {}),
      ...(matched.invite.admin ? { admin: true } : {}),
      expiresAt: matched.invite.expiresAt,
    } satisfies CollabInviteInfoResponse);
  });

  app.post("/api/collab/auth/login", async (req, res) => {
    const body = loginSchema.parse(req.body);
    if (!ready(host, res)) return;
    const rateKey = checkRateLimit(req);
    const rawId = body.username.trim();
    const asEmail = normalizeEmail(rawId);
    const asUsername = normalizeUsername(rawId);
    if ((!asEmail && !asUsername) || !body.password) {
      authLimiter.recordFailure(rateKey);
      throw invalidCredentials();
    }
    const side = host.side();
    const personId =
      (asEmail ? emailOwner(side, asEmail) : undefined) ??
      (asUsername ? usernameOwner(side, asUsername) : undefined);
    const person = personId ? sideEntry(side.people, personId) : undefined;
    if (!personId || !person || person.removedAt || person.disabledAt) {
      authLimiter.recordFailure(rateKey);
      throw invalidCredentials();
    }
    const ok = await verifyPassword(body.password, person.passwordHash);
    if (!ok) {
      authLimiter.recordFailure(rateKey);
      throw invalidCredentials();
    }
    const actor = host.coordinator().actorForHost(personId);
    if (!actor) {
      authLimiter.recordFailure(rateKey);
      throw invalidCredentials();
    }
    authLimiter.clear(rateKey);
    const { deviceId, deviceToken } = await mintDeviceIfNeeded(
      req,
      res,
      body.deviceName ?? `${person.name ?? asEmail ?? asUsername} (Team)`,
    );
    const { token, tokenHash } = issueAccountSessionToken();
    await host.run(async () => {
      await host.saveSide((draft) => {
        const current = sideEntry(draft.people, personId);
        if (!current || current.removedAt || current.disabledAt) throw invalidCredentials();
        if (deviceId && !current.deviceId) current.deviceId = deviceId;
        saveAccountSession(draft, personId, tokenHash);
      });
    });
    const fresh = personOf(host, personId) ?? person;
    const answer: CollabJoinResponse = {
      groupId: host.side().groupId ?? "",
      ...identity({ actor, person: fresh }),
      token,
      ...(deviceToken ? { deviceToken } : {}),
    };
    res.json(answer);
  });

  app.post("/api/collab/auth/register", async (req, res) => {
    const body = registerSchema.parse(req.body);
    if (!ready(host, res)) return;
    const rateKey = checkRateLimit(req);
    const linkToken = extractInviteToken(body.code);
    if (linkToken) {
      const matched = activeEmailInvite(linkToken);
      if (!matched) {
        authLimiter.recordFailure(rateKey);
        throw invalidCode();
      }
      const email = normalizeEmail(body.email ?? matched.invite.email);
      if (!email || !validPassword(body.password)) throw invalidAccountInput();
      if (matched.invite.email && email !== matched.invite.email.toLowerCase()) {
        throw refuse(403, "inviteEmailMismatch", (m) =>
          m.collab.inviteEmailMismatch({ email: matched.invite.email! }),
        );
      }
      let username: string | undefined;
      if (body.username !== undefined && body.username.trim() !== "") {
        username = normalizeUsername(body.username);
        if (!username) throw invalidAccountInput();
        if (usernameOwner(host.side(), username)) throw usernameTaken();
      }
      if (emailOwner(host.side(), email)) throw emailTaken();
      authLimiter.clear(rateKey);
      const memberName =
        body.name?.trim() ||
        email
          .split("@")[0]
          .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, "")
          .trim()
          .slice(0, 40) ||
        "Member";
      const passwordHash = await hashPassword(body.password);
      const { token: sessionToken, tokenHash } = issueAccountSessionToken();
      const { deviceId, deviceToken } = await mintDeviceIfNeeded(
        req,
        res,
        body.deviceName ?? `${memberName} (Team)`,
      );
      const created: CollabJoinResponse = await host.run(async () => {
        const liveMatch = activeEmailInvite(linkToken);
        if (!liveMatch) throw invalidCode();
        if (emailOwner(host.side(), email)) throw emailTaken();
        if (username && usernameOwner(host.side(), username)) throw usernameTaken();
        const { id } = await host
          .coordinator()
          .addParticipant(collabId("m"), liveMatch.invite.admin ? "admin" : "member");
        await host.saveSide((draft) => {
          pruneEmailInvites(draft);
          if (liveMatch.invite.email && draft.emailInvites) {
            delete draft.emailInvites[liveMatch.id];
            if (!Object.keys(draft.emailInvites).length) delete draft.emailInvites;
          }
          (draft.people ??= {})[id] = {
            name: memberName,
            joinedAt: new Date().toISOString(),
            email,
            passwordHash,
            ...(username ? { username } : {}),
            ...(liveMatch.invite.admin ? { admin: true } : {}),
            ...(deviceId !== undefined ? { deviceId } : {}),
          };
          saveAccountSession(draft, id, tokenHash);
        });
        return {
          groupId: host.side().groupId ?? "",
          id,
          name: memberName,
          email,
          ...(username ? { username } : {}),
          ...(liveMatch.invite.admin ? { admin: true } : {}),
          token: sessionToken,
          ...(deviceToken ? { deviceToken } : {}),
        };
      });
      log.info(`group: ${created.id} registered via email invite`);
      res.status(201).json(created);
      return;
    }

    const username =
      body.username !== undefined && body.username.trim() !== ""
        ? normalizeUsername(body.username)
        : undefined;
    const email =
      body.email !== undefined && body.email.trim() !== "" ? normalizeEmail(body.email) : undefined;
    if ((body.username !== undefined && body.username.trim() !== "" && !username) || (body.email !== undefined && body.email.trim() !== "" && !email))
      throw invalidAccountInput();
    if ((!username && !email) || !validPassword(body.password)) throw invalidAccountInput();
    if (username && usernameOwner(host.side(), username)) throw usernameTaken();
    if (email && emailOwner(host.side(), email)) throw emailTaken();
    const callerKey = res.locals.deviceId ?? rateKey;
    const result = invites.redeem(body.code, callerKey);
    if (result.status === "locked")
      throw refuse(
        429,
        "joinLocked",
        (m) => m.collab.joinLocked({ minutes: Math.ceil(result.retryAfter / 60) }),
        { retryAfter: result.retryAfter },
      );
    if (result.status === "invalid") {
      authLimiter.recordFailure(rateKey);
      throw invalidCode();
    }
    authLimiter.clear(rateKey);
    const passwordHash = await hashPassword(body.password);
    const { token: sessionToken, tokenHash } = issueAccountSessionToken();
    const { invite } = result;
    const groupId = host.side().groupId ?? "";
    if ("self" in invite) {
      const found = participantOf(host, invite.self.token);
      if (!found) throw invalidCode();
      const { deviceId, deviceToken } = await mintDeviceIfNeeded(
        req,
        res,
        body.deviceName ?? `${found.person.name ?? username ?? email} (Team)`,
      );
      await host.run(async () => {
        await host.saveSide((draft) => {
          if (username) {
            const other = usernameOwner(draft, username);
            if (other && other !== found.actor.id) throw usernameTaken();
          }
          if (email) {
            const otherEmail = emailOwner(draft, email);
            if (otherEmail && otherEmail !== found.actor.id) throw emailTaken();
          }
          const entry = sideEntry(draft.people, found.actor.id);
          if (!entry || entry.removedAt || entry.disabledAt) throw invalidCode();
          if (username) entry.username = username;
          if (email) entry.email = email;
          entry.passwordHash = passwordHash;
          if (deviceId && !entry.deviceId) entry.deviceId = deviceId;
          saveAccountSession(draft, found.actor.id, tokenHash);
        });
      });
      const fresh = personOf(host, found.actor.id) ?? found.person;
      const answer: CollabJoinResponse = {
        groupId,
        ...identity({ actor: found.actor, person: fresh }),
        token: sessionToken,
        ...(deviceToken ? { deviceToken } : {}),
      };
      res.status(201).json(answer);
      return;
    }
    if (invite.by !== undefined) {
      const inviter = personOf(host, invite.by);
      if (!inviter || inviter.removedAt || inviter.disabledAt) throw invalidCode();
    }
    const chosenName = body.name?.trim() || invite.name;
    const { deviceId, deviceToken } = await mintDeviceIfNeeded(
      req,
      res,
      body.deviceName ?? `${chosenName} (Team)`,
    );
    const created: CollabJoinResponse = await host.run(async () => {
      if (username && usernameOwner(host.side(), username)) throw usernameTaken();
      if (email && emailOwner(host.side(), email)) throw emailTaken();
      const { id } = await host
        .coordinator()
        .addParticipant(collabId("m"), invite.admin ? "admin" : "member");
      await host.saveSide((draft) => {
        (draft.people ??= {})[id] = {
          name: chosenName,
          joinedAt: new Date().toISOString(),
          passwordHash,
          ...(username ? { username } : {}),
          ...(email ? { email } : {}),
          ...(invite.admin ? { admin: true } : {}),
          ...(deviceId !== undefined ? { deviceId } : {}),
        };
        saveAccountSession(draft, id, tokenHash);
      });
      return {
        groupId,
        id,
        name: chosenName,
        ...(username ? { username } : {}),
        ...(email ? { email } : {}),
        ...(invite.admin ? { admin: true } : {}),
        token: sessionToken,
        ...(deviceToken ? { deviceToken } : {}),
      };
    });
    log.info(`group: ${created.id} registered account`);
    res.status(201).json(created);
  });

  app.post("/api/collab/auth/tailscale", async (req, res) => {
    const body = tailscaleLoginSchema.parse(req.body);
    const rateKey = checkRateLimit(req);
    const ts = readTailscaleIdentity(req, tailscaleAuth);
    if (!ts) throw refuse(403, "tailscaleUnavailable", (m) => m.collab.tailscaleUnavailable);
    if (remoteBootstrap && host.status().state === "notSetUp") {
      await host.run(async () => {
        if (host.status().state === "notSetUp") await host.setUp();
      });
    }
    if (!ready(host, res)) return;
    const side = host.side();
    const existingEntry = Object.entries(side.people ?? {}).find(
      ([, person]) =>
        !person.removedAt &&
        !person.disabledAt &&
        (person.tailscaleLogin?.toLowerCase() === ts.login ||
          person.email?.toLowerCase() === ts.login),
    );
    const { token: sessionToken, tokenHash } = issueAccountSessionToken();
    const groupId = side.groupId ?? "";
    if (existingEntry) {
      const [personId, person] = existingEntry;
      const actor = host.coordinator().actorForHost(personId);
      if (!actor) throw invalidCredentials();
      const { deviceId, deviceToken } = await mintDeviceIfNeeded(
        req,
        res,
        body.deviceName ?? `${person.name ?? ts.name} (Tailscale)`,
      );
      await host.run(async () => {
        await host.saveSide((draft) => {
          const current = sideEntry(draft.people, personId);
          if (!current || current.removedAt || current.disabledAt) throw invalidCredentials();
          if (!current.tailscaleLogin) current.tailscaleLogin = ts.login;
          if (deviceId && !current.deviceId) current.deviceId = deviceId;
          saveAccountSession(draft, personId, tokenHash);
        });
      });
      const fresh = personOf(host, personId) ?? person;
      res.json({
        groupId,
        ...identity({ actor, person: fresh }),
        token: sessionToken,
        ...(deviceToken ? { deviceToken } : {}),
      } satisfies CollabJoinResponse);
      return;
    }
    const matchedEmailInvite = body.code
      ? activeEmailInvite(body.code)
      : Object.entries(side.emailInvites ?? {})
          .map(([id, invite]) => ({ id, invite }))
          .find(({ invite }) => {
            if (invite.email?.toLowerCase() !== ts.login) return false;
            if (Date.parse(invite.expiresAt) <= Date.now()) return false;
            if (invite.createdBy !== undefined) {
              const inviter = personOf(host, invite.createdBy);
              if (!inviter || inviter.removedAt || inviter.disabledAt) return false;
            }
            return true;
          });
    if (matchedEmailInvite) {
      if (
        matchedEmailInvite.invite.email &&
        matchedEmailInvite.invite.email.toLowerCase() !== ts.login
      ) {
        throw refuse(403, "inviteEmailMismatch", (m) =>
          m.collab.inviteEmailMismatch({ email: matchedEmailInvite.invite.email! }),
        );
      }
      if (emailOwner(side, ts.login)) throw invalidCredentials();
      const { deviceId, deviceToken } = await mintDeviceIfNeeded(
        req,
        res,
        body.deviceName ?? `${ts.name} (Tailscale)`,
      );
      const joined = await host.run(async () => {
        if (emailOwner(host.side(), ts.login)) throw invalidCredentials();
        const { id } = await host
          .coordinator()
          .addParticipant(collabId("m"), matchedEmailInvite.invite.admin ? "admin" : "member");
        await host.saveSide((draft) => {
          pruneEmailInvites(draft);
          if (matchedEmailInvite.invite.email && draft.emailInvites) {
            delete draft.emailInvites[matchedEmailInvite.id];
            if (!Object.keys(draft.emailInvites).length) delete draft.emailInvites;
          }
          (draft.people ??= {})[id] = {
            name: ts.name,
            joinedAt: new Date().toISOString(),
            email: ts.login,
            tailscaleLogin: ts.login,
            ...(matchedEmailInvite.invite.admin ? { admin: true } : {}),
            ...(deviceId !== undefined ? { deviceId } : {}),
          };
          saveAccountSession(draft, id, tokenHash);
        });
        return {
          groupId,
          id,
          name: ts.name,
          email: ts.login,
          tailscaleLogin: ts.login,
          ...(matchedEmailInvite.invite.admin ? { admin: true } : {}),
          token: sessionToken,
          ...(deviceToken ? { deviceToken } : {}),
        } satisfies CollabJoinResponse;
      });
      log.info(`group: ${joined.id} joined via tailscale email invite`);
      res.status(201).json(joined);
      return;
    }
    if (body.code) {
      const result = invites.redeem(body.code, res.locals.deviceId ?? rateKey);
      if (result.status === "locked")
        throw refuse(
          429,
          "joinLocked",
          (m) => m.collab.joinLocked({ minutes: Math.ceil(result.retryAfter / 60) }),
          { retryAfter: result.retryAfter },
        );
      if (result.status === "invalid") {
        authLimiter.recordFailure(rateKey);
        throw invalidCode();
      }
      const { invite } = result;
      if ("self" in invite) {
        const found = participantOf(host, invite.self.token);
        if (!found) throw invalidCode();
        const { deviceId, deviceToken } = await mintDeviceIfNeeded(
          req,
          res,
          body.deviceName ?? `${found.person.name ?? ts.name} (Tailscale)`,
        );
        await host.run(async () => {
          await host.saveSide((draft) => {
            const current = sideEntry(draft.people, found.actor.id);
            if (!current || current.removedAt || current.disabledAt) throw invalidCode();
            current.tailscaleLogin = ts.login;
            if (deviceId && !current.deviceId) current.deviceId = deviceId;
            saveAccountSession(draft, found.actor.id, tokenHash);
          });
        });
        const fresh = personOf(host, found.actor.id) ?? found.person;
        res.status(201).json({
          groupId,
          ...identity({ actor: found.actor, person: fresh }),
          token: sessionToken,
          ...(deviceToken ? { deviceToken } : {}),
        } satisfies CollabJoinResponse);
        return;
      }
      if (invite.by !== undefined) {
        const inviter = personOf(host, invite.by);
        if (!inviter || inviter.removedAt || inviter.disabledAt) throw invalidCode();
      }
      const { deviceId, deviceToken } = await mintDeviceIfNeeded(
        req,
        res,
        body.deviceName ?? `${invite.name} (Tailscale)`,
      );
      const joined = await host.run(async () => {
        const { id } = await host
          .coordinator()
          .addParticipant(collabId("m"), invite.admin ? "admin" : "member");
        await host.saveSide((draft) => {
          (draft.people ??= {})[id] = {
            name: invite.name,
            joinedAt: new Date().toISOString(),
            tailscaleLogin: ts.login,
            ...(invite.admin ? { admin: true } : {}),
            ...(deviceId !== undefined ? { deviceId } : {}),
          };
          saveAccountSession(draft, id, tokenHash);
        });
        return {
          groupId,
          id,
          name: invite.name,
          tailscaleLogin: ts.login,
          ...(invite.admin ? { admin: true } : {}),
          token: sessionToken,
          ...(deviceToken ? { deviceToken } : {}),
        } satisfies CollabJoinResponse;
      });
      log.info(`group: ${joined.id} joined via tailscale`);
      res.status(201).json(joined);
      return;
    }
    // Bootstrap first admin automatically when the group has no active members yet.
    const hasAnyActive = Object.values(side.people ?? {}).some((p) => !p.removedAt);
    if (!hasAnyActive) {
      const { deviceId, deviceToken } = await mintDeviceIfNeeded(
        req,
        res,
        body.deviceName ?? `${ts.name} (Tailscale)`,
      );
      const bootstrapped = await host.run(async () => {
        if (Object.values(host.side().people ?? {}).some((p) => !p.removedAt))
          throw refuse(403, "tailscaleUnlinked", (m) =>
            m.collab.tailscaleUnlinked({ login: ts.login }),
          );
        const { id } = await host.coordinator().addParticipant(collabId("m"), "admin");
        await host.saveSide((draft) => {
          (draft.people ??= {})[id] = {
            name: ts.name,
            joinedAt: new Date().toISOString(),
            admin: true,
            tailscaleLogin: ts.login,
            ...(deviceId !== undefined ? { deviceId } : {}),
          };
          saveAccountSession(draft, id, tokenHash);
        });
        return {
          groupId,
          id,
          name: ts.name,
          admin: true as const,
          tailscaleLogin: ts.login,
          token: sessionToken,
          ...(deviceToken ? { deviceToken } : {}),
        } satisfies CollabJoinResponse;
      });
      log.info(`group: ${bootstrapped.id} bootstrapped admin via tailscale`);
      res.status(201).json(bootstrapped);
      return;
    }
    throw refuse(403, "tailscaleUnlinked", (m) => m.collab.tailscaleUnlinked({ login: ts.login }));
  });

  app.get("/api/collab", (req, res) => {
    const status = host.status();
    const found =
      status.state === "ready" ? participantOf(host, req.get(participantHeader)) : undefined;
    const ts = readTailscaleIdentity(req, tailscaleAuth);
    const { groupId } = host.side();
    const hostCaller = atHost(res);
    const body: CollabInfo = {
      ...status,
      ...(groupId ? { groupId } : {}),
      host: hostCaller,
      ...(!hostCaller && canRemoteBootstrap() ? { canBootstrap: true as const } : {}),
      ...(ts ? { tailscaleAvailable: true, tailscaleLogin: ts.login, tailscaleName: ts.name } : {}),
      ...(found ? { me: identity(found) } : {}),
    };
    res.json(body);
  });

  app.post("/api/collab/setup", async (req, res) => {
    emptySchema.parse(req.body);
    if (!atHost(res) && !canRemoteBootstrap())
      throw refuse(403, "hostOnly", (m) => m.collab.hostOnly);
    await host.run(() => host.setUp());
    const body: CollabSetupResponse = { state: "ready", groupId: host.side().groupId ?? "" };
    res.status(201).json(body);
  });

  app.post("/api/collab/bootstrap", async (req, res) => {
    const body = bootstrapSchema.parse(req.body);
    if (host.status().state === "stopped") {
      ready(host, res);
      return;
    }
    if (!atHost(res) && !canRemoteBootstrap()) {
      if (remoteBootstrap && host.status().state === "ready") throw adminOnly();
      throw refuse(403, "hostOnly", (m) => m.collab.hostOnly);
    }
    let username: string | undefined;
    let passwordHash: string | undefined;
    if (body.username !== undefined || body.password !== undefined) {
      username = normalizeUsername(body.username);
      if (!username || !validPassword(body.password)) throw invalidAccountInput();
      passwordHash = await hashPassword(body.password);
    }
    const ts = readTailscaleIdentity(req, tailscaleAuth);
    const deviceId: string | undefined = res.locals.deviceId;
    const { token: sessionToken, tokenHash } = issueAccountSessionToken();
    const created: CollabJoinResponse = await host.run(async () => {
      if (!atHost(res) && host.status().state === "ready" && activeAdminIds(host.side()).size > 0)
        throw adminOnly();
      if (host.status().state === "notSetUp") await host.setUp();
      if (username && usernameOwner(host.side(), username)) throw usernameTaken();
      const tsTaken =
        ts &&
        Object.values(host.side().people ?? {}).some(
          (person) => !person.removedAt && person.tailscaleLogin?.toLowerCase() === ts.login,
        );
      const { id, token: coordToken } = await host
        .coordinator()
        .addParticipant(collabId("m"), "admin");
      const boundTs = ts && !tsTaken ? ts.login : undefined;
      await host.saveSide((draft) => {
        (draft.people ??= {})[id] = {
          name: body.name,
          joinedAt: new Date().toISOString(),
          admin: true,
          ...(deviceId !== undefined ? { deviceId } : {}),
          ...(username ? { username } : {}),
          ...(passwordHash ? { passwordHash } : {}),
          ...(boundTs ? { tailscaleLogin: boundTs } : {}),
        };
        if (username || boundTs) saveAccountSession(draft, id, tokenHash);
      });
      return {
        groupId: host.side().groupId ?? "",
        id,
        name: body.name,
        admin: true as const,
        ...(username ? { username } : {}),
        ...(boundTs ? { tailscaleLogin: boundTs } : {}),
        token: username || boundTs ? sessionToken : coordToken,
      };
    });
    log.info(`group: ${created.id} bootstrapped admin`);
    res.status(201).json(created);
  });

  app.post("/api/collab/invites", async (req, res) => {
    const body = inviteSchema.parse(req.body);
    if (!ready(host, res)) return;
    const token = req.get(participantHeader) ?? "";
    const found = participantOf(host, token);
    if ("email" in body || "link" in body) {
      let by: string | undefined;
      if (!atHost(res) && !canRemoteBootstrap()) {
        if (!found) throw notJoined();
        if (found.actor.role !== "admin") throw adminOnly();
        by = found.actor.id;
      }
      let email: string | undefined;
      if (body.email !== undefined) {
        email = normalizeEmail(body.email);
        if (!email) throw invalidEmail();
        if (emailOwner(host.side(), email)) throw emailTaken();
      }
      const { token: inviteToken, tokenHash } = issueInviteToken();
      const now = Date.now();
      const createdAt = new Date(now).toISOString();
      const expiresAt = new Date(now + emailInviteTtl).toISOString();
      await host.run(async () => {
        await host.saveSide((draft) => {
          pruneEmailInvites(draft, now);
          if (email && emailOwner(draft, email)) throw emailTaken();
          const map = (draft.emailInvites ??= {});
          if (email) {
            for (const [id, existing] of Object.entries(map)) {
              if (existing.email?.toLowerCase() === email) delete map[id];
            }
          }
          if (Object.keys(map).length >= maxEmailInvites) {
            throw refuse(429, "tooManyInvites", (m) =>
              m.collab.tooManyInvites({ max: maxEmailInvites, minutes: emailInviteTtl / 60_000 }),
            );
          }
          map[collabId("i")] = {
            tokenHash,
            ...(email ? { email } : {}),
            ...(body.admin ? { admin: true } : {}),
            ...(by ? { createdBy: by } : {}),
            createdAt,
            expiresAt,
          };
        });
      });
      const base = publicUrl
        ? new URL(publicUrl).origin
        : req.get("origin") || `${req.protocol}://${req.headers.host}`;
      const inviteUrl = `${base}/pair#invite=${inviteToken}`;
      res.status(201).json({
        code: inviteToken,
        inviteToken,
        inviteUrl,
        ...(email ? { email } : {}),
        expiresAt,
      } satisfies CollabInviteResponse);
      return;
    }
    let invite: Invite;
    if ("self" in body) {
      if (!found) throw notJoined();
      invite = { self: { id: found.actor.id, token } };
    } else {
      // The person at the host (or remote bootstrap caller before any admin joins) can invite the first admin.
      let by: string | undefined;
      if (!atHost(res) && !canRemoteBootstrap()) {
        if (!found) throw notJoined();
        if (found.actor.role !== "admin") throw adminOnly();
        by = found.actor.id;
      }
      invite = { name: body.name, ...(body.admin ? { admin: true } : {}), ...(by ? { by } : {}) };
    }
    const created = invites.create(invite);
    if (!created)
      throw refuse(429, "tooManyInvites", (m) =>
        m.collab.tooManyInvites({ max: maxInvites, minutes: inviteTtl / 60_000 }),
      );
    const answer: CollabInviteResponse = {
      code: created.code,
      expiresAt: new Date(created.expiresAt).toISOString(),
    };
    res.status(201).json(answer);
  });

  app.post("/api/collab/join", async (req, res) => {
    const { code, username: rawUsername, password: rawPassword } = joinSchema.parse(req.body);
    if (!ready(host, res)) return;
    let username: string | undefined;
    let passwordHash: string | undefined;
    if (rawUsername !== undefined || rawPassword !== undefined) {
      username = normalizeUsername(rawUsername);
      if (!username || !validPassword(rawPassword)) throw invalidAccountInput();
      if (usernameOwner(host.side(), username)) throw usernameTaken();
      passwordHash = await hashPassword(rawPassword);
    }
    const deviceId: string | undefined = res.locals.deviceId;
    const result = invites.redeem(code, deviceId ?? "install");
    if (result.status === "locked")
      throw refuse(
        429,
        "joinLocked",
        (m) => m.collab.joinLocked({ minutes: Math.ceil(result.retryAfter / 60) }),
        { retryAfter: result.retryAfter },
      );
    if (result.status === "invalid") throw invalidCode();
    const { invite } = result;
    const groupId = host.side().groupId ?? "";
    if ("self" in invite) {
      // The same identity and token on another device: no participant is added.
      const found = participantOf(host, invite.self.token);
      if (!found) throw invalidCode();
      if (username && passwordHash) {
        await host.run(async () => {
          await host.saveSide((draft) => {
            const other = usernameOwner(draft, username);
            if (other && other !== found.actor.id) throw usernameTaken();
            const entry = sideEntry(draft.people, found.actor.id);
            if (entry && !entry.removedAt) {
              entry.username = username;
              entry.passwordHash = passwordHash;
            }
          });
        });
      }
      const fresh = personOf(host, found.actor.id) ?? found.person;
      const body: CollabJoinResponse = {
        groupId,
        ...identity({ actor: found.actor, person: fresh }),
        token: invite.self.token,
      };
      res.status(201).json(body);
      return;
    }
    // A code from an admin who was removed since is worth as little as their token.
    if (invite.by !== undefined) {
      const inviter = personOf(host, invite.by);
      if (!inviter || inviter.removedAt || inviter.disabledAt) throw invalidCode();
    }
    const body: CollabJoinResponse = await host.run(async () => {
      if (username && usernameOwner(host.side(), username)) throw usernameTaken();
      const { id, token } = await host
        .coordinator()
        .addParticipant(collabId("m"), invite.admin ? "admin" : "member");
      await host.saveSide((draft) => {
        (draft.people ??= {})[id] = {
          name: invite.name,
          joinedAt: new Date().toISOString(),
          ...(invite.admin ? { admin: true } : {}),
          ...(deviceId !== undefined ? { deviceId } : {}),
          ...(username ? { username } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        };
      });
      return {
        groupId,
        id,
        name: invite.name,
        ...(invite.admin ? { admin: true } : {}),
        ...(username ? { username } : {}),
        token,
      };
    });
    // The only log line: never the code or the token.
    log.info(`group: ${body.id} joined`);
    res.status(201).json(body);
  });

  const memberRecordOf = (id: string, person: Person): CollabMemberRecord => {
    const actor = host.coordinator().actorForHost(id);
    let heldCount = 0;
    for (const projectId of Object.keys(host.side().projects ?? {})) {
      heldCount += host
        .coordinator()
        .claimsForHost(projectId)
        .filter((claim) => claim.status === "held" && claim.holder === id).length;
    }
    return {
      id,
      name: person.name ?? id,
      ...(actor?.role === "admin" ? { admin: true } : {}),
      ...(person.username ? { username: person.username } : {}),
      ...(person.email ? { email: person.email } : {}),
      ...(person.tailscaleLogin ? { tailscaleLogin: person.tailscaleLogin } : {}),
      ...(person.disabledAt ? { disabled: true } : {}),
      ...(person.removedAt ? { removed: true } : {}),
      ...(person.joinedAt ? { joinedAt: person.joinedAt } : {}),
      heldCount,
    };
  };

  app.get("/api/collab/people", collabParticipant(host), (_req, res) => {
    const actor = res.locals.actor as Actor;
    if (actor.role !== "admin") throw adminOnly();
    const people: CollabMemberRecord[] = [];
    for (const [id, person] of Object.entries(host.side().people ?? {})) {
      if (person.removedAt) continue;
      people.push(memberRecordOf(id, person));
    }
    res.json({ people });
  });

  app.post("/api/collab/people", collabParticipant(host), async (req, res) => {
    const actor = res.locals.actor as Actor;
    if (actor.role !== "admin") throw adminOnly();
    const body = createPersonSchema.parse(req.body);
    const username =
      body.username !== undefined && body.username.trim() !== ""
        ? normalizeUsername(body.username)
        : undefined;
    const email =
      body.email !== undefined && body.email.trim() !== "" ? normalizeEmail(body.email) : undefined;
    if ((body.username !== undefined && body.username.trim() !== "" && !username) || (body.email !== undefined && body.email.trim() !== "" && !email))
      throw invalidAccountInput();
    if ((!username && !email) || !validPassword(body.password)) throw invalidAccountInput();
    const tsLogin = body.tailscaleLogin?.trim().toLowerCase() || undefined;
    if (tsLogin && !/^[^\s@]+@[^\s@]+$/.test(tsLogin)) throw invalidAccountInput();
    if (username && usernameOwner(host.side(), username)) throw usernameTaken();
    if (email && emailOwner(host.side(), email)) throw emailTaken();
    const passwordHash = await hashPassword(body.password);
    const person = await host.run(async () => {
      if (username && usernameOwner(host.side(), username)) throw usernameTaken();
      if (email && emailOwner(host.side(), email)) throw emailTaken();
      const { id } = await host
        .coordinator()
        .addParticipant(collabId("m"), body.admin ? "admin" : "member");
      const joinedAt = new Date().toISOString();
      await host.saveSide((draft) => {
        (draft.people ??= {})[id] = {
          name: body.name,
          joinedAt,
          passwordHash,
          ...(username ? { username } : {}),
          ...(email ? { email } : {}),
          ...(body.admin ? { admin: true } : {}),
          ...(tsLogin ? { tailscaleLogin: tsLogin } : {}),
        };
      });
      return memberRecordOf(id, personOf(host, id)!);
    });
    log.info(`group: ${person.id} created by admin ${actor.id}`);
    res.status(201).json({ person });
  });

  app.patch<{ id: string }>(
    "/api/collab/people/:id",
    collabParticipant(host),
    async (req, res) => {
      const actor = res.locals.actor as Actor;
      const { id } = req.params;
      const body = updatePersonSchema.parse(req.body);
      const isSelf = id === actor.id;
      if (!isSelf && actor.role !== "admin") throw adminOnly();
      if (
        !isSelf &&
        actor.role !== "admin" &&
        (body.admin !== undefined || body.disabled !== undefined || body.tailscaleLogin !== undefined)
      )
        throw adminOnly();
      if (isSelf && actor.role !== "admin" && (body.admin !== undefined || body.disabled !== undefined || body.tailscaleLogin !== undefined))
        throw adminOnly();
      if (isSelf && body.disabled === true)
        throw refuse(409, "self", (m) => m.collab.removeSelf);
      let nextUsername: string | undefined;
      if (body.username !== undefined) {
        nextUsername = normalizeUsername(body.username);
        if (!nextUsername) throw invalidAccountInput();
      }
      let nextEmail: string | null | undefined;
      if (body.email !== undefined) {
        if (body.email === null || body.email.trim() === "") {
          nextEmail = null;
        } else {
          const cleanEmail = normalizeEmail(body.email);
          if (!cleanEmail) throw invalidEmail();
          nextEmail = cleanEmail;
        }
      }
      let nextPasswordHash: string | undefined;
      if (body.password !== undefined) {
        if (!validPassword(body.password)) throw invalidAccountInput();
        nextPasswordHash = await hashPassword(body.password);
      }
      let nextTsLogin: string | null | undefined;
      if (body.tailscaleLogin !== undefined) {
        if (body.tailscaleLogin === null || body.tailscaleLogin.trim() === "") {
          nextTsLogin = null;
        } else {
          const clean = body.tailscaleLogin.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw invalidAccountInput();
          nextTsLogin = clean;
        }
      }
      const updated = await host.run(async () => {
        const target = personOf(host, id);
        if (!target || target.removedAt)
          throw refuse(404, "unknownPerson", (m) => m.collab.unknownPerson);
        if (nextUsername) {
          const owner = usernameOwner(host.side(), nextUsername);
          if (owner && owner !== id) throw usernameTaken();
        }
        if (nextEmail) {
          const owner = emailOwner(host.side(), nextEmail);
          if (owner && owner !== id) throw emailTaken();
        }
        if (body.disabled === true) {
          const admins = activeAdminIds(host.side());
          if (admins.has(id) && admins.size <= 1)
            throw refuse(409, "lastAdmin", (m) => m.collab.lastAdmin);
        }
        if (body.admin !== undefined && actor.role === "admin") {
          try {
            await host
              .coordinator()
              .setParticipantRole(
                actor,
                id,
                body.admin ? "admin" : "member",
                activeAdminIds(host.side()),
              );
          } catch (error) {
            if (error instanceof AppError && error.message.includes("At least one active administrator"))
              throw refuse(409, "lastAdmin", (m) => m.collab.lastAdmin);
            throw error;
          }
        }
        await host.saveSide((draft) => {
          const entry = sideEntry(draft.people, id);
          if (!entry || entry.removedAt)
            throw refuse(404, "unknownPerson", (m) => m.collab.unknownPerson);
          if (body.name !== undefined) entry.name = body.name;
          if (body.admin !== undefined) {
            if (body.admin) entry.admin = true;
            else delete entry.admin;
          }
          if (nextUsername !== undefined) entry.username = nextUsername;
          if (nextEmail !== undefined) {
            if (nextEmail === null) delete entry.email;
            else entry.email = nextEmail;
          }
          if (nextPasswordHash !== undefined) {
            entry.passwordHash = nextPasswordHash;
            if (!isSelf) dropPersonSessions(draft, id);
          }
          if (nextTsLogin !== undefined) {
            if (nextTsLogin === null) delete entry.tailscaleLogin;
            else entry.tailscaleLogin = nextTsLogin;
          }
          if (body.disabled !== undefined) {
            if (body.disabled) {
              entry.disabledAt = new Date().toISOString();
              dropPersonSessions(draft, id);
              dropPersonEmailInvites(draft, id);
            } else {
              delete entry.disabledAt;
            }
          }
        });
        if (body.disabled === true) {
          hub.forget(id);
          await revokeAllHoldsOf(actor, id);
          invites.drop(id);
        }
        hub.changed();
        return memberRecordOf(id, personOf(host, id)!);
      });
      res.json({ person: updated });
    },
  );

  app.post<{ id: string }>(
    "/api/collab/people/:id/remove",
    collabParticipant(host),
    async (req, res) => {
      const { unpair } = removeSchema.parse(req.body);
      const actor = res.locals.actor as Actor;
      if (actor.role !== "admin") throw adminOnly();
      const { id } = req.params;
      if (id === actor.id) throw refuse(409, "self", (m) => m.collab.removeSelf);
      let revoked = 0;
      const deviceId = await host.run(async () => {
        const person = personOf(host, id);
        if (!person) throw refuse(404, "unknownPerson", (m) => m.collab.unknownPerson);
        if (!person.removedAt) {
          await host.saveSide((draft) => {
            // One removal at a time: an admin removed a moment ago removes nobody.
            if (draft.people![actor.id]?.removedAt || draft.people![actor.id]?.disabledAt)
              throw notJoined();
            draft.people![id].removedAt = new Date().toISOString();
            dropPersonSessions(draft, id);
            dropPersonEmailInvites(draft, id);
          });
          log.info(`group: ${id} removed by ${actor.id}`);
        }
        hub.forget(id);
        revoked = await revokeAllHoldsOf(actor, id);
        return person.deviceId;
      });
      // What they left waiting goes with them: the codes they gave out and their own.
      invites.drop(id);
      // Removing never unpairs by itself: only when asked, through pairing's own code,
      // and never the device this request comes from or one a current person joined from.
      const shared =
        deviceId === res.locals.deviceId ||
        Object.values(host.side().people ?? {}).some(
          (other) => !other.removedAt && other.deviceId === deviceId,
        );
      let unpaired = false;
      if (unpair && deviceId && !shared && devices && tokenFile) {
        const installToken = readApiToken(tokenFile);
        if (installToken) unpaired = await devices.revoke(deviceId, installToken);
      }
      const body: CollabRemoveResponse = { revoked, unpaired };
      res.json(body);
    },
  );

  app.use("/api/collab", collabErrors);
}
