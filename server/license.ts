/**
 * Licensing: the plan in effect and what it unlocks. These are the final
 * signatures; the offline license service (keys, trial, license.json)
 * implements LicenseService later. Until then `fixedLicense` reports a
 * constant plan.
 */
import type { ModelSettings } from "../shared/models.js";
import {
  freeEntitlements,
  proEntitlements,
  proOnlyEfforts,
  type Entitlements,
  type LicenseSummary,
  type Plan,
  type ProFeature,
} from "../shared/plans.js";
import { product } from "../shared/product.js";
import { defaultActiveRunLimit } from "./agent-slots.js";
import { AppError } from "./types.js";

export interface LicenseService {
  /** The license state shown in the UI and the CLI. */
  summary(): LicenseSummary;
  /** What the plan in effect unlocks. */
  entitlements(): Entitlements;
  /** Throws a 402 `pro_required` AppError unless the plan includes `f`. */
  assertFeature(f: ProFeature): void;
  /**
   * Throws a 402 `pro_required` AppError unless the plan allows the model
   * settings the person selected: web access needs `webAccess`, and an
   * effort in `proOnlyEfforts` needs `deepReasoning`. Only the raw selected
   * settings count, never a resolved default, so "Default" effort is fine
   * on every plan.
   */
  assertModelEntitlement(selected: ModelSettings): void;
}

function isProOnlyEffort(effort: ModelSettings["reasoningEffort"]) {
  return (proOnlyEfforts as readonly unknown[]).includes(effort);
}

/**
 * A license service with a constant plan, for tests and library use. Pro
 * and the trial allow everything and run up to `maxActiveRuns` at once
 * (default 2); Free allows no Pro feature and runs one contribution at a
 * time. Blocked features throw a 402 with code `pro_required` and the
 * details `{feature, plan}`.
 */
export function fixedLicense(
  plan: Plan,
  opts: { maxActiveRuns?: number } = {},
): LicenseService {
  const pro =
    plan === "free"
      ? undefined
      : proEntitlements(opts.maxActiveRuns ?? defaultActiveRunLimit);
  const entitlements: Entitlements = pro
    ? Object.freeze({ ...pro, plan, features: Object.freeze(pro.features) })
    : freeEntitlements;
  const summary: LicenseSummary =
    plan === "free"
      ? { plan, source: "none", status: "none", reason: "no_license" }
      : { plan, source: plan === "trial" ? "trial" : "none", status: "active" };
  const assertFeature = (feature: ProFeature) => {
    if (!entitlements.features[feature])
      throw new AppError((m) => m.license.proRequired, 402, {
        code: "pro_required",
        details: { feature, plan },
      });
  };
  return {
    summary: () => ({ ...summary }),
    entitlements: () => entitlements,
    assertFeature,
    assertModelEntitlement(selected) {
      if (selected.webAccess === true) assertFeature("webAccess");
      if (isProOnlyEffort(selected.reasoningEffort))
        assertFeature("deepReasoning");
    },
  };
}

/** What the command line passes to `bell-pr license`. */
export interface LicenseCliDeps {
  /** The resolved data directory, which holds license.json. */
  dataDir?: string;
  /** Where output goes; process.stdout by default. */
  stdout?: { write(text: string): unknown };
}

/**
 * `bell-pr license <status|activate|deactivate|trial>`. Not implemented
 * yet: it says so and returns the exit code 0.
 */
export async function runLicenseCli(
  _argv: string[],
  deps: LicenseCliDeps = {},
): Promise<number> {
  (deps.stdout ?? process.stdout).write(
    `${product.binNames[0]} license: not implemented yet.\n`,
  );
  return 0;
}
