import assert from "node:assert/strict";
import test from "node:test";
import { parseViewSearch, viewSearch, type SavedView } from "./view-url";

test("a contribution, its tab, a project or a page survive the round trip through the address bar", () => {
  const views: [SavedView, string][] = [
    [{ page: "workspace", runId: "8faf9ce8-9f3e", tab: "draft" }, "?run=8faf9ce8-9f3e&tab=draft"],
    [{ page: "workspace", runId: "8faf9ce8-9f3e", tab: "overview" }, "?run=8faf9ce8-9f3e"],
    [{ page: "explore", repoId: "repo-1" }, "?project=repo-1"],
    [{ page: "discovery" }, "?page=discovery"],
    [{ page: "settings" }, "?page=settings"],
  ];
  for (const [view, search] of views) {
    assert.equal(viewSearch(view), search);
    const parsed = parseViewSearch(search)!;
    assert.equal(viewSearch(parsed), search);
  }
  // The demo workspace is the start page and needs no query.
  assert.equal(viewSearch({ page: "workspace" }), "");
});

test("unknown pages, tabs and malformed ids are ignored", () => {
  assert.equal(parseViewSearch(""), undefined);
  assert.equal(parseViewSearch("?page=admin"), undefined);
  assert.equal(parseViewSearch("?page=workspace"), undefined);
  assert.equal(parseViewSearch("?run=../etc"), undefined);
  assert.equal(parseViewSearch("?project=a%20b"), undefined);
  assert.deepEqual(parseViewSearch("?run=abc&tab=secret"), { page: "workspace", runId: "abc", tab: undefined });
});
