import type { AgentSlots } from "../agent-slots.js";
import type { AppOptions } from "../app.js";
import type { DiscoveryService } from "../discovery.js";
import type { ProjectInsightsService } from "../insights.js";
import type { Workbench } from "../workbench.js";

/**
 * What createApp gives every route module. Each server/routes/<name>.ts
 * exports `register<Name>Routes(app, deps: RouteDeps)`, and createApp calls
 * them in a fixed order before the /api 404 handler.
 */
export interface RouteDeps {
  workbench: Workbench;
  /** Project analysis; the same instance as app.locals.insights. */
  insights: ProjectInsightsService;
  /** GitHub-wide discovery; the same instance as app.locals.discovery. */
  discovery: DiscoveryService;
  /** CLI slots shared by runs, analysis and discovery. */
  agentSlots: AgentSlots;
  options: AppOptions;
}
