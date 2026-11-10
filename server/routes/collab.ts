/**
 * Group work: GET /api/collab, POST /api/collab/setup, POST
 * /api/collab/invites, POST /api/collab/join and POST
 * /api/collab/people/:id/remove. Registered only when BELL PR was started
 * with --group.
 *
 * The guard runs first, so every request already carries the app token
 * (install or device). Who is asking within the group is the participant
 * token in `x-bell-participant`, and the coordinator alone decides whose
 * it is. A participant problem is answered 403 `notJoined`, never 401: the
 * interface takes a 401 to mean this device is no longer paired.
 */
import type { Express, RequestHandler, Response } from "express";
import { z } from "zod";
import type {
  CollabInfo,
  CollabInviteResponse,
  CollabJoinResponse,
  CollabRemoveResponse,
  CollabSetupResponse,
} from "../../shared/collab.js";
import { readApiToken } from "../api-token.js";
import { collabId, type CollabHost, type CollabSide } from "../collab-host.js";
import { CollabInvites, type Invite } from "../collab-invites.js";
import { participantHeader } from "../coordination-routes.js";
import type { Actor } from "../coordination.js";
import type { DeviceTokens } from "../device-tokens.js";
import { sm } from "../i18n/index.js";
import { log } from "../log.js";
import { AppError } from "../types.js";
import { deviceName } from "./pairing.js";

type Person = NonNullable<CollabSide["people"]>[string];

const emptySchema = z.strictObject({});
const inviteSchema = z.union([
  z.strictObject({ name: deviceName.max(40), admin: z.literal(true).optional() }),
  z.strictObject({ self: z.literal(true) }),
]);
const joinSchema = z.strictObject({ code: z.string().max(32) });
const removeSchema = z.strictObject({ unpair: z.literal(true).optional() });

const refuse = (status: number, reason: string, message: ConstructorParameters<typeof AppError>[0]) =>
  new AppError(message, status, { details: { reason } });
const notJoined = () => refuse(403, "notJoined", (m) => m.collab.notJoined);
const adminOnly = () => refuse(403, "adminOnly", (m) => m.collab.adminOnly);
const invalidCode = () => refuse(400, "invalidCode", (m) => m.collab.invalidCode);

/** The side file's entry for an id; own keys only, so no id reaches Object.prototype. */
function personOf(host: CollabHost, id: string): Person | undefined {
  const people = host.side().people;
  return people && Object.hasOwn(people, id) ? people[id] : undefined;
}

/** Who a participant token belongs to; undefined when missing, unknown or removed. */
export function participantOf(
  host: CollabHost,
  token: unknown,
): { actor: Actor; person: Person } | undefined {
  let actor: Actor;
  try {
    actor = host.coordinator().authenticate(token);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) return undefined;
    throw error;
  }
  const person = personOf(host, actor.id);
  return person && !person.removedAt ? { actor, person } : undefined;
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
  { devices, tokenFile }: { devices?: DeviceTokens; tokenFile?: string } = {},
) {
  const invites = new CollabInvites();
  /** The person at the host: the install token, not a paired device. */
  const atHost = (res: Response) => res.locals.deviceId === undefined;
  const identity = ({ actor, person }: { actor: Actor; person: Person }) => ({
    id: actor.id,
    name: person.name ?? actor.id,
    ...(actor.role === "admin" ? { admin: true as const } : {}),
  });

  app.get("/api/collab", (req, res) => {
    const status = host.status();
    const found =
      status.state === "ready" ? participantOf(host, req.get(participantHeader)) : undefined;
    const { groupId } = host.side();
    const body: CollabInfo = {
      ...status,
      ...(groupId ? { groupId } : {}),
      host: atHost(res),
      ...(found ? { me: identity(found) } : {}),
    };
    res.json(body);
  });

  app.post("/api/collab/setup", async (req, res) => {
    emptySchema.parse(req.body);
    if (!atHost(res)) throw refuse(403, "hostOnly", (m) => m.collab.hostOnly);
    await host.run(() => host.setUp());
    const body: CollabSetupResponse = { state: "ready", groupId: host.side().groupId ?? "" };
    res.status(201).json(body);
  });

  app.post("/api/collab/invites", (req, res) => {
    const body = inviteSchema.parse(req.body);
    if (!ready(host, res)) return;
    const token = req.get(participantHeader) ?? "";
    const found = participantOf(host, token);
    let invite: Invite;
    if ("self" in body) {
      if (!found) throw notJoined();
      invite = { self: { id: found.actor.id, token } };
    } else {
      // The person at the host can always invite: that is how the first admin joins.
      if (!atHost(res)) {
        if (!found) throw notJoined();
        if (found.actor.role !== "admin") throw adminOnly();
      }
      invite = { name: body.name, ...(body.admin ? { admin: true } : {}) };
    }
    const created = invites.create(invite);
    if (!created) throw refuse(429, "tooManyInvites", (m) => m.collab.tooManyInvites);
    const answer: CollabInviteResponse = {
      code: created.code,
      expiresAt: new Date(created.expiresAt).toISOString(),
    };
    res.status(201).json(answer);
  });

  app.post("/api/collab/join", async (req, res) => {
    const { code } = joinSchema.parse(req.body);
    if (!ready(host, res)) return;
    const deviceId: string | undefined = res.locals.deviceId;
    const result = invites.redeem(code, deviceId ?? "install");
    if (result.status === "locked")
      throw new AppError(
        (m) => m.collab.joinLocked({ minutes: Math.ceil(result.retryAfter / 60) }),
        429,
        { details: { reason: "joinLocked", retryAfter: result.retryAfter } },
      );
    if (result.status === "invalid") throw invalidCode();
    const { invite } = result;
    const groupId = host.side().groupId ?? "";
    if ("self" in invite) {
      // The same identity and token on another device: no participant is added.
      const found = participantOf(host, invite.self.token);
      if (!found) throw invalidCode();
      const body: CollabJoinResponse = { groupId, ...identity(found), token: invite.self.token };
      res.status(201).json(body);
      return;
    }
    const body: CollabJoinResponse = await host.run(async () => {
      const { id, token } = await host
        .coordinator()
        .addParticipant(collabId("m"), invite.admin ? "admin" : "member");
      await host.saveSide((draft) => {
        (draft.people ??= {})[id] = {
          name: invite.name,
          joinedAt: new Date().toISOString(),
          ...(invite.admin ? { admin: true } : {}),
          ...(deviceId !== undefined ? { deviceId } : {}),
        };
      });
      return { groupId, id, name: invite.name, ...(invite.admin ? { admin: true } : {}), token };
    });
    // The only log line: never the code or the token.
    log.info(`group: ${body.id} joined`);
    res.status(201).json(body);
  });

  app.post<{ id: string }>(
    "/api/collab/people/:id/remove",
    collabParticipant(host),
    async (req, res) => {
      const { unpair } = removeSchema.parse(req.body);
      const actor = res.locals.actor as Actor;
      if (actor.role !== "admin") throw adminOnly();
      const { id } = req.params;
      if (id === actor.id) throw refuse(409, "self", (m) => m.collab.removeSelf);
      const deviceId = await host.run(async () => {
        const person = personOf(host, id);
        if (!person) throw refuse(404, "unknownPerson", (m) => m.collab.unknownPerson);
        if (!person.removedAt)
          await host.saveSide((draft) => {
            draft.people![id].removedAt = new Date().toISOString();
          });
        return person.deviceId;
      });
      let unpaired = false;
      if (unpair && deviceId && devices && tokenFile) {
        // Removing never unpairs by itself: only when asked, through pairing's own code.
        const installToken = readApiToken(tokenFile);
        if (installToken) unpaired = await devices.revoke(deviceId, installToken);
      }
      log.info(`group: ${id} removed by ${actor.id}`);
      const body: CollabRemoveResponse = { revoked: 0, unpaired };
      res.json(body);
    },
  );
}
