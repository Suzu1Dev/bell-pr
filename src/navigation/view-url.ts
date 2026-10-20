/**
 * Addresses written by the upstream BELL app, which kept the view in a
 * query string instead of the hash: `?run=<id>&tab=<tab>`, `?project=<id>`
 * or `?page=<page>`. A bookmark or a reload of such an address opens the
 * same contribution, tab, project or page here: adoptViewSearch() moves it
 * into the hash route (route.ts), the one place this app keeps the view.
 */
import { parseRoute, runTabs, serializeRoute, type Route } from "./route";

export const pages = [
  "workspace",
  "repos",
  "explore",
  "discovery",
  "team",
  "learning",
  "settings",
] as const;
export type Page = (typeof pages)[number];
export const tabs = runTabs;
export type Tab = (typeof tabs)[number];

/** Where the person was, as the query string kept it. */
export interface SavedView {
  page: Page;
  /** The contribution open on the workspace page; absent for the demo. */
  runId?: string;
  tab?: Tab;
  /** The project shown on the explore page. */
  repoId?: string;
}

const id = /^[A-Za-z0-9_-]{1,100}$/;

/** The view a query string names, or nothing when it names none. */
export function parseViewSearch(search: string): SavedView | undefined {
  const query = new URLSearchParams(search);
  const run = query.get("run");
  if (run && id.test(run)) {
    const tab = tabs.find((value) => value === query.get("tab"));
    return { page: "workspace", runId: run, tab };
  }
  const project = query.get("project");
  if (project && id.test(project)) return { page: "explore", repoId: project };
  const page = pages.find((value) => value === query.get("page"));
  return page && page !== "workspace" && page !== "explore" ? { page } : undefined;
}

/** The hash route that shows a saved view. */
export function routeForView(view: SavedView): Route {
  switch (view.page) {
    case "workspace":
      return view.runId
        ? {
            name: "run",
            runId: view.runId,
            ...(view.tab && view.tab !== "overview" ? { tab: view.tab } : {}),
          }
        : { name: "demo" };
    case "explore":
      return view.repoId ? { name: "repo", repoId: view.repoId } : { name: "repos" };
    case "discovery":
      return { name: "discover" };
    default:
      return { name: view.page };
  }
}

/** The query parameters a saved view uses; any others stay in the address. */
const viewParameters = ["run", "tab", "project", "page"];

/**
 * Moves a saved view from the query string into the hash, in place (Back
 * is unchanged), when the hash names no route of its own. Returns the
 * route it showed, or undefined when the address names no saved view.
 */
export function adoptViewSearch(
  win: Pick<Window, "location" | "history">,
): Route | undefined {
  const { location, history } = win;
  if (parseRoute(location.hash)) return undefined;
  const view = parseViewSearch(location.search);
  if (!view) return undefined;
  const query = new URLSearchParams(location.search);
  for (const name of viewParameters) query.delete(name);
  const rest = query.toString();
  const route = routeForView(view);
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${rest ? `?${rest}` : ""}${serializeRoute(route)}`,
  );
  return route;
}
