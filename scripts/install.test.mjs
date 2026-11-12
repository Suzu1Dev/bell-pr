import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const installer = fileURLToPath(new URL("../install.sh", import.meta.url));
const shell = "/bin/sh";
const posix = process.platform !== "win32";

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-install-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "tools");
  const home = path.join(directory, "home");
  const calls = path.join(directory, "npm-calls.jsonl");
  await mkdir(bin);
  await mkdir(home);
  for (const name of [".profile", ".bashrc", ".zshrc"])
    await writeFile(path.join(home, name), "keep this profile\n");
  async function executable(name, text) {
    const file = path.join(bin, name);
    await writeFile(file, text);
    await chmod(file, 0o755);
  }
  await executable("uname", '#!/bin/sh\nif [ "$1" = -m ]; then printf "%s\\n" "$TEST_ARCH"; else printf "%s\\n" "$TEST_OS"; fi\n');
  const nodeSource = `#!/bin/sh
if [ "$1" = -p ]; then
  printf '%s\\n' "$TEST_NODE"
  exit 0
fi
exec "$TEST_REAL_NODE" "$@"
`;
  if (!options.noNode) await executable("node", nodeSource);
  const npmSource = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') process.exit(Number(process.env.TEST_NPM_PROBE ?? 0));
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({args, stdin: fs.readFileSync(0, 'utf8')}) + '\\n');
if (process.env.TEST_NPM_FAIL === '1') process.exit(7);
if (process.env.TEST_NO_BIN === '1') process.exit(0);
const prefix = args[args.indexOf('--prefix') + 1];
fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
fs.writeFileSync(path.join(prefix, 'bin', 'bell-pr'), '#!/usr/bin/env node\\nrequire("node:fs").writeFileSync(process.env.TEST_LAUNCH, "started");\\n', { mode: 0o755 });
`;
  if (!options.noNpm) await executable("npm", npmSource);
  await writeFile(path.join(directory, "private-node"), nodeSource.replace('"$TEST_NODE"', '"$TEST_PRIVATE_NODE"'));
  await writeFile(path.join(directory, "private-npm"), npmSource.replace("TEST_NPM_PROBE", "TEST_PRIVATE_NPM_PROBE"));
  for (const tool of ["awk", "mktemp", "mkdir", "rm"]) {
    const location = spawnSync(shell, ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    await symlink(location, path.join(bin, tool));
  }
  if (!options.noCurl) await executable("curl", `#!${process.execPath}
const fs = require('node:fs');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const url = args.find(arg => arg.startsWith('https://'));
fs.appendFileSync(process.env.TEST_DOWNLOADS, url + '\\n');
if (process.env.TEST_DOWNLOAD_FAIL === '1') process.exit(22);
const body = 'node fixture archive';
const digest = process.env.TEST_CHECKSUM_BAD === '1' ? '0'.repeat(64) : crypto.createHash('sha256').update(body).digest('hex');
const file = 'node-v24.1.2-' + process.env.TEST_PRIVATE_NODE.split(':')[0] + '-' + (['aarch64','arm64'].includes(process.env.TEST_ARCH) ? 'arm64' : 'x64') + '.tar.gz';
fs.writeFileSync(args[args.indexOf('-o') + 1], url.endsWith('SHASUMS256.txt') ? (process.env.TEST_MANIFEST_BAD === '1' ? '' : digest + '  ' + file + '\\n') : body);
`);
  await executable(options.shasum ? "shasum" : "sha256sum", `#!${process.execPath}
const fs = require('node:fs');
const crypto = require('node:crypto');
const file = process.argv.at(-1);
console.log(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + file);
`);
  await executable("tar", `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(process.env.TEST_EXTRACTED, 'yes');
if (process.env.TEST_TAR_FAIL === '1') process.exit(2);
const destination = path.join(process.argv[process.argv.indexOf('-C') + 1], 'bin');
fs.mkdirSync(destination, { recursive: true });
for (const name of ['node', 'npm']) {
  fs.copyFileSync(path.join(process.env.TEST_DIRECTORY, 'private-' + name), path.join(destination, name));
  fs.chmodSync(path.join(destination, name), 0o755);
}
`);
  await executable("sudo", '#!/bin/sh\nprintf forbidden > "$TEST_SUDO"\nexit 99\n');
  const env = {
    PATH: bin, HOME: home, LANG: "en_US.UTF-8",
    TEST_OS: "Linux", TEST_ARCH: "x86_64", TEST_NODE: "linux:22", TEST_PRIVATE_NODE: "linux:24", TEST_REAL_NODE: process.execPath,
    TEST_CALLS: calls, TEST_SUDO: path.join(directory, "sudo-used"),
    TEST_LAUNCH: path.join(directory, "cli-started"),
    TEST_DIRECTORY: directory, TEST_DOWNLOADS: path.join(directory, "downloads"), TEST_EXTRACTED: path.join(directory, "extracted"),
  };
  return {
    directory, home, bin, calls,
    run(args = [], extra = {}, piped) {
      return spawnSync(shell, piped === undefined ? [installer, ...args] : ["-s", "--", ...args], {
        env: { ...env, ...extra }, encoding: "utf8", timeout: 10_000, input: piped,
      });
    },
    async recorded() {
      return (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    },
  };
}

test("help works without Node/npm and has matching English and Traditional Chinese options", { skip: !posix }, async (t) => {
  const f = await fixture(t, { noNode: true, noNpm: true });
  for (const lang of ["en", "zh-TW"]) {
    const result = f.run(["--help", "--lang", lang]);
    assert.equal(result.status, 0, result.stderr);
    for (const option of ["--version", "--prefix", "--lang", "--help"])
      assert.ok(result.stdout.includes(option));
  }
  assert.match(f.run(["--help"], { LANG: "zh_TW.UTF-8" }).stdout, /安裝/);
});

test("missing arguments, unsafe versions and invalid prefixes never invoke npm install", { skip: !posix }, async (t) => {
  const f = await fixture(t);
  for (const args of [
    ["--unknown"], ["--prefix"], ["--version"], ["--lang", "fr"],
    ["--prefix", "relative"], ["--prefix", "/tmp/colon:path"], ["--prefix", "/tmp/line\nbreak"],
    ["--version", "latest"], ["--version", "^1.0.0"], ["--version", "1.0"],
    ["--version", "01.0.0"], ["--version", "1.0.0-01"], ["--version", "--unsafe-perm"],
    ["--version", "1.0.0; touch bad"], ["--version", "$(touch bad)"],
    ["--version", "https://example.invalid/package.tgz"],
  ]) {
    const result = f.run(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.notEqual(result.stderr, "", JSON.stringify(args));
  }
  await assert.rejects(readFile(f.calls), { code: "ENOENT" });
});

test("unsupported systems and missing bootstrap tools fail before installation", { skip: !posix }, async (t) => {
  const f = await fixture(t);
  for (const [env, message] of [
    [{ TEST_OS: "FreeBSD" }, /macOS, Linux and WSL/],
    [{ TEST_OS: "MINGW64_NT" }, /macOS, Linux and WSL/],
    [{ TEST_NODE: "linux:20", TEST_ARCH: "riscv64" }, /supports x64 and arm64/],
    [{ HOME: "" }, /HOME is unset/],
  ]) {
    const result = f.run([], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
  const missing = await fixture(t, { noNode: true, noCurl: true });
  assert.match(missing.run().stderr, /requires curl/);
  await assert.rejects(readFile(f.calls), { code: "ENOENT" });
});

test("default user install uses safe npm boundaries without scripts, sudo, profiles or launching", { skip: !posix }, async (t) => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const prefix = path.join(f.home, ".local");
  assert.deepEqual(await f.recorded(), [{
    args: ["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", "--", "bell-pr@latest"],
    stdin: "",
  }]);
  assert.ok(result.stdout.includes(`'${prefix}/bin/bell-pr'`));
  assert.ok(result.stdout.includes(`'${prefix}/bin/bell-pr' doctor`));
  assert.ok(result.stdout.includes(`export PATH='${prefix}/bin':"$PATH"`));
  for (const name of [".profile", ".bashrc", ".zshrc"])
    assert.equal(await readFile(path.join(f.home, name), "utf8"), "keep this profile\n");
  await assert.rejects(readFile(path.join(f.directory, "sudo-used")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(f.directory, "cli-started")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(f.directory, "downloads")), { code: "ENOENT" });
  assert.ok(result.stdout.indexOf("export PATH=") < result.stdout.indexOf(`'${prefix}/bin/bell-pr'`));
});

test("missing or unsuitable Node/npm bootstraps verified official Node and prints usable paths", { skip: !posix }, async (t) => {
  for (const [options, extra] of [
    [{ noNode: true, noNpm: true }, {}],
    [{ noNpm: true }, {}],
    [{}, { TEST_NODE: "linux:20" }],
    [{}, { TEST_NODE: "win32:24" }],
    [{}, { TEST_NPM_PROBE: "1" }],
    [{ noNode: true, shasum: true }, { TEST_OS: "Darwin", TEST_ARCH: "arm64", TEST_PRIVATE_NODE: "darwin:24" }],
  ]) {
    const f = await fixture(t, options);
    const prefix = path.join(f.directory, "user's node tools");
    const result = f.run(["--prefix", prefix], extra);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Downloading and verifying official Node.js 24/);
    const downloads = await readFile(path.join(f.directory, "downloads"), "utf8");
    assert.match(downloads, /^https:\/\/nodejs\.org\/dist\/latest-v24\.x\/SHASUMS256\.txt\nhttps:\/\/nodejs\.org\/dist\/latest-v24\.x\/node-v24\.1\.2-(linux-x64|darwin-arm64)\.tar\.gz\n$/);
    assert.equal(await readFile(path.join(f.directory, "extracted"), "utf8"), "yes");
    assert.match(result.stdout, /share\/bell-pr\/node\/bin/);
    const direct = result.stdout.split("\n").find(line => line.startsWith("PATH="));
    const parsed = spawnSync(shell, ["-c", direct], { env: { PATH: f.bin, TEST_REAL_NODE: process.execPath, TEST_LAUNCH: path.join(f.directory, "direct-started") }, encoding: "utf8" });
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.equal(await readFile(path.join(f.directory, "direct-started"), "utf8"), "started");
    // A second invocation reuses the working private runtime without downloading again.
    assert.equal(f.run(["--prefix", prefix], { ...extra, TEST_DOWNLOAD_FAIL: "1" }).status, 0);
    assert.equal(await readFile(path.join(f.directory, "downloads"), "utf8"), downloads);
  }
});

test("printed PATH export uses private Node before an old Node in the installation prefix", { skip: !posix }, async (t) => {
  const f = await fixture(t, { noNode: true });
  const prefix = path.join(f.directory, "user's existing tools");
  const prefixBin = path.join(prefix, "bin");
  const oldNode = '#!/bin/sh\nif [ "$1" = -p ]; then printf "linux:20\\n"; else exit 90; fi\n';
  await mkdir(prefixBin, { recursive: true });
  await writeFile(path.join(prefixBin, "node"), oldNode, { mode: 0o755 });
  const originalPath = `${prefixBin}:${f.bin}`;
  const result = f.run(["--prefix", prefix], { PATH: originalPath });
  assert.equal(result.status, 0, result.stderr);
  const pathExport = result.stdout.split("\n").find(line => line.startsWith("export PATH="));
  assert.ok(pathExport);
  const launched = path.join(f.directory, "export-started");
  const command = spawnSync(shell, ["-c", `${pathExport}\nbell-pr`], {
    env: { PATH: originalPath, TEST_REAL_NODE: process.execPath, TEST_LAUNCH: launched }, encoding: "utf8",
  });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(await readFile(launched, "utf8"), "started");
  assert.equal(await readFile(path.join(prefixBin, "node"), "utf8"), oldNode);
});

test("bad checksums or downloads never extract, and failed runtime installs leave no private directory", { skip: !posix }, async (t) => {
  for (const [extra, message, extracted] of [
    [{ TEST_CHECKSUM_BAD: "1" }, /checksum verification failed/, false],
    [{ TEST_MANIFEST_BAD: "1" }, /checksum verification failed/, false],
    [{ TEST_DOWNLOAD_FAIL: "1" }, /Could not download/, false],
    [{ TEST_TAR_FAIL: "1" }, /Could not install or run/, true],
    [{ TEST_PRIVATE_NODE: "linux:20" }, /Could not install or run/, true],
  ]) {
    const f = await fixture(t, { noNode: true });
    const result = f.run([], extra);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    if (!extracted) await assert.rejects(readFile(path.join(f.directory, "extracted")), { code: "ENOENT" });
    await assert.rejects(readFile(f.calls), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(f.home, ".local/share/bell-pr/node/bin/node")), { code: "ENOENT" });
  }
});

test("an unusable existing private runtime is preserved without downloads", { skip: !posix }, async (t) => {
  const f = await fixture(t, { noNode: true });
  const privateNode = path.join(f.home, ".local/share/bell-pr/node");
  await mkdir(privateNode, { recursive: true });
  await writeFile(path.join(privateNode, "keep"), "existing data");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /was not overwritten/);
  assert.equal(await readFile(path.join(privateNode, "keep"), "utf8"), "existing data");
  await assert.rejects(readFile(path.join(f.directory, "downloads")), { code: "ENOENT" });
});

test("an exact release and quoted prefix work on macOS, including a pipe and PATH already configured", { skip: !posix }, async (t) => {
  const f = await fixture(t);
  const prefix = path.join(f.directory, "a user's tools $(not-a-command)");
  const script = await readFile(installer, "utf8");
  const result = f.run(["--prefix", prefix, "--version", "1.2.3-rc.1+build.2", "--lang", "zh-TW"], {
    TEST_OS: "Darwin", TEST_NODE: "darwin:24", PATH: `${f.bin}:${prefix}/bin`,
  }, `${script}\nprintf 'PIPE_REMAINDER_OK\\n'\n`);
  assert.equal(result.status, 0, result.stderr);
  const [call] = await f.recorded();
  assert.equal(call.args[3], prefix);
  assert.equal(call.args.at(-1), "bell-pr@1.2.3-rc.1+build.2");
  assert.equal(call.stdin, "");
  assert.match(result.stdout, /安裝完成/);
  assert.match(result.stdout, /PIPE_REMAINDER_OK/);
  assert.doesNotMatch(result.stdout, /export PATH=/);
  // Printed commands must round-trip as literal paths, without shell expansion.
  const command = result.stdout.split("\n").find((line) => line.startsWith("'"));
  const parsed = spawnSync(shell, ["-c", `set -- ${command}; printf '%s' "$1"`], { encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal(parsed.stdout, path.join(prefix, "bin", "bell-pr"));
});

test("npm failure or a release without a CLI never reports success", { skip: !posix }, async (t) => {
  for (const [env, message] of [[{ TEST_NPM_FAIL: "1" }, /installation failed/], [{ TEST_NO_BIN: "1" }, /no executable CLI/]]) {
    const f = await fixture(t);
    const result = f.run([], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stdout, /is installed/);
  }
});
