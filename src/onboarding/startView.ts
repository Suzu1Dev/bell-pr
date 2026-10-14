import type { AppSettings } from "../../shared/app-settings";
import { needsEulaAcceptance } from "./eula";

/** What the app shows first: nothing yet, the welcome flow or the app. */
export type StartView = "pending" | "welcome" | "shell";

/** Where one request of the first load stands (see useAppData). */
type LoadState = "pending" | "done" | "failed";

export interface StartInput {
  appSettings: AppSettings | null;
  loaded: { appSettings: LoadState; repos: LoadState; runs: LoadState };
  repos: readonly unknown[];
  runs: readonly unknown[];
}

/**
 * The welcome flow runs on a first start: onboarding was never finished and
 * there is no repository and no run (a data directory from before the
 * welcome flow goes straight to the app). It waits for the settings and,
 * when they ask for it, for the lists; a request that failed shows the app,
 * which reports the problem.
 */
export function startView({ appSettings, loaded, repos, runs }: StartInput): StartView {
  if (loaded.appSettings === "pending") return "pending";
  if (loaded.appSettings === "failed" || appSettings?.onboardingCompletedAt)
    return "shell";
  if (loaded.repos === "pending" || loaded.runs === "pending") return "pending";
  if (loaded.repos === "failed" || loaded.runs === "failed") return "shell";
  return repos.length || runs.length ? "shell" : "welcome";
}

/**
 * Whether the app must ask for the license agreement again: the settings
 * loaded and do not hold this build's `eulaVersion`. While they are
 * unknown nothing is asked; the welcome flow asks on a first start.
 */
export function needsEulaPrompt(
  appSettings: AppSettings | null,
  loaded: LoadState,
): boolean {
  return loaded === "done" && needsEulaAcceptance(appSettings);
}
