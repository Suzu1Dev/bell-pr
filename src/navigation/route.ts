/**
 * Hash routes: the page, the open run with its tab and file, and the
 * presentation flags live in the address after `#`, so a link, a reload or
 * Back shows what the reader saw.
 *
 *   #/home  #/demo  #/repos  #/repos/:id  #/discover  #/team  #/learning
 *   #/settings/:section?  #/about
 *   #/runs/:runId/:tab?file=<path>   (tab: overview, changes, activity, draft)
 *
 * Any route may carry query flags after `?`, for example
 * `#/runs/demo-run/activity?demo=play&speed=4&locale=en`; `src/app/presentation.ts`
 * reads them. `navigate()` keeps the current flags unless the new route
 * names its own, so presentation mode survives clicks inside the app.
 *
 * A hash that is not a route (empty, or an unknown path) parses to null.
 * An in-page anchor such as `#overview-directions` is not an address change:
 * `useHashRoute()` keeps the route it had.
 */
import { useSyncExternalStore } from "react";
import { product } from "../../shared/product";
import type { Messages } from "../i18n";

export const runTabs = ["overview", "changes", "activity", "draft"] as const;
export type RunTab = (typeof runTabs)[number];

/**
 * Query parameters of a route other than `file`, in address order and
 * decoded, such as the presentation flags `demo`, `present` and `locale`.
 */
export type RouteFlags = Record<string, string>;

export type Route = (
  | { name: "home" }
  /** The sample project's workspace. */
  | { name: "demo" }
  | { name: "run"; runId: string; tab?: RunTab; file?: string }
  | { name: "repos" }
  /** One repository's overview. */
  | { name: "repo"; repoId: string }
  | { name: "discover" }
  | { name: "team" }
  | { name: "learning" }
  | { name: "settings"; section?: string }
  | { name: "about" }
) & {
  /** Absent when the address has none. */
  flags?: RouteFlags;
};

export type RouteName = Route["name"];

/** Pages without parameters, by their first path segment. */
const plainRoutes = {
  home: "home",
  demo: "demo",
  repos: "repos",
  discover: "discover",
  team: "team",
  learning: "learning",
  settings: "settings",
  about: "about",
} as const satisfies Record<string, RouteName>;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // A malformed escape is kept as typed rather than dropping the route.
    return text;
  }
}

/** A query value; `/` stays readable, as in `?file=src/client.ts`. */
function encodeValue(text: string): string {
  return encodeURIComponent(text).replace(/%2F/gi, "/");
}

/** `a=1&b=x%20y` as `{a: "1", b: "x y"}`; a repeated name keeps its last value. */
export function parseQuery(query: string): Record<string, string> {
  const entries = new Map<string, string>();
  for (const part of query.split("&")) {
    if (!part) continue;
    const at = part.indexOf("=");
    const key = decode(at < 0 ? part : part.slice(0, at));
    if (key) entries.set(key, at < 0 ? "" : decode(part.slice(at + 1)));
  }
  // fromEntries defines own properties, so "__proto__" is only a name.
  return Object.fromEntries(entries);
}

/** The query flags after `?` in a hash, whether or not its path is a route. */
export function hashQuery(hash: string): Record<string, string> {
  const at = hash.indexOf("?");
  return at < 0 ? {} : parseQuery(hash.slice(at + 1));
}

/** The route a hash such as `#/runs/abc/changes?file=src/a.ts` names, or null. */
export function parseRoute(hash: string): Route | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!text.startsWith("/")) return null;
  const at = text.indexOf("?");
  const segments = (at < 0 ? text : text.slice(0, at))
    .split("/")
    .filter(Boolean)
    .map(decode);
  const { file, ...rest } = at < 0 ? {} : parseQuery(text.slice(at + 1));
  const flags = Object.keys(rest).length ? { flags: rest } : {};
  const [first, second, third] = segments;
  if (first === "runs") {
    if (!second) return null;
    // An unknown tab still opens the run, on its first tab.
    const tab = runTabs.find((candidate) => candidate === third);
    return {
      name: "run",
      runId: second,
      ...(tab ? { tab } : {}),
      ...(file ? { file } : {}),
      ...flags,
    };
  }
  if (first === "repos" && second)
    return { name: "repo", repoId: second, ...flags };
  if (first === "settings" && second)
    return { name: "settings", section: second, ...flags };
  if (first && Object.hasOwn(plainRoutes, first))
    return { name: plainRoutes[first as keyof typeof plainRoutes], ...flags };
  return null;
}

/** The hash for a route, starting with `#/`; parseRoute() reads it back. */
export function serializeRoute(route: Route): string {
  let path: string;
  const query: [string, string][] = [];
  switch (route.name) {
    case "run":
      path = `/runs/${encodeURIComponent(route.runId)}${route.tab ? `/${route.tab}` : ""}`;
      if (route.file) query.push(["file", route.file]);
      break;
    case "repo":
      path = `/repos/${encodeURIComponent(route.repoId)}`;
      break;
    case "settings":
      path = `/settings${route.section ? `/${encodeURIComponent(route.section)}` : ""}`;
      break;
    default:
      path = `/${route.name}`;
  }
  for (const [key, value] of Object.entries(route.flags ?? {}))
    if (key !== "file") query.push([key, value]);
  const search = query
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeValue(value)}`)
    .join("&");
  return `#${path}${search ? `?${search}` : ""}`;
}

/** What a title names besides the page, such as the open run's repository. */
export interface TitleContext {
  /** The repository's full name, for example `openfetch-sample/open-fetch`. */
  repoName?: string;
}

/**
 * The document title for a route, for example
 * "Code changes · openfetch-sample/open-fetch — BELL PR". A route without a
 * page of its own (null, home, about) gets the app's title.
 */
export function titleFor(
  route: Route | null,
  t: Pick<Messages, "app" | "workspace">,
  context: TitleContext = {},
): string {
  const pages = t.app.pages;
  let page: string;
  let subject: string | undefined;
  switch (route?.name) {
    case "run":
    case "demo":
      page = t.workspace.tabs[(route.name === "run" && route.tab) || "overview"];
      subject = context.repoName;
      break;
    case "repo":
      page = pages.explore;
      subject = context.repoName;
      break;
    case "repos":
      page = pages.repos;
      break;
    case "discover":
      page = pages.discovery;
      break;
    case "team":
      page = pages.team;
      break;
    case "learning":
      page = pages.learning;
      break;
    case "settings":
      page = pages.settings;
      break;
    default:
      return t.app.title;
  }
  return `${subject ? `${page} · ${subject}` : page} — ${product.name}`;
}

// The address store. It reads `window.location` on demand and caches the
// parsed route per hash, so React gets the same object until the address
// changes.

const listeners = new Set<() => void>();
let seenHash: string | undefined;
let routeHash = "";
let route: Route | null = null;
/** True after a push in this task; later navigations in it replace. */
let pushedThisTask = false;

function browserWindow(): Window | undefined {
  return typeof window === "undefined" ? undefined : window;
}

/** A link to an element on the page, such as `#main-content`. */
function isAnchor(hash: string) {
  const text = hash.replace(/^#/, "");
  return text !== "" && !text.startsWith("/") && !text.startsWith("?");
}

/** Reads the address; returns whether the route hash changed. */
function sync(): boolean {
  const hash = browserWindow()?.location.hash ?? "";
  if (hash === seenHash) return false;
  seenHash = hash;
  if (isAnchor(hash) || hash === routeHash) return false;
  routeHash = hash;
  route = parseRoute(hash);
  return true;
}

function notify() {
  if (!sync()) return;
  for (const listener of [...listeners]) listener();
}

/**
 * Calls `listener` after every route change: Back and Forward, a typed or
 * followed link, and `navigate()`. Returns the unsubscribe function.
 */
export function subscribeToRoute(listener: () => void): () => void {
  const win = browserWindow();
  if (!listeners.size && win) {
    win.addEventListener("hashchange", notify);
    win.addEventListener("popstate", notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && win) {
      win.removeEventListener("hashchange", notify);
      win.removeEventListener("popstate", notify);
    }
  };
}

/** The route in the address now, or null when it names none. */
export function currentRoute(): Route | null {
  sync();
  return route;
}

/**
 * The hash the current route was read from, flags included. An in-page
 * anchor leaves it unchanged.
 */
export function currentRouteHash(): string {
  sync();
  return routeHash;
}

/** The route in the address; the component renders again when it changes. */
export function useHashRoute(): Route | null {
  return useSyncExternalStore(subscribeToRoute, currentRoute, () => null);
}

/**
 * Shows `next` in the address and tells every useHashRoute() user. It adds
 * a history entry unless `replace` is set; several navigations in one task
 * (one click handler, one server answer) make a single entry, so Back
 * returns to where the reader was before it. A route without `flags` keeps
 * the current flags; pass `flags: {}` to drop them. Navigating to the
 * address that is already shown does nothing.
 */
export function navigate(next: Route, options: { replace?: boolean } = {}) {
  const win = browserWindow();
  if (!win) return;
  sync();
  const { file: _file, ...kept } = hashQuery(routeHash);
  const flags = next.flags ?? kept;
  const hash = serializeRoute({
    ...next,
    flags: Object.keys(flags).length ? flags : undefined,
  });
  if (hash === win.location.hash) return;
  if (options.replace || pushedThisTask)
    win.history.replaceState(win.history.state, "", hash);
  else {
    win.history.pushState(null, "", hash);
    pushedThisTask = true;
    win.setTimeout(() => {
      pushedThisTask = false;
    }, 0);
  }
  notify();
}
