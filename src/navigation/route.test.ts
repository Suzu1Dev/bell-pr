import assert from "node:assert/strict";
import test from "node:test";
import en from "../i18n/en";
import { chooseLocale } from "../i18n/LanguageSwitcher";
import zhTW from "../i18n/zh-TW";
import {
  currentRoute,
  currentRouteHash,
  hashQuery,
  navigate,
  parseQuery,
  parseRoute,
  serializeRoute,
  subscribeToRoute,
  titleFor,
  type Route,
} from "./route";

// [hash, route]: each hash parses to the route, and the route serializes back
// to the same hash.
const canonical: [string, Route][] = [
  ["#/home", { name: "home" }],
  ["#/demo", { name: "demo" }],
  ["#/repos", { name: "repos" }],
  ["#/repos/demo-repo", { name: "repo", repoId: "demo-repo" }],
  ["#/discover", { name: "discover" }],
  ["#/team", { name: "team" }],
  ["#/learning", { name: "learning" }],
  ["#/settings", { name: "settings" }],
  ["#/settings/environment", { name: "settings", section: "environment" }],
  ["#/about", { name: "about" }],
  ["#/runs/demo-run", { name: "run", runId: "demo-run" }],
  ["#/runs/demo-run/overview", { name: "run", runId: "demo-run", tab: "overview" }],
  ["#/runs/demo-run/changes", { name: "run", runId: "demo-run", tab: "changes" }],
  ["#/runs/demo-run/activity", { name: "run", runId: "demo-run", tab: "activity" }],
  ["#/runs/demo-run/draft", { name: "run", runId: "demo-run", tab: "draft" }],
  [
    "#/runs/demo-run/changes?file=src/utils/retry.ts",
    { name: "run", runId: "demo-run", tab: "changes", file: "src/utils/retry.ts" },
  ],
  [
    "#/runs/demo-run/activity?demo=play&speed=4&present=1&locale=en",
    {
      name: "run",
      runId: "demo-run",
      tab: "activity",
      flags: { demo: "play", speed: "4", present: "1", locale: "en" },
    },
  ],
  [
    "#/runs/demo-run/changes?file=README.md&locale=zh-TW&capture=1&cursor=1",
    {
      name: "run",
      runId: "demo-run",
      tab: "changes",
      file: "README.md",
      flags: { locale: "zh-TW", capture: "1", cursor: "1" },
    },
  ],
  ["#/repos?demo=play&cursor=1", { name: "repos", flags: { demo: "play", cursor: "1" } }],
  ["#/home?locale=en", { name: "home", flags: { locale: "en" } }],
  // Characters that need escaping survive the round trip.
  [
    "#/runs/run%20one/changes?file=docs/a%20b%26c%3Fd%23e%2Bf.md",
    { name: "run", runId: "run one", tab: "changes", file: "docs/a b&c?d#e+f.md" },
  ],
  ["#/repos/a%2Fb", { name: "repo", repoId: "a/b" }],
  ["#/settings/a%20b", { name: "settings", section: "a b" }],
];

test("every route parses from and serializes to its canonical hash", () => {
  for (const [hash, route] of canonical) {
    assert.deepEqual(parseRoute(hash), route, hash);
    assert.equal(serializeRoute(route), hash, hash);
  }
});

test("hashes that name no route parse to null", () => {
  for (const hash of [
    "",
    "#",
    "#/",
    "#main-content",
    "#overview-directions",
    "#?locale=en",
    "#/nowhere",
    "#/runs",
    "#/runs/",
    "#/__proto__",
    "#/toString",
    "#/constructor",
  ])
    assert.equal(parseRoute(hash), null, hash);
});

test("parsing is lenient about the forms people type", () => {
  const cases: [string, Route][] = [
    // Without the leading #, as location.hash.slice(1) gives it.
    ["/runs/demo-run/changes", { name: "run", runId: "demo-run", tab: "changes" }],
    // Trailing and doubled slashes.
    ["#/repos/", { name: "repos" }],
    ["#//runs//demo-run//draft/", { name: "run", runId: "demo-run", tab: "draft" }],
    // An unknown tab opens the run on its first tab; extra segments are ignored.
    ["#/runs/abc/bogus", { name: "run", runId: "abc" }],
    ["#/runs/abc/changes/extra", { name: "run", runId: "abc", tab: "changes" }],
    // `+` is a plus, not a space, and a malformed escape is kept as typed.
    ["#/runs/abc/changes?file=a+b.ts", { name: "run", runId: "abc", tab: "changes", file: "a+b.ts" }],
    ["#/runs/abc/changes?file=100%", { name: "run", runId: "abc", tab: "changes", file: "100%" }],
    ["#/runs/a%E0%A4%A", { name: "run", runId: "a%E0%A4%A" }],
    // An empty file is no file; a repeated flag keeps its last value.
    ["#/runs/abc?file=", { name: "run", runId: "abc" }],
    ["#/home?speed=2&speed=3&&present", { name: "home", flags: { speed: "3", present: "" } }],
    // `file` belongs to runs only.
    ["#/repos?file=a.ts&locale=en", { name: "repos", flags: { locale: "en" } }],
  ];
  for (const [hash, route] of cases) assert.deepEqual(parseRoute(hash), route, hash);
});

test("query names are only names, never object internals", () => {
  const query = parseQuery("__proto__=x&constructor=y");
  assert.equal(Object.getPrototypeOf(query), Object.prototype);
  assert.deepEqual(Object.keys(query), ["__proto__", "constructor"]);
  assert.equal(query.__proto__, "x");
  assert.deepEqual(hashQuery("#overview?demo=play"), { demo: "play" });
  assert.deepEqual(hashQuery("#/home"), {});
});

test("serializing writes file before the flags and never a flag named file", () => {
  assert.equal(
    serializeRoute({
      name: "run",
      runId: "r1",
      tab: "changes",
      file: "src/a.ts",
      flags: { file: "ignored", locale: "en" },
    }),
    "#/runs/r1/changes?file=src/a.ts&locale=en",
  );
  assert.equal(serializeRoute({ name: "home", flags: {} }), "#/home");
});

const tabTitles = [
  ["overview", "Overview & motivation"],
  ["changes", "Code changes"],
  ["activity", "Agent activity"],
  ["draft", "PR draft"],
] as const;

test("titles name the page, then what it shows, then the product", () => {
  const repoName = "openfetch-sample/open-fetch";
  for (const [tab, label] of tabTitles)
    assert.equal(
      titleFor({ name: "run", runId: "demo-run", tab }, en, { repoName }),
      `${label} · ${repoName} — BELL PR`,
    );
  assert.equal(
    titleFor({ name: "run", runId: "x" }, en),
    "Overview & motivation — BELL PR",
  );
  assert.equal(
    titleFor({ name: "demo" }, en, { repoName }),
    `Overview & motivation · ${repoName} — BELL PR`,
  );
  assert.equal(
    titleFor({ name: "repo", repoId: "demo-repo" }, en, { repoName }),
    `Project overview · ${repoName} — BELL PR`,
  );
  const pages: [Route, string][] = [
    [{ name: "repos" }, "Repositories"],
    [{ name: "discover" }, "Explore contributions"],
    [{ name: "team" }, "Agent team"],
    [{ name: "learning" }, "Learning notes"],
    [{ name: "settings", section: "general" }, "Settings"],
  ];
  for (const [route, page] of pages)
    assert.equal(titleFor(route, en), `${page} — BELL PR`, route.name);
  for (const route of [null, { name: "home" }] as const)
    assert.equal(titleFor(route, en), en.app.title);
  assert.equal(titleFor({ name: "about" }, en), "About BELL PR");
  // zh-TW takes the same shape from its own dictionary.
  assert.equal(
    titleFor({ name: "run", runId: "demo-run", tab: "changes" }, zhTW, { repoName }),
    `${zhTW.workspace.tabs.changes} · ${repoName} — BELL PR`,
  );
});

/**
 * A browser window's address, history and events, enough for the route
 * store: `back()` moves through the entries and fires popstate and
 * hashchange the way a browser does.
 */
function fakeWindow(initialHash = "") {
  const entries = [initialHash];
  let index = 0;
  const handlers = new Map<string, Set<() => void>>();
  const fire = (type: string) => {
    for (const handler of handlers.get(type) ?? []) handler();
  };
  const hashOf = (url: string) => (url.startsWith("#") ? url : "");
  const win = {
    location: {
      get hash() {
        return entries[index];
      },
    },
    history: {
      state: null,
      get length() {
        return entries.length;
      },
      pushState(_state: unknown, _title: string, url: string) {
        entries.splice(index + 1);
        entries.push(hashOf(url));
        index++;
      },
      replaceState(_state: unknown, _title: string, url: string) {
        entries[index] = hashOf(url);
      },
    },
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    addEventListener(type: string, handler: () => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    },
    removeEventListener(type: string, handler: () => void) {
      handlers.get(type)?.delete(handler);
    },
    /** Moves `steps` entries back (negative: forward) like the browser buttons. */
    go(steps: number) {
      index -= steps;
      fire("popstate");
      fire("hashchange");
    },
    /** A link to `hash` followed in the page. */
    follow(hash: string) {
      win.change(hash);
      fire("hashchange");
    },
    /**
     * The address changes to `hash`; its hashchange event is still queued,
     * as it is between a typed or followed link and the next task.
     */
    change(hash: string) {
      entries.splice(index + 1);
      entries.push(hash);
      index++;
    },
    fire,
    entries,
    listeners: () =>
      [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
  };
  return win;
}

/** Runs `body` with `win` as the global window, then restores the global. */
async function withWindow(
  win: ReturnType<typeof fakeWindow>,
  body: () => Promise<void> | void,
) {
  const globals = globalThis as { window?: unknown };
  const previous = globals.window;
  globals.window = win;
  try {
    await body();
  } finally {
    if (previous === undefined) delete globals.window;
    else globals.window = previous;
  }
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

test("navigate adds one history entry per task and keeps the flags", async () => {
  const win = fakeWindow("#/runs/demo-run/overview?present=1&locale=en");
  await withWindow(win, async () => {
    assert.deepEqual(currentRoute(), {
      name: "run",
      runId: "demo-run",
      tab: "overview",
      flags: { present: "1", locale: "en" },
    });
    let changes = 0;
    const unsubscribe = subscribeToRoute(() => changes++);

    // A click that sets the file and then the tab makes one entry.
    navigate({ name: "run", runId: "demo-run", tab: "overview", file: "src/client.ts" });
    navigate({ name: "run", runId: "demo-run", tab: "changes", file: "src/client.ts" });
    assert.deepEqual(win.entries, [
      "#/runs/demo-run/overview?present=1&locale=en",
      "#/runs/demo-run/changes?file=src/client.ts&present=1&locale=en",
    ]);
    assert.equal(changes, 2);

    // The same address again is not a change.
    navigate({ name: "run", runId: "demo-run", tab: "changes", file: "src/client.ts" });
    assert.equal(win.entries.length, 2);
    assert.equal(changes, 2);

    // The next click is a new entry; replace changes the entry in place.
    await nextTask();
    navigate({ name: "settings" });
    navigate({ name: "repos" }, { replace: true });
    assert.deepEqual(win.entries.slice(2), ["#/repos?present=1&locale=en"]);
    await nextTask();
    navigate({ name: "team", flags: {} });
    assert.equal(win.entries.at(-1), "#/team");
    assert.equal(changes, 5);

    // Back is a route change too.
    win.go(1);
    assert.deepEqual(currentRoute(), { name: "repos", flags: { present: "1", locale: "en" } });
    assert.equal(changes, 6);
    unsubscribe();
    assert.equal(win.listeners(), 0);
  });
});

test("navigate leaves a page's own flags behind and keeps the presentation flags", async () => {
  const win = fakeWindow("#/learning?view=practice&present=1&locale=en");
  await withWindow(win, async () => {
    const unsubscribe = subscribeToRoute(() => undefined);
    // The practice view belongs to the learning page.
    navigate({ name: "run", runId: "demo-run", tab: "changes" });
    assert.equal(win.entries.at(-1), "#/runs/demo-run/changes?present=1&locale=en");
    await nextTask();
    // The check panel belongs to the workspace's changes tab.
    win.follow("#/runs/demo-run/changes?panel=check&demo=play&locale=en");
    navigate({ name: "learning" });
    assert.equal(win.entries.at(-1), "#/learning?demo=play&locale=en");
    await nextTask();
    // A route that names its own flags keeps them.
    navigate({ name: "learning", flags: { view: "practice", locale: "en" } });
    assert.equal(win.entries.at(-1), "#/learning?view=practice&locale=en");
    unsubscribe();
  });
});

test("an in-page anchor keeps the route and its flags", async () => {
  const win = fakeWindow("#/runs/demo-run/overview?demo=play");
  await withWindow(win, () => {
    let changes = 0;
    const unsubscribe = subscribeToRoute(() => changes++);
    const before = currentRoute();
    win.follow("#overview-directions");
    assert.equal(currentRoute(), before);
    assert.equal(currentRouteHash(), "#/runs/demo-run/overview?demo=play");
    assert.equal(changes, 0);
    // Navigating from the anchor keeps the route's flags.
    navigate({ name: "run", runId: "demo-run", tab: "changes" });
    assert.equal(win.entries.at(-1), "#/runs/demo-run/changes?demo=play");
    // An empty hash is the start view: no route, no flags.
    win.follow("");
    assert.equal(currentRoute(), null);
    assert.equal(currentRouteHash(), "");
    unsubscribe();
  });
});

test("a read before the hashchange event still lets the event reach every listener", async () => {
  const win = fakeWindow("#/runs/demo-run/overview");
  await withWindow(win, () => {
    let changes = 0;
    const unsubscribe = subscribeToRoute(() => changes++);
    win.change("#/repos");
    // A render (or a click handler) reads the new address first.
    assert.deepEqual(currentRoute(), { name: "repos" });
    assert.equal(changes, 0);
    win.fire("hashchange");
    assert.equal(changes, 1);
    // The same route again, and an anchor, are no change.
    win.fire("hashchange");
    win.follow("#main-content");
    assert.equal(changes, 1);
    unsubscribe();
  });
});

test("without a window the store reads no route and navigate does nothing", () => {
  assert.equal(currentRoute(), null);
  navigate({ name: "home" });
  assert.equal(currentRoute(), null);
  const unsubscribe = subscribeToRoute(() => assert.fail("no change expected"));
  unsubscribe();
});

test("choosing a language drops the locale flag, so a reload keeps the choice", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  // The app-settings save is not what this test is about.
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  const win = fakeWindow("#/runs/demo-run/changes?file=src/a.ts&locale=en&present=1");
  await withWindow(win, () => {
    const chosen: string[] = [];
    chooseLocale("zh-TW", (locale) => chosen.push(locale));
    assert.deepEqual(chosen, ["zh-TW"]);
    // Replaced, not pushed: Back does not bring the flag back.
    assert.deepEqual(win.entries, ["#/runs/demo-run/changes?file=src/a.ts&present=1"]);
    // Without the flag the address is left as it is.
    chooseLocale("en", () => undefined);
    assert.deepEqual(win.entries, ["#/runs/demo-run/changes?file=src/a.ts&present=1"]);
  });
});
