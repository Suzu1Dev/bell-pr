import type { Express, Request, Response } from "express";
import { z } from "zod";
import { readApiToken, tokensMatch } from "../api-token.js";
import { dataPaths } from "../config.js";
import { sm } from "../i18n/index.js";
import { PasswordlessSudo, sudoEnableSchema } from "../sudo.js";
import { SudoAudit, type SudoRequestContext } from "../sudo-audit.js";
import type { RouteDeps } from "./types.js";

const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;
const forwardingHeaders = ["x-forwarded-for", "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-real-ip"];

/** 127.0.0.0/8 and ::1, also as IPv4-mapped IPv6. */
export function loopbackAddress(address: string | undefined) {
  if (!address) return false;
  const v4 = address.toLowerCase().replace(/^::ffff:/, "");
  return address === "::1" || /^127(?:\.\d{1,3}){3}$/.test(v4);
}

/** Authorization: Bearer, or X-Bell-Token when Authorization is absent, as the API guard reads them. */
function presentedToken(req: Request) {
  const authorization = req.get("authorization");
  const raw =
    authorization !== undefined
      ? (/^Bearer\s+(\S+)\s*$/i.exec(authorization)?.[1] ?? "")
      : (req.get("x-bell-token")?.trim() ?? "");
  return raw.length > 256 ? "" : raw;
}

/**
 * Why a request may not use the sudo helper, or undefined when it may:
 * only the install token, from this computer, addressed to a local host
 * name, and not relayed by a proxy.
 */
export function sudoDenial(
  req: Request,
  res: Response,
  installToken: string | undefined,
  publicUrl: string | undefined,
): { reason: string; context: SudoRequestContext } | undefined {
  const host = (req.headers.host ?? "").toLowerCase();
  const token = presentedToken(req);
  const tokenType =
    res.locals.deviceId !== undefined
      ? "device"
      : installToken && token && tokensMatch(installToken, token)
        ? "host"
        : "none";
  const context: SudoRequestContext = {
    remoteAddr: req.socket.remoteAddress ?? null,
    host: host || null,
    tokenType,
  };
  const publicHost = publicUrl ? new URL(publicUrl).host.toLowerCase() : undefined;
  const reason =
    tokenType === "device"
      ? "device_token"
      : tokenType !== "host"
        ? "no_host_token"
        : !loopbackAddress(req.socket.remoteAddress)
          ? "remote_address"
          : forwardingHeaders.some((name) => req.headers[name] !== undefined)
            ? "forwarded"
            : publicHost !== undefined && host === publicHost
              ? "public_host"
              : /\.ts\.net(?::\d+)?$/.test(host)
                ? "tailnet_host"
                : !loopbackHost.test(host)
                  ? "host"
                  : undefined;
  return reason ? { reason, context } : undefined;
}

/** Same-origin checks and JSON error handling are installed by createApp. */
export function registerSudoRoutes(app: Express, { options, workbench }: RouteDeps) {
  const sudo =
    options.sudo ??
    new PasswordlessSudo({ audit: new SudoAudit(dataPaths(workbench.store.directory).sudoAudit) });
  const installToken = () => {
    const file = options.apiTokenFile;
    const reader = file ? () => readApiToken(file) : options.readApiToken;
    return reader?.() ?? options.apiToken;
  };
  // Checked here as well as by the API guard, for every method and sub-path.
  app.use("/api/system/sudo", async (req, res, next) => {
    const denial = sudoDenial(req, res, installToken(), options.publicUrl);
    if (denial) {
      await sudo.audit.denied(denial.context, denial.reason);
      res.status(403).json({ error: sm().sudo.hostOnly });
      return;
    }
    res.locals.sudoContext = {
      remoteAddr: req.socket.remoteAddress ?? null,
      host: (req.headers.host ?? "").toLowerCase(),
      tokenType: "host",
    } satisfies SudoRequestContext;
    next();
  });
  app.get("/api/system/sudo", async (_req, res) => res.json({ sudo: await sudo.status() }));
  app.post("/api/system/sudo", async (req, res) => {
    const { password, ttlSeconds } = sudoEnableSchema.parse(req.body);
    // The parsed body is the only other copy of the password.
    req.body = undefined;
    res.json({ sudo: await sudo.enable(password, ttlSeconds, res.locals.sudoContext) });
  });
  app.delete("/api/system/sudo", async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    res.json({ sudo: await sudo.disable(res.locals.sudoContext) });
  });
}
