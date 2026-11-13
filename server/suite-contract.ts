// suite-contract v1 (2026-11-08)
/**
 * The BELL Suite contract's rules for what BELL PR sends and for
 * BELLPR_SUITE_LINKS, written after the contract's reference validator.
 * The manifest is checked once at start and every feed before it is sent,
 * so a response that breaks the contract never leaves this server.
 */
import { z } from "zod";
import { suiteLimits, suiteRunRoute, type SuiteLinks } from "../shared/suite.js";
import { sm } from "./i18n/index.js";

const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const objectId = /^[A-Za-z0-9._:-]{1,128}$/;
const capabilityId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const routeTemplate = /^#\/[A-Za-z0-9/_\-.~{}]*$/;
const apiPath = /^\/api\/[A-Za-z0-9/_\-.]+$/;
/** Control characters and the characters that reorder text. */
export const unsafeText = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;

/** An id the contract accepts in a route: `.` and `..` would change the path. */
export function suiteObjectId(id: string): boolean {
  return objectId.test(id) && id !== "." && id !== "..";
}

/** The `href` of a run: its route with the id filled in. */
export function suiteRunHref(id: string): string {
  return suiteRunRoute.replace("{id}", id);
}

const text = (max: number) =>
  z.string().refine(
    (value) => value.trim() !== "" && [...value].length <= max && !unsafeText.test(value),
  );
const time = z.string().refine((value) => isoUtc.test(value) && !Number.isNaN(Date.parse(value)));
const count = z.number().int().min(0).max(suiteLimits.countMax);
const origin = z.string().refine((value) => URL.canParse(value) && new URL(value).origin === value);
const noDoubleSlash = (value: string) => !value.includes("//");

export const suiteManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    appId: z.literal("pr"),
    displayName: text(suiteLimits.displayName),
    summary: text(suiteLimits.summary),
    capabilities: z.array(
      z.discriminatedUnion("kind", [
        z
          .object({
            id: z.string().regex(capabilityId),
            kind: z.literal("today-feed"),
            api: z.string().regex(apiPath).refine((value) => noDoubleSlash(value) && !value.includes("..")),
          })
          .strict(),
        z
          .object({
            id: z.string().regex(capabilityId),
            kind: z.literal("object-route"),
            route: z.string().regex(routeTemplate).refine(noDoubleSlash),
          })
          .strict(),
      ]),
    ),
    links: z
      .object({
        explain: origin.optional(),
        personal: origin.optional(),
        reader: origin.optional(),
        campaign: origin.optional(),
      })
      .strict(),
  })
  .strict();

export const suiteFeedSchema = z
  .object({
    schemaVersion: z.literal(1),
    appId: z.literal("pr"),
    generatedAt: time,
    counts: z.object({ needsYou: count, waiting: count }).strict(),
    items: z
      .array(
        z
          .object({
            sourceApp: z.literal("pr"),
            type: z.literal("run"),
            id: z.string().refine(suiteObjectId),
            title: text(suiteLimits.title),
            href: z.string(),
            state: z.enum(["needs-you", "waiting"]),
            updatedAt: time,
            detail: text(suiteLimits.detail),
          })
          .strict()
          .refine((item) => item.href === suiteRunHref(item.id)),
      )
      .max(suiteLimits.items),
    truncated: z.boolean(),
  })
  .strict();

/** The tailnet of a `<machine>.<tailnet>.ts.net` name. */
function tailnetOf(hostname: string): string | undefined {
  const labels = hostname.toLowerCase().split(".");
  return labels.length >= 4 && labels.at(-2) === "ts" && labels.at(-1) === "net"
    ? labels.slice(-3).join(".")
    : undefined;
}

/** `URL.hostname` of localhost, 127.0.0.0/8 or [::1]. */
function loopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

/** The port an origin is reached on: its own, or its scheme's default. */
function effectivePort(url: URL): number {
  return Number(url.port) || (url.protocol === "https:" ? 443 : 80);
}

/**
 * Parses BELLPR_SUITE_LINKS: `explain=<origin>` and `personal=<origin>`,
 * separated by commas, each product once. An origin is on this computer,
 * or an https name in the tailnet of one of `ownOrigins`. A link back to
 * this BELL PR is refused: one of `ownOrigins`, or a loopback address on
 * one of `ownPorts` or on the port of a loopback entry of `ownOrigins` (a
 * local proxy in front of this server, under another loopback name). The
 * error names the variable and never the value, which may hold a private
 * host name.
 */
export function parseSuiteLinks(
  value: string | undefined,
  ownOrigins: readonly string[],
  ownPorts: readonly number[],
): SuiteLinks {
  const links: SuiteLinks = {};
  const entries = (value ?? "").trim();
  if (!entries) return links;
  const invalid = () => new Error(sm().security.suiteLinksInvalid);
  const own = ownOrigins.map((entry) => new URL(entry));
  const ownTailnets = new Set(own.map((url) => tailnetOf(url.hostname)));
  const refusedPorts = [
    ...ownPorts,
    ...own.filter((url) => loopbackHostname(url.hostname)).map(effectivePort),
  ];
  for (const entry of entries.split(",")) {
    const [, app, address] = /^([a-z]+)=(.+)$/.exec(entry.trim()) ?? [];
    if (
      (app !== "explain" && app !== "personal" && app !== "reader" && app !== "campaign") ||
      app in links
    )
      throw invalid();
    if (
      !/^https?:\/\/[^/?#\\\s@*]+$/i.test(address) ||
      address.endsWith(":") ||
      !URL.canParse(address)
    )
      throw invalid();
    const url = new URL(address);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.port === "0" ||
      ownOrigins.includes(url.origin)
    )
      throw invalid();
    if (loopbackHostname(url.hostname)) {
      if (refusedPorts.includes(effectivePort(url))) throw invalid();
    } else {
      const tailnet = tailnetOf(url.hostname);
      if (url.protocol !== "https:" || !tailnet || !ownTailnets.has(tailnet)) throw invalid();
    }
    links[app] = url.origin;
  }
  return links;
}
