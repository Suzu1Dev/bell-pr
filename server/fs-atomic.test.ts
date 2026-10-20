import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeDurable } from "./fs-atomic.js";

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-fs-atomic-"));
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("writeDurable replaces a file with mode 0600 and leaves no temporary file", async (t) => {
  const { directory, cleanup } = await temporaryDirectory();
  t.after(cleanup);
  const file = path.join(directory, "state.json");
  await writeFile(file, "old", { mode: 0o644 });
  await writeDurable(file, '{"version":1}');
  assert.equal(await readFile(file, "utf8"), '{"version":1}');
  if (process.platform !== "win32")
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), ["state.json"]);
  // Bytes and an explicit mode work too.
  await writeDurable(file, new TextEncoder().encode("bytes"), { mode: 0o640 });
  assert.equal(await readFile(file, "utf8"), "bytes");
  if (process.platform !== "win32")
    assert.equal((await stat(file)).mode & 0o777, 0o640);
});

test("concurrent writeDurable calls use distinct temporary files and one of them wins", async (t) => {
  const { directory, cleanup } = await temporaryDirectory();
  t.after(cleanup);
  const file = path.join(directory, "settings.json");
  const values = Array.from({ length: 12 }, (_, index) => `value-${index}`);
  await Promise.all(values.map((value) => writeDurable(file, value)));
  assert.ok(values.includes(await readFile(file, "utf8")));
  assert.deepEqual(await readdir(directory), ["settings.json"]);
});

test("a failed write removes its temporary file and keeps the old content", async (t) => {
  const { directory, cleanup } = await temporaryDirectory();
  t.after(cleanup);
  await assert.rejects(
    writeDurable(path.join(directory, "missing", "state.json"), "new"),
    { code: "ENOENT" },
  );
  // A directory in the way makes the rename fail after the write.
  const blocked = path.join(directory, "blocked");
  await writeFile(path.join(directory, "keep.json"), "old");
  await mkdir(path.join(blocked, "inside"), { recursive: true });
  await assert.rejects(writeDurable(blocked, "new"));
  assert.deepEqual((await readdir(directory)).sort(), ["blocked", "keep.json"]);
  assert.equal(await readFile(path.join(directory, "keep.json"), "utf8"), "old");
});

test("a crash between the write and the rename leaves the old file intact", async (t) => {
  const { directory, cleanup } = await temporaryDirectory();
  t.after(cleanup);
  const file = path.join(directory, "state.json");
  await writeFile(file, "old content");
  // A child process writes durably and is killed (SIGKILL) at the moment
  // it would rename, after the data was flushed: the same state a power
  // loss or a crash leaves.
  const script = path.join(directory, "crash.mts");
  await writeFile(
    script,
    `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const { writeDurable } = await import(${JSON.stringify(
      path.join(import.meta.dirname, "fs-atomic.ts"),
    )});
fs.promises.rename = (async () => {
  process.kill(process.pid, "SIGKILL");
  await new Promise(() => undefined);
}) as typeof fs.promises.rename;
syncBuiltinESMExports();
await writeDurable(${JSON.stringify(file)}, "new content");
`,
  );
  const child = spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(child.signal, "SIGKILL", child.stderr);
  assert.equal(await readFile(file, "utf8"), "old content");
  const leftovers = (await readdir(directory)).filter((name) =>
    name.endsWith(".tmp"),
  );
  assert.equal(leftovers.length, 1);
  assert.match(leftovers[0], /^state\.json\.\d+\.[0-9a-f]{12}\.tmp$/);
  // The temporary file was complete and private before the rename.
  const temporary = path.join(directory, leftovers[0]);
  assert.equal(await readFile(temporary, "utf8"), "new content");
  if (process.platform !== "win32")
    assert.equal((await stat(temporary)).mode & 0o777, 0o600);
});
