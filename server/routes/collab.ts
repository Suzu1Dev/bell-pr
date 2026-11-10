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
import { collabId, sideEntry, type CollabHost, type CollabSide } from "../collab-host.js";
import { CollabInvites, inviteTtl, maxInvites, type Invite } from "../collab-invites.js";
import { adminOnly, collabErrors, notJoined, refuse } from "../collab-refusal.js";
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
]);
const joinSchema = z.strictObject({ code: z.string().max(32) });
const removeSchema = z.strictObject({ unpair: z.literal(true).optional() });

const invalidCode = () => refuse(400, "invalidCode", (m) => m.collab.invalidCode);

const personOf = (host: CollabHost, id: string): Person | undefined =>
  sideEntry(host.side().people, id);

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
  { store, devices, tokenFile }: { store: Store; devices?: DeviceTokens; tokenFile?: string },
) {
  const invites = new CollabInvites();
  const hub = registerCollabBoardRoutes(app, host, { store, participant: collabParticipant(host) });
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
      let by: string | undefined;
      if (!atHost(res)) {
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
    const { code } = joinSchema.parse(req.body);
    if (!ready(host, res)) return;
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
      const body: CollabJoinResponse = { groupId, ...identity(found), token: invite.self.token };
      res.status(201).json(body);
      return;
    }
    // A code from an admin who was removed since is worth as little as their token.
    if (invite.by !== undefined) {
      const inviter = personOf(host, invite.by);
      if (!inviter || inviter.removedAt) throw invalidCode();
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
      let revoked = 0;
      const deviceId = await host.run(async () => {
        const person = personOf(host, id);
        if (!person) throw refuse(404, "unknownPerson", (m) => m.collab.unknownPerson);
        if (!person.removedAt) {
          await host.saveSide((draft) => {
            // One removal at a time: an admin removed a moment ago removes nobody.
            if (draft.people![actor.id]?.removedAt) throw notJoined();
            draft.people![id].removedAt = new Date().toISOString();
          });
          log.info(`group: ${id} removed by ${actor.id}`);
        }
        hub.forget(id);
        // What they hold goes with them, in every repository of the group.
        const coordinator = host.coordinator();
        for (const projectId of Object.keys(host.side().projects ?? {}))
          for (const claim of coordinator.project(actor, projectId).claims) {
            if (claim.status !== "held" || claim.holder !== id) continue;
            try {
              await coordinator.revoke(actor, projectId, claim.id, {});
              revoked += 1;
            } catch (error) {
              // A hold that cannot end now (it just did, or its repository is closed)
              // stays on the board under the removed person's name.
              if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
            }
          }
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
