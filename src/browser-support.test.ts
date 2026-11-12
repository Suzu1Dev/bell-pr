import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.join(import.meta.dirname, "..");
const names: Record<string, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
};

export function documentedBrowsers(text: string) {
  const plain = text.replace(/\r?\n/g, " ").replace(/<!--[\s\S]*?-->/g, "");
  const sentence = plain.match(/The app needs[\s\S]*?\.(?=\s|$)/);
  assert.ok(sentence, 'no floor sentence starting with "The app needs"');
  return [...sentence[0].matchAll(/\b(Chrome|Edge|Firefox|Safari) (\d+(?:\.\d+)?)\b/g)].map(
    ([, name, version]) => `${name} ${version}`,
  );
}

export function targetBrowsers(config: string) {
  const listed = config.match(/target:\s*\[([^\]]*)\]/);
  assert.ok(listed, "build.target array in vite.config.ts");
  const entries = [...listed[1].matchAll(/"([a-z]+)(\d+(?:\.\d+)?)"/g)];
  assert.ok(entries.length > 0, "build.target entries");
  return entries.map(([, id, version]) => {
    const name = names[id];
    assert.ok(name, `build.target has ${id}${version} but the docs have no name for it`);
    return `${name} ${version}`;
  });
}

const configPath = path.join(root, "vite.config.ts");
const docsPath = path.join(root, "docs/development.md");
const required = () => targetBrowsers(readFileSync(configPath, "utf8")).sort();

test("docs/development.md names each browser version in vite.config.ts build.target", () => {
  const found = documentedBrowsers(readFileSync(docsPath, "utf8")).sort();
  assert.deepEqual(found, required());
});

test("'Chrome 111 or Edge 112, Firefox 113 or Safari 16.2' does not match build.target", () => {
  const found = documentedBrowsers(
    "The app needs Chrome 111 or Edge 112, Firefox 113 or Safari 16.2.",
  ).sort();
  assert.notDeepEqual(found, required());
});

test("'Chrome or Edge 111, Firefox 113 or Safari 16.2' does not match build.target", () => {
  const found = documentedBrowsers(
    "The app needs Chrome or Edge 111, Firefox 113 or Safari 16.2.",
  ).sort();
  assert.notDeepEqual(found, required());
});

test("versions only in an HTML comment do not match build.target", () => {
  const found = documentedBrowsers(
    "The app needs a current browser. <!-- Chrome 111, Edge 111, Firefox 113 and Safari 16.2 -->",
  ).sort();
  assert.notDeepEqual(found, required());
});

test("an unknown build.target entry says the docs have no name for it", () => {
  assert.throws(
    () => targetBrowsers('target: ["opera100"]'),
    /build\.target has opera100 but the docs have no name for it/,
  );
});
