/**
 * Writes the brand files from brand-assets.ts and shared/product.ts, so a
 * logo or name change is one edit plus one run:
 *
 * - public/favicon.svg, public/brand/*.svg and public/manifest.webmanifest;
 * - the PNG renditions, screenshots of the SVGs taken with the installed
 *   Playwright Chromium (`pngFiles`): the 32 px favicon, a 512 px mark, the
 *   180 px Apple touch icon and the 1200 x 630 social preview image;
 * - the copies the landing site serves from site/assets/brand/, and the
 *   self-hosted fonts with their licenses in site/assets/fonts/.
 *
 *   npx tsx src/brand/render-assets.ts         everything
 *   npx tsx src/brand/render-assets.ts --svg   everything except the PNGs
 *
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE, when set, points Playwright at an
 * installed Chromium build. `Logo.test.ts` checks the committed files
 * against brand-assets.ts.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { product } from "../../shared/product";
import {
  logoColors,
  logoFiles,
  logoSvg,
  manifest,
  markPath,
  markSize,
  pngFiles,
  siteBrandFiles,
  wordmark,
} from "./brand-assets";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const at = (...parts: string[]) => path.join(root, ...parts);
const fontDir = at("site", "assets", "fonts");

function write(file: string, content: string | Buffer) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`wrote ${path.relative(root, file)}`);
}

/** Copies the woff2 files the site uses, and each family's OFL license. */
function copyFonts() {
  const require = createRequire(import.meta.url);
  const families = [
    {
      dir: path.dirname(require.resolve("@fontsource-variable/dm-sans/LICENSE")),
      files: ["dm-sans-latin-wght-normal.woff2", "dm-sans-latin-ext-wght-normal.woff2"],
      license: "LICENSE-DM-Sans.txt",
    },
    {
      dir: path.dirname(require.resolve("@fontsource/ibm-plex-mono/LICENSE")),
      files: ["ibm-plex-mono-latin-400-normal.woff2", "ibm-plex-mono-latin-500-normal.woff2"],
      license: "LICENSE-IBM-Plex-Mono.txt",
    },
  ];
  mkdirSync(fontDir, { recursive: true });
  for (const { dir, files, license } of families) {
    for (const file of files) copyFileSync(path.join(dir, "files", file), path.join(fontDir, file));
    copyFileSync(path.join(dir, "LICENSE"), path.join(fontDir, license));
  }
  console.log(`copied the fonts to ${path.relative(root, fontDir)}`);
}

function fontFace(family: string, file: string, weight: string) {
  const data = readFileSync(path.join(fontDir, file)).toString("base64");
  return `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2")}`;
}

function page(background: string, body: string, css = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:${background}}
svg{display:block}
${css}
</style></head><body>${body}</body></html>`;
}

const markSvg = (fill: string, size: number, attrs = "") =>
  `<svg ${attrs} width="${size}" height="${size}" viewBox="0 0 ${markSize} ${markSize}"><path fill="${fill}" d="${markPath}"/></svg>`;

/** The social preview: the wordmark, one descriptive line and the start command. */
function ogImage() {
  const height = 120;
  const width = Math.round((height * wordmark.width) / wordmark.height);
  const body = `
<div class="card">
  <svg width="${width}" height="${height}" viewBox="0 0 ${wordmark.width} ${wordmark.height}">
    <path fill="${logoColors.green}" d="${wordmark.markPath}"/>
    <path fill="${logoColors.ink}" d="${wordmark.namePath}"/>
    <path fill="${logoColors.green}" d="${wordmark.suffixPath}"/>
  </svg>
  <p class="lead">A local-first AI workbench for open-source contributions.</p>
  <p class="command"><span>$</span> npx ${product.npmPackage}</p>
</div>
${markSvg("#e0eee4", 620, 'class="watermark"')}`;
  const css = `
${fontFace("DM Sans", "dm-sans-latin-wght-normal.woff2", "100 1000")}
${fontFace("IBM Plex Mono", "ibm-plex-mono-latin-500-normal.woff2", "500")}
.card{position:absolute;left:88px;top:118px;width:640px}
.lead{margin:44px 0 0;font:500 46px/1.2 "DM Sans";letter-spacing:-0.01em;color:${logoColors.ink}}
.command{display:inline-block;margin:44px 0 0;padding:14px 26px;border-radius:14px;background:${logoColors.ink};color:#ffffff;font:500 30px/1 "IBM Plex Mono"}
.command span{color:${logoColors.greenOnDark}}
.watermark{position:absolute;right:-96px;top:16px}
body::after{content:"";position:absolute;left:0;right:0;bottom:0;height:14px;background:${logoColors.green}}`;
  return page("#fafbf9", body, css);
}

/** The page for each PNG; transparent ones keep their alpha channel. */
function pngPage(file: keyof typeof pngFiles): { html: string; transparent: boolean } {
  switch (file) {
    case "brand/favicon-32.png":
      return { html: page("transparent", markSvg(logoColors.green, 32)), transparent: true };
    case "brand/logo-mark-512.png":
      return { html: page("transparent", markSvg(logoColors.green, 512)), transparent: true };
    case "apple-touch-icon.png":
      // iOS shows transparent pixels as black and rounds the corners
      // itself, so the touch icon is the white mark on an opaque tile.
      return {
        html: page(logoColors.green, markSvg("#ffffff", 128), "svg{margin:26px}"),
        transparent: false,
      };
    case "og-image.png":
      return { html: ogImage(), transparent: false };
  }
}

async function renderPngs() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  try {
    for (const [file, [width, height]] of Object.entries(pngFiles)) {
      const { html, transparent } = pngPage(file as keyof typeof pngFiles);
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const tab = await context.newPage();
      await tab.setContent(html);
      await tab.evaluate(() => document.fonts.ready);
      write(at("public", file), await tab.screenshot({ omitBackground: transparent }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function main(args: string[]) {
  if (args.some((arg) => arg !== "--svg")) {
    console.error("Usage: npx tsx src/brand/render-assets.ts [--svg]");
    return 2;
  }
  for (const file of logoFiles) write(at("public", file), logoSvg(file));
  write(at("public", "manifest.webmanifest"), manifest());
  copyFonts();
  if (!args.includes("--svg")) await renderPngs();
  for (const [name, source] of Object.entries(siteBrandFiles))
    write(at("site", "assets", "brand", name), readFileSync(at("public", source)));
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
