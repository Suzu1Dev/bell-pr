#!/usr/bin/env node
/**
 * Renders stills of the Promo composition from one bundle and one browser,
 * for quick looks while tuning a shot (`npm run render:poster` renders the
 * poster). Frames go to out/stills/<frame>.png (or the --out directory).
 *
 *   node scripts/stills.mjs 300 450 1200-1220:5 [--scale=2] [--out=out/stills]
 *
 * A range a-b:n renders every n-th frame from a to b.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const scale = Number(args.find((a) => a.startsWith("--scale="))?.slice(8) ?? 1);
const out = path.resolve(packageRoot, args.find((a) => a.startsWith("--out="))?.slice(6) ?? "out/stills");
const frames = args
  .filter((a) => !a.startsWith("--"))
  .flatMap((a) => {
    const range = /^(\d+)-(\d+)(?::(\d+))?$/.exec(a);
    if (!range) return [Number(a)];
    const list = [];
    for (let f = Number(range[1]); f <= Number(range[2]); f += Number(range[3] ?? 1)) list.push(f);
    return list;
  });
if (!frames.length) throw new Error("Name the frames to render, such as 300 450 1200-1220:5.");

await mkdir(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(packageRoot, "src", "index.ts"), publicDir: path.join(packageRoot, "public"), symlinkPublicDir: true });
const browser = await openBrowser("chrome", { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null });
try {
  const composition = await selectComposition({ serveUrl, id: "Promo", puppeteerInstance: browser });
  for (const frame of frames) {
    const output = path.join(out, `${String(frame).padStart(4, "0")}${scale === 2 ? "@4k" : ""}.png`);
    await renderStill({ serveUrl, composition, frame, output, scale, puppeteerInstance: browser, imageFormat: "png", overwrite: true });
    console.log(`still: ${path.relative(packageRoot, output)}`);
  }
} finally {
  await browser.close({ silent: true });
}
