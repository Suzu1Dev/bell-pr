// The pages of the app that e2e/screenshots.spec.ts captures and
// e2e/responsive.spec.ts checks at more widths.
import { settingsSections } from "../../src/settings/sections";

/** Every page of the app, named after the file its screenshot is saved to. */
export const routes: { name: string; hash: string }[] = [
  { name: "home", hash: "#/home" },
  { name: "run-overview", hash: "#/runs/demo-run/overview" },
  { name: "run-changes", hash: "#/runs/demo-run/changes" },
  { name: "run-activity", hash: "#/runs/demo-run/activity" },
  { name: "run-draft", hash: "#/runs/demo-run/draft" },
  { name: "repos", hash: "#/repos" },
  { name: "repo-overview", hash: "#/repos/demo-repo" },
  { name: "discover", hash: "#/discover" },
  { name: "team", hash: "#/team" },
  { name: "learning", hash: "#/learning" },
  ...settingsSections.map((section) => ({
    name: `settings-${section}`,
    hash: `#/settings/${section}`,
  })),
  { name: "about", hash: "#/about" },
];

/** The routes that show the sample project, so present=1 shows its badge. */
export const sampleRoutes = /^(run-.+|repo-overview)$/;
