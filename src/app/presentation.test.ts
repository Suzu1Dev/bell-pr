import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setLocale } from "../i18n";
import {
  applyCaptureAttribute,
  isPresenting,
  maskPath,
  maskUser,
  parsePresentationFlags,
  usePresentation,
} from "./presentation";

const off = {
  play: false,
  present: false,
  speed: 1,
  cursor: false,
  capture: false,
};

test("presentation flags are read from the query of any route", () => {
  assert.deepEqual(parsePresentationFlags(""), off);
  assert.deepEqual(parsePresentationFlags("#/runs/demo-run/overview"), off);
  assert.deepEqual(
    parsePresentationFlags(
      "#/runs/demo-run/activity?demo=play&speed=4&present=1&locale=en&cursor=1&capture=1",
    ),
    { play: true, present: true, locale: "en", speed: 4, cursor: true, capture: true },
  );
  assert.deepEqual(parsePresentationFlags("#/home?locale=zh-TW"), {
    ...off,
    locale: "zh-TW",
  });
  // Without a path, and after an anchor-like hash, the query still counts.
  assert.equal(parsePresentationFlags("#?present=1").present, true);
  assert.equal(parsePresentationFlags("#/repos?demo=PLAY").play, true);
});

test("flag values outside their range fall back or are clamped", () => {
  const speed = (value: string) =>
    parsePresentationFlags(`#/home?speed=${value}`).speed;
  assert.equal(speed("2"), 2);
  assert.equal(speed("2.5"), 2.5);
  assert.equal(speed("9"), 4);
  assert.equal(speed("0"), 1);
  assert.equal(speed("-3"), 1);
  assert.equal(speed("fast"), 1);
  assert.equal(speed(""), 1);
  assert.equal(speed("Infinity"), 1);
  const flags = (query: string) => parsePresentationFlags(`#/home?${query}`);
  assert.equal(flags("present").present, true);
  assert.equal(flags("present=true").present, true);
  assert.equal(flags("present=0").present, false);
  assert.equal(flags("present=no").present, false);
  assert.equal(flags("demo=1").play, false);
  // Locales go through parseLocale: tags it does not support are ignored.
  assert.equal(flags("locale=EN-us").locale, "en");
  assert.equal(flags("locale=zh-Hant").locale, "zh-TW");
  assert.equal("locale" in flags("locale=ja"), false);
  assert.equal("locale" in flags("locale=zh-CN"), false);
});

test("maskUser shows 'you' while presenting and the login otherwise", () => {
  assert.equal(maskUser("real-user", true), "you");
  assert.equal(maskUser("someone@example.com", true), "you");
  assert.equal(maskUser("real-user", false), "real-user");
  // Nothing to mask: the caller's fallback (a person icon) still shows.
  assert.equal(maskUser("", true), "");
});

test("maskPath keeps no home folder or user name on screen while presenting", () => {
  const cases: [string, string | undefined, string][] = [
    ["/home/x/projects/open-fetch", undefined, "…/open-fetch"],
    ["/home/x/.bellpr", undefined, "…/.bellpr"],
    ["/Users/x/Library/Application Support/bell-pr/", undefined, "…/bell-pr"],
    ["/tmp/bellpr-e2e-abc/data", undefined, "…/data"],
    ["~/projects/open-fetch", undefined, "…/open-fetch"],
    ["~", undefined, "…"],
    ["/", undefined, "…"],
    ["C:\\Users\\x\\repo", undefined, "…/repo"],
    ["\\\\server\\share\\repo", undefined, "…/repo"],
    // Inside the worktree: the path relative to it.
    ["/home/x/.bellpr/worktrees/r1/src/client.ts", "/home/x/.bellpr/worktrees/r1", "src/client.ts"],
    ["/Users/x/w/r1/README.md", "/Users/x/w/r1/", "README.md"],
    ["C:\\Users\\x\\w\\r1\\src\\a.ts", "C:\\Users\\x\\w\\r1", "src\\a.ts"],
    // The worktree itself, and a sibling that only shares a prefix.
    ["/home/x/.bellpr/worktrees/r1", "/home/x/.bellpr/worktrees/r1", "…/r1"],
    ["/home/x/.bellpr/worktrees/r10/a.ts", "/home/x/.bellpr/worktrees/r1", "…/a.ts"],
    // Relative paths show no location.
    ["src/client.ts", undefined, "src/client.ts"],
    ["", undefined, ""],
  ];
  for (const [path, root, masked] of cases)
    assert.equal(maskPath(path, root, true), masked, path);
  for (const [path, root] of cases)
    assert.equal(maskPath(path, root, false), path, path);
  for (const [path, root] of cases) {
    const shown = maskPath(path, root, true);
    assert.doesNotMatch(shown, /\/home\/|\/Users\/|\/tmp\/|\bx\b|Users/, path);
  }
});

test("the address decides presentation mode when no flag is passed", () => {
  const globals = globalThis as { window?: unknown };
  const location = { hash: "#/home?present=1" };
  globals.window = { location };
  try {
    assert.equal(isPresenting(), true);
    assert.equal(maskUser("real-user"), "you");
    assert.equal(maskPath("/home/x/.bellpr"), "…/.bellpr");
    location.hash = "#/home";
    assert.equal(isPresenting(), false);
    assert.equal(maskUser("real-user"), "real-user");
    assert.equal(maskPath("/home/x/.bellpr"), "/home/x/.bellpr");
  } finally {
    delete globals.window;
  }
  assert.equal(isPresenting(), false);
});

test("capture=1 sets data-capture on the root element and removes it after", () => {
  const attributes = new Set<string>();
  const root = {
    toggleAttribute(name: string, force?: boolean) {
      if (force) attributes.add(name);
      else attributes.delete(name);
      return Boolean(force);
    },
  };
  applyCaptureAttribute(parsePresentationFlags("#/home?capture=1"), root);
  assert.deepEqual([...attributes], ["data-capture"]);
  applyCaptureAttribute(parsePresentationFlags("#/home"), root);
  assert.deepEqual([...attributes], []);
  // Without a document there is nothing to change.
  applyCaptureAttribute({ capture: true });
});

test("usePresentation renders with presentation off on the server", () => {
  function Probe() {
    const presentation = usePresentation();
    return createElement(
      "output",
      null,
      `${presentation.present ? "on" : "off"}:${presentation.maskUser("real-user")}`,
    );
  }
  assert.equal(
    renderToStaticMarkup(createElement(Probe)),
    "<output>off:real-user</output>",
  );
});

test("the masked login reads 'you' in the UI language", async (t) => {
  t.after(() => setLocale("en"));
  await setLocale("zh-TW");
  assert.equal(maskUser("real-user", true), "你");
  assert.equal(maskUser("real-user", false), "real-user");
  await setLocale("en");
  assert.equal(maskUser("real-user", true), "you");
});
