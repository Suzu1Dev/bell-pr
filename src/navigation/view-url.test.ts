import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, serializeRoute } from "./route";
import {
  adoptViewSearch,
  parseViewSearch,
  routeForView,
  type SavedView,
} from "./view-url";

test("a contribution, its tab, a project or a page survive the round trip through the address bar", () => {
  // Each query an upstream BELL address carried, the view it names, and the
  // hash route that shows it here.
  const views: [SavedView, string, string][] = [
    [{ page: "workspace", runId: "8faf9ce8-9f3e", tab: "draft" }, "?run=8faf9ce8-9f3e&tab=draft", "#/runs/8faf9ce8-9f3e/draft"],
    [{ page: "workspace", runId: "8faf9ce8-9f3e", tab: "overview" }, "?run=8faf9ce8-9f3e&tab=overview", "#/runs/8faf9ce8-9f3e"],
    [{ page: "workspace", runId: "8faf9ce8-9f3e", tab: undefined }, "?run=8faf9ce8-9f3e", "#/runs/8faf9ce8-9f3e"],
    [{ page: "explore", repoId: "repo-1" }, "?project=repo-1", "#/repos/repo-1"],
    [{ page: "discovery" }, "?page=discovery", "#/discover"],
    [{ page: "settings" }, "?page=settings", "#/settings"],
  ];
  for (const [view, search, hash] of views) {
    const parsed = parseViewSearch(search)!;
    assert.deepEqual(parsed, view);
    const route = routeForView(parsed);
    assert.equal(serializeRoute(route), hash);
    assert.deepEqual(parseRoute(hash), route);
  }
  // The demo workspace is the start page; it never had a query of its own.
  assert.deepEqual(routeForView({ page: "workspace" }), { name: "demo" });
});

test("unknown pages, tabs and malformed ids are ignored", () => {
  assert.equal(parseViewSearch(""), undefined);
  assert.equal(parseViewSearch("?page=admin"), undefined);
  assert.equal(parseViewSearch("?page=workspace"), undefined);
  assert.equal(parseViewSearch("?run=../etc"), undefined);
  assert.equal(parseViewSearch("?project=a%20b"), undefined);
  assert.deepEqual(parseViewSearch("?run=abc&tab=secret"), { page: "workspace", runId: "abc", tab: undefined });
});

/** A window whose address can be read and replaced, like the browser's. */
function browser(href: string) {
  let url = new URL(href);
  const replaced: string[] = [];
  return {
    replaced,
    get href() {
      return url.href;
    },
    window: {
      get location() {
        return url as unknown as Location;
      },
      history: {
        state: null,
        replaceState(_state: unknown, _title: string, next: string) {
          url = new URL(next, url);
          replaced.push(next);
        },
      } as unknown as History,
    },
  };
}

test("a reload of an upstream address opens the same place through the hash, in place", () => {
  const run = browser("http://127.0.0.1:4311/?run=8faf9ce8-9f3e&tab=changes");
  assert.deepEqual(adoptViewSearch(run.window), {
    name: "run",
    runId: "8faf9ce8-9f3e",
    tab: "changes",
  });
  assert.equal(run.href, "http://127.0.0.1:4311/#/runs/8faf9ce8-9f3e/changes");
  // Other parameters stay in the address.
  const project = browser("http://127.0.0.1:4311/app?project=repo-1&x=1");
  adoptViewSearch(project.window);
  assert.equal(project.href, "http://127.0.0.1:4311/app?x=1#/repos/repo-1");
  // A hash route wins, and an address that names no view is left alone.
  for (const href of [
    "http://127.0.0.1:4311/?page=discovery#/settings",
    "http://127.0.0.1:4311/#/runs/demo-run",
    "http://127.0.0.1:4311/?page=admin",
  ]) {
    const unchanged = browser(href);
    assert.equal(adoptViewSearch(unchanged.window), undefined);
    assert.deepEqual(unchanged.replaced, []);
    assert.equal(unchanged.href, href);
  }
});
