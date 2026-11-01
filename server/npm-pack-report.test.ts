import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// Load the standalone Node script without a TypeScript declaration.
const { parsePackReport, tarballReport } = await import(new URL("../scripts/npm-pack-report.mjs", import.meta.url).href);

test("finds the pack report among bracketed build output", () => {
  const entry = { files: [{ path: "build/index.js" }], filename: "package.tgz" };
  const report = JSON.stringify([entry], null, 2);
  for (const stdout of [
    report,
    `[INEFFECTIVE_DYNAMIC_IMPORT] warning\n[]\n${report}\n[postpack] done\n]\n`,
    `> prepack\n[not JSON\n]\n${report}\n> postpack\n`,
    JSON.stringify([entry]),
  ]) assert.deepEqual(parsePackReport(stdout), entry);
  assert.throws(() => parsePackReport('[{"filename":"no-files.tgz"}]\n[warning]'), /could not read/);
});

test("reads a packed tarball back as npm reported it, long paths included", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "bellpr-pack-report-"));
  try {
    const project = path.join(temp, "project");
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
      writeFileSync(path.join(project, file), content);
    };
    // Over 100 bytes with package/: npm splits it into the ustar prefix and name.
    const nested = `dist/${"nested/".repeat(12)}chunk.js`;
    // A name over 100 bytes cannot be split, so npm writes a pax header.
    const long = `${"long-name-".repeat(11)}.txt`;
    write("package.json", JSON.stringify({ name: "pack-fixture", version: "1.2.3" }));
    write("README.md", "# Fixture\n");
    write(nested, "export {};\n");
    write(long, "pax\n");
    const windows = process.platform === "win32";
    const packed = spawnSync(
      windows ? "npm.cmd" : "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", temp],
      { cwd: project, encoding: "utf8", shell: windows, env: { ...process.env, npm_config_update_notifier: "false" } },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const npm = parsePackReport(packed.stdout);
    const report = tarballReport(path.join(temp, npm.filename));
    for (const key of ["name", "version", "filename", "size", "unpackedSize", "entryCount"])
      assert.equal(report[key], npm[key], key);
    const list = (files: { path: string; size: number }[]) => files.map((file) => `${file.path} ${file.size}`).sort();
    assert.deepEqual(list(report.files), list(npm.files));
    assert.equal(report.contents.get(nested).toString("utf8"), "export {};\n");
    assert.equal(report.contents.get(long).toString("utf8"), "pax\n");

    writeFileSync(path.join(temp, "plain.tgz"), "not gzip");
    assert.throws(() => tarballReport(path.join(temp, "plain.tgz")));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
