import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(repoDir, "site", "check-site.mjs");

/** Runs the site checker against a copy of site/. */
function checkCopy(dir) {
  return spawnSync(process.execPath, [checker], {
    cwd: repoDir,
    env: { ...process.env, CHECK_SITE_DIR: dir },
    encoding: "utf8",
  });
}

test("a copy of the site passes the site check", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bell-site-"));
  fs.cpSync(path.join(repoDir, "site"), dir, { recursive: true });
  const result = checkCopy(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("an English sentence added to a zh-tw page fails the site check", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bell-site-"));
  fs.cpSync(path.join(repoDir, "site"), dir, { recursive: true });
  const page = path.join(dir, "zh-tw", "index.html");
  const html = fs.readFileSync(page, "utf8");
  fs.writeFileSync(page, html.replace("<main id=\"main\">", "<main id=\"main\">\n<p>Deploy now</p>"));
  const result = checkCopy(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Deploy now/);
});
