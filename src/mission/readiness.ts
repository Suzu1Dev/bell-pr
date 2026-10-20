/**
 * Whether one AI provider is ready, read from the environment report
 * (GET /api/doctor). The report's own "provider-ready" check is about the
 * saved provider; a form that lets the person pick another one asks about
 * that one instead.
 */
import type { DoctorCheck, DoctorReport } from "../../shared/doctor";
import type { AgentProvider } from "../../shared/models";
import type { Readiness } from "../setup/ReadinessNotice";

/** ready, or why not: the CLI is missing, fails, or is not signed in. */
export type ProviderState = "ready" | "missing" | "broken" | "signed-out";

export interface ProviderReadiness {
  state: ProviderState;
  /** The checks that are not ok, with their details and fixes. */
  checks: DoctorCheck[];
}

/**
 * How ready `provider` is, the way the server counts a provider as ready:
 * its CLI works and is signed in. Undefined while the report is loading or
 * does not cover the provider.
 */
export function providerReadiness(
  report: DoctorReport | null | undefined,
  provider: AgentProvider,
): ProviderReadiness | undefined {
  const tool = report?.checks.find((check) => check.id === provider);
  if (!tool) return undefined;
  if (tool.status !== "ok")
    return {
      state: tool.status === "skip" || tool.reason === "missing" ? "missing" : "broken",
      checks: [tool],
    };
  const auth = report?.checks.find((check) => check.id === `${provider}-auth`);
  // An older report without the sign-in check blocks nothing.
  if (auth && auth.status !== "ok") return { state: "signed-out", checks: [auth] };
  return { state: "ready", checks: [] };
}

/**
 * `base` with the selected provider's problems added, for ReadinessMessage.
 * An unknown provider state adds nothing.
 */
export function withProvider(
  base: Readiness,
  provider: ProviderReadiness | undefined,
): Readiness {
  if (!provider || provider.state === "ready") return base;
  return {
    ready: false,
    checking: base.checking,
    missing: [...base.missing, { requirement: "provider", checks: provider.checks }],
  };
}
