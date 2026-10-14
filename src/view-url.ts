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
export const tabs = ["overview", "changes", "activity", "draft", "commits"] as const;
export type Tab = (typeof tabs)[number];

/** Where the person is, kept in the address bar so a reload returns there. */
export interface SavedView {
  page: Page;
  /** The contribution open on the workspace page; absent for the demo. */
  runId?: string;
  tab?: Tab;
  /** The project shown on the explore page. */
  repoId?: string;
}

const id = /^[A-Za-z0-9_-]{1,100}$/;

/** The query string for a view: `?run=…&tab=…`, `?project=…` or `?page=…`. */
export function viewSearch(view: SavedView) {
  const query = new URLSearchParams();
  if (view.page === "workspace") {
    if (view.runId) {
      query.set("run", view.runId);
      if (view.tab && view.tab !== "overview") query.set("tab", view.tab);
    }
  } else if (view.page === "explore") {
    if (view.repoId) query.set("project", view.repoId);
  } else query.set("page", view.page);
  const text = query.toString();
  return text ? `?${text}` : "";
}

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
