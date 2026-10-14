#!/usr/bin/env node
/**
 * Copies the renders into the landing site's media folder under the names
 * the site references. site/media/ is gitignored: the files are published
 * with the site, never committed. Refuses to copy into a tracked path.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const media = path.join(repoRoot, "site", "media");

const copies = [
  ["out/bell-pr-promo-en-1080p.mp4", "bell-pr-promo.mp4"],
  ["out/bell-pr-promo-en-1080p.webm", "bell-pr-promo.webm"],
  ["out/poster.jpg", "poster.jpg"],
  ["out/captions.en.vtt", "captions.en.vtt"],
];

function ignored(file) {
  try {
    execFileSync("git", ["check-ignore", "-q", file], { cwd: repoRoot, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

await mkdir(media, { recursive: true });
for (const [from, to] of copies) {
  const source = path.join(packageRoot, from);
  const target = path.join(media, to);
  await stat(source).catch(() => {
    throw new Error(`${from} is missing; run "npm run render" first.`);
  });
  if (!ignored(path.relative(repoRoot, target)))
    throw new Error(`site/media/${to} is not gitignored; refusing to copy it there.`);
  await copyFile(source, target);
  console.log(`site: ${from} -> site/media/${to}`);
}
