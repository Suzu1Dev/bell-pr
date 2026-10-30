/**
 * Device pairing: POST /api/pair/codes, POST /api/pair, GET /api/devices,
 * DELETE /api/devices/:id, POST /api/devices/rotate and POST
 * /api/pair/unlock. Registered only with the token file the guard reads.
 *
 * The guard runs first (Host, Origin, JSON body, token). POST /api/pair is
 * its only public path here; a device token arrives as res.locals.deviceId.
 * Codes, rotate and unlock need the install token. A device may list and
 * revoke any device, so a paired phone can revoke a lost one.
 */
import path from "node:path";
import type { Express, RequestHandler, Response } from "express";
import { z } from "zod";
import type { PairCodeResponse, PairLockedResponse, PairRedeemResponse } from "../../shared/pairing.js";
import { readApiToken, rotateApiToken } from "../api-token.js";
import { DeviceTokens } from "../device-tokens.js";
import { sm } from "../i18n/index.js";
import { log } from "../log.js";
import { clearPairing, Pairing, type PairLocked } from "../pairing.js";
import type { AppOptions } from "../app.js";

/** No control or bidirectional-override characters in a device name. */
const deviceName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[^\p{Cc}‪-‮⁦-⁩]+$/u);
const createCodeSchema = z.object({ name: deviceName.optional() }).strict();
const redeemSchema = z.object({ code: z.string().max(32), name: deviceName.optional() }).strict();
const emptySchema = z.object({}).strict();

/** Every pairing and devices answer: never cached, never sent on as a Referer. */
const pairingHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
};

function sendLocked(res: Response, locked: PairLocked) {
  const body: PairLockedResponse = {
    error: "pairing_locked",
    ...(locked.lockedUntil !== undefined ? { lockedUntil: new Date(locked.lockedUntil).toISOString() } : {}),
    hint: sm().cli.pair.unlockHint,
  };
  res.status(423).json(body);
}

export function registerPairingRoutes(
  app: Express,
  tokenFile: string,
  { devices, pairing, publicUrl }: { devices: DeviceTokens; pairing: Pairing; publicUrl: AppOptions["publicUrl"] },
) {
  const dataDir = path.dirname(tokenFile);
  app.use(["/api/pair", "/api/devices"], pairingHeaders);

  /** The install token, when the request was made with it; else answers and returns undefined. */
  const installOnly = (res: Response): string | undefined => {
    const token = readApiToken(tokenFile);
    if (!token) {
      res.status(401).json({ error: sm().common.apiTokenRequired });
      return undefined;
    }
    if (res.locals.deviceId !== undefined) {
      res.status(403).json({ error: "install_token_required" });
      return undefined;
    }
    return token;
  };
  const installToken = (res: Response): string | undefined => {
    const token = readApiToken(tokenFile);
    if (!token) res.status(401).json({ error: sm().common.apiTokenRequired });
    return token;
  };

  app.post("/api/pair/codes", async (req, res) => {
    const { name } = createCodeSchema.parse(req.body);
    const token = installOnly(res);
    if (!token) return;
    const result = await pairing.createCode(token, name);
    if (result.status === "locked") return sendLocked(res, result);
    // Host was checked by the guard; the public URL wins when there is one.
    const base = publicUrl ? new URL(publicUrl).origin : `${req.protocol}://${req.headers.host}`;
    const body: PairCodeResponse = {
      code: result.code,
      expiresAt: new Date(result.expiresAt).toISOString(),
      pairUrl: `${base}/pair`,
    };
    res.status(201).json(body);
  });

  app.post("/api/pair", async (req, res) => {
    const { code, name } = redeemSchema.parse(req.body);
    const token = readApiToken(tokenFile);
    if (!token) {
      res.status(401).json({ error: "invalid_code" });
      return;
    }
    const result = await pairing.redeem(code, name, sm().cli.pair.defaultDeviceName, token);
    if (result.status === "locked") return sendLocked(res, result);
    if (result.status === "invalid") {
      res.status(401).json({ error: "invalid_code" });
      return;
    }
    // The only log line: never the code or the token.
    log.info(`device paired: ${result.id} ${result.name}`);
    const body: PairRedeemResponse = { deviceId: result.id, token: result.token, name: result.name };
    res.status(201).json(body);
  });

  app.post("/api/pair/unlock", async (req, res) => {
    emptySchema.parse(req.body);
    if (!installOnly(res)) return;
    await pairing.unlock();
    res.status(204).end();
  });

  app.get("/api/devices", (_req, res) => {
    const token = installToken(res);
    if (!token) return;
    res.json(devices.list(token, res.locals.deviceId));
  });

  app.post("/api/devices/rotate", async (req, res) => {
    emptySchema.parse(req.body);
    if (!installOnly(res)) return;
    await rotateApiToken(tokenFile);
    await clearPairing(dataDir);
    res.status(204).end();
  });

  app.delete("/api/devices/:id", async (req, res) => {
    emptySchema.parse(req.body);
    const token = installToken(res);
    if (!token) return;
    if (!(await devices.revoke(req.params.id, token))) {
      res.status(404).json({ error: sm().common.notFound });
      return;
    }
    res.status(204).end();
  });
}
