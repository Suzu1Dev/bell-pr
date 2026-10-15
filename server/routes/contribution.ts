import type { Express } from "express";
import type { RouteDeps } from "./types.js";

/**
 * The respect routes (DESIGN §10): the project's rules card, the task
 * dialog's issue and pacing facts, refreshing a run's facts and the
 * weakened-test reasons, through Workbench.contribution. Never gated by
 * plan. L1 registers the module empty; L2B adds the routes.
 */
export function registerContributionRoutes(_app: Express, _deps: RouteDeps) {}
