#!/usr/bin/env node
/**
 * Puts every gitignored asset the render needs in place (all under public/):
 *
 * 1. music/<audioFile>: the licensed track, checked by MD5 (copied from
 *    PROMO_MUSIC_FILE when missing; see MUSIC-LICENSE.md);
 * 2. brand-assets/: the product's brand SVGs (public/brand of the repository);
 * 3. stage/: the pre-dithered stage plates (scripts/make-stage.mjs);
 * 4. sfx/: the Mixkit sound effects of SFX-LICENSES.md, downloaded from
 *    Mixkit's own asset URLs and checked by MD5 (`--offline` refuses to
 *    download and fails when one is missing);
 * 5. footage-2x/ and footage-soft/: the footage proxies (scripts/make-proxies.mjs).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const offline = process.argv.includes("--offline");
const md5 = async (file) => createHash("md5").update(await readFile(file)).digest("hex");

/** The sound effects (SFX-LICENSES.md has one entry per file). */
export const sfx = [
  { id: 1465, file: "mixkit-vacuum-swoosh-transition-1465.wav", md5: "ef44f36fe821092b514092e1579609ef" },
  { id: 1489, file: "mixkit-air-woosh-1489.wav", md5: "7237076096e8772ecc9219f79dcf4315" },
  { id: 1471, file: "mixkit-cinematic-wind-swoosh-1471.wav", md5: "ff341012fc5a78bf22efa0c425440fdf" },
  { id: 871, file: "mixkit-fairy-magic-sparkle-871.wav", md5: "749017de847d7846002812a8e5bb58ec" },
  { id: 2997, file: "mixkit-clear-mouse-clicks-2997.wav", md5: "f85d3fac793cb7528d62aa8efb6b57a7" },
  { id: 2531, file: "mixkit-typing-on-a-laptop-keyboard-2531.wav", md5: "09a19557818475ec115cd7d64526bdd3" },
];

async function music() {
  const analysis = JSON.parse(await readFile(path.join(packageRoot, "music", "track.analysis.json"), "utf8"));
  const target = path.join(packageRoot, "public", analysis.audioFile);
  if (!existsSync(target)) {
    const source = process.env.PROMO_MUSIC_FILE;
    if (!source) throw new Error(`The music is missing: put the licensed file at public/${analysis.audioFile} or set PROMO_MUSIC_FILE (MUSIC-LICENSE.md).`);
    if ((await md5(source)) !== analysis.md5) throw new Error("PROMO_MUSIC_FILE is not the licensed track (MD5 differs).");
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  if ((await md5(target)) !== analysis.md5) throw new Error(`public/${analysis.audioFile} is not the licensed track (MD5 differs).`);
  console.log(`assets: public/${analysis.audioFile} (MD5 ok)`);
}

async function brand() {
  const target = path.join(packageRoot, "public", "brand-assets");
  await rm(target, { recursive: true, force: true });
  await cp(path.join(repoRoot, "public", "brand"), target, { recursive: true, filter: (source) => !/\.png$/i.test(source) });
  console.log("assets: public/brand-assets/ (the product's brand SVGs)");
}

async function sounds() {
  const dir = path.join(packageRoot, "public", "sfx");
  await mkdir(dir, { recursive: true });
  for (const item of sfx) {
    const file = path.join(dir, item.file);
    if (!existsSync(file) || (await md5(file)) !== item.md5) {
      if (offline) throw new Error(`public/sfx/${item.file} is missing or differs (and --offline was given).`);
      const url = `https://assets.mixkit.co/active_storage/sfx/${item.id}/${item.id}.wav`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      if ((await md5(file)) !== item.md5) throw new Error(`${url} is not the file SFX-LICENSES.md records (MD5 differs).`);
      console.log(`assets: downloaded Mixkit item ${item.id} to public/sfx/${item.file}`);
    }
  }
  console.log(`assets: public/sfx/ (${sfx.length} Mixkit sound effects, MD5 ok)`);
}

const node = (script, ...args) => execFileSync(process.execPath, [path.join(packageRoot, "scripts", script), ...args], { stdio: "inherit" });

await music();
await brand();
if (!existsSync(path.join(packageRoot, "public", "stage", "light@2x.png"))) node("make-stage.mjs");
else console.log("assets: public/stage/ (present)");
await sounds();
node("make-proxies.mjs");
