/**
 * BELL PR's side of the BELL Suite contract (docs/bell-suite.md): a manifest
 * that says what this product is and where the other BELL products are, and
 * a Today feed of the runs that wait for the person or for BELL PR. Both
 * only read, and both sit behind the request guard like every /api route.
 */
import type { Express } from "express";
import { locales, type Locale } from "../../shared/i18n/locale.js";
import { product } from "../../shared/product.js";
import { suiteRunRoute, type SuiteLinks, type SuiteManifest } from "../../shared/suite.js";
import { currentLocale, sm, withLocale } from "../i18n/index.js";
import { log } from "../log.js";
import { suiteFeedSchema, suiteManifestSchema } from "../suite-contract.js";
import { buildTodayFeed } from "../suite-feed.js";
import type { RouteDeps } from "./types.js";

/** The manifest in the language in effect, checked against the contract. */
function buildManifest(links: SuiteLinks): SuiteManifest {
  return suiteManifestSchema.parse({
    schemaVersion: 1,
    appId: "pr",
    displayName: product.name,
    summary: sm().common.suite.summary,
    capabilities: [
      { id: "runs.today", kind: "today-feed", api: "/api/suite/today" },
      { id: "run.open", kind: "object-route", route: suiteRunRoute },
    ],
    links,
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function registerSuiteRoutes(app: Express, { workbench, options }: RouteDeps) {
  // One manifest per language, built once: a manifest that breaks the
  // contract stops the start instead of reaching another product.
  const manifests = Object.fromEntries(
    locales.map((locale) => [
      locale,
      withLocale(locale, () => deepFreeze(buildManifest(options.suiteLinks ?? {}))),
    ]),
  ) as Record<Locale, SuiteManifest>;

  app.get("/api/suite/manifest", (_req, res) => {
    res.json(manifests[currentLocale()]);
  });

  app.get("/api/suite/today", (_req, res) => {
    const feed = suiteFeedSchema.safeParse(buildTodayFeed(workbench.store.data.runs));
    if (!feed.success) {
      // Only the count: an issue could quote a title, and a title may quote the person's request.
      log.error("The Suite feed broke its contract and was not sent", {
        issues: feed.error.issues.length,
      });
      res.status(500).json({ error: sm().common.internalError });
      return;
    }
    res.json(feed.data);
  });
}
