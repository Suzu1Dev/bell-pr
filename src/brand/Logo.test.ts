import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { product } from "../../shared/product";
import { assertNoHan, renderEn } from "../test-utils/render";
import {
  logoColors,
  logoFiles,
  logoSvg,
  manifest,
  markPath,
  pngFiles,
  siteBrandFiles,
  wordmark,
} from "./brand-assets";
import { Logo, type LogoProps } from "./Logo";

const render = (props: LogoProps) => renderEn(createElement(Logo, props));
const repoFile = (path: string) => new URL(`../../${path}`, import.meta.url);

test("the mark is an image named after the product at the given size", () => {
  const html = render({ variant: "mark", size: 32 });
  assert.match(html, /^<svg width="32" height="32" viewBox="0 0 64 64" role="img" aria-label="BELL PR">/);
  assert.equal(product.name, "BELL PR");
  assert.ok(html.includes(`<path fill="${logoColors.green}" d="${markPath}"></path>`));
  assertNoHan(html);
});

test("the wordmark keeps its proportions and draws the mark and the name", () => {
  const html = render({ variant: "wordmark", size: 40 });
  assert.match(html, /^<svg width="122.5" height="40" viewBox="0 0 196 64" role="img" aria-label="BELL PR">/);
  for (const d of [wordmark.markPath, wordmark.namePath, wordmark.suffixPath])
    assert.ok(html.includes(`d="${d}"`));
  // Widths are rounded to 2 decimals.
  assert.match(render({ variant: "wordmark", size: 33 }), /width="101.06" height="33"/);
  assertNoHan(html);
});

test("a title replaces the accessible name, and an empty title hides the logo", () => {
  const titled = render({ variant: "mark", size: 24, title: "Home" });
  assert.match(titled, /role="img" aria-label="Home"/);

  const hidden = render({ variant: "wordmark", size: 24, title: "", className: "brand-logo" });
  assert.match(hidden, /^<svg class="brand-logo" width="73.5" height="24" viewBox="0 0 196 64" aria-hidden="true">/);
  assert.doesNotMatch(hidden, /role=|aria-label=/);
});

test("the committed vector files match brand-assets.ts", () => {
  for (const file of logoFiles)
    assert.equal(
      readFileSync(repoFile(`public/${file}`), "utf8"),
      logoSvg(file),
      `public/${file} is stale; run npx tsx src/brand/render-assets.ts`,
    );
});

test("the manifest takes its name from shared/product.ts and lists existing icons", () => {
  const text = readFileSync(repoFile("public/manifest.webmanifest"), "utf8");
  assert.equal(text, manifest(), "run npx tsx src/brand/render-assets.ts");
  const parsed = JSON.parse(text) as { name: string; icons: { src: string }[] };
  assert.equal(parsed.name, product.name);
  for (const icon of parsed.icons)
    assert.ok(existsSync(repoFile(`public/${icon.src}`)), icon.src);
});

test("the PNG renditions have their documented sizes", () => {
  for (const [file, [width, height]] of Object.entries(pngFiles)) {
    const png = readFileSync(repoFile(`public/${file}`));
    // The IHDR chunk follows the 8-byte signature and stores the width and
    // height as big-endian 32-bit integers at offsets 16 and 20.
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG", file);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height], file);
  }
});

test("the landing site serves the same brand files", () => {
  for (const [name, source] of Object.entries(siteBrandFiles))
    assert.ok(
      readFileSync(repoFile(`site/assets/brand/${name}`)).equals(readFileSync(repoFile(`public/${source}`))),
      `site/assets/brand/${name} differs from public/${source}`,
    );
});

test("the logo colors are design tokens", () => {
  const tokens = readFileSync(repoFile("src/theme/tokens.css"), "utf8");
  const expected = {
    green: "--color-brand-600",
    ink: "--color-text",
    greenOnDark: "--color-brand-300",
    inkOnDark: "--color-text-inverse",
    accentOnDark: "--color-brand-200",
  } satisfies Record<keyof typeof logoColors, string>;
  for (const [name, token] of Object.entries(expected))
    assert.ok(
      tokens.includes(`${token}: ${logoColors[name as keyof typeof logoColors]};`),
      `${name} should equal ${token}`,
    );
});
