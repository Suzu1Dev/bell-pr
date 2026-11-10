// A preload for the real starts of server/startup.test.ts
// (NODE_OPTIONS --import): it gives a start what a file system without hard
// links, or a suspension between two calls, would give it. The environment
// names where; each value is a regular expression matched against the path.
//
//   LOCK_TEST_NO_LINK       linkSync to a matching path fails with EPERM,
//                           so the start writes that file in place
//   LOCK_TEST_STALL_WRITE   the start halts once, between creating a
//                           matching file in place and writing its text
//   LOCK_TEST_STALL_REMOVE  the start halts once, just before it removes a
//                           matching file
//   LOCK_TEST_HOOK          a path: halted, the start writes
//                           `<hook>.reached` and goes on once `<hook>.go`
//                           exists
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const { LOCK_TEST_NO_LINK, LOCK_TEST_STALL_WRITE, LOCK_TEST_STALL_REMOVE, LOCK_TEST_HOOK } =
  process.env;
const { linkSync, openSync, writeSync, rmSync } = fs;

/** Blocks the whole process, as a suspension does, until the test lets it go on. */
function halt() {
  fs.writeFileSync(`${LOCK_TEST_HOOK}.reached`, "");
  const pause = new Int32Array(new SharedArrayBuffer(4));
  // A test that was killed never lets it go on: it must not wait for good.
  const giveUp = Date.now() + 300_000;
  while (!fs.existsSync(`${LOCK_TEST_HOOK}.go`)) {
    if (Date.now() > giveUp) process.exit(1);
    Atomics.wait(pause, 0, 0, 20);
  }
}

if (LOCK_TEST_NO_LINK) {
  const pattern = new RegExp(LOCK_TEST_NO_LINK);
  fs.linkSync = (existing, created) => {
    if (!pattern.test(String(created))) return linkSync(existing, created);
    throw Object.assign(
      new Error(`EPERM: operation not permitted, link '${existing}' -> '${created}'`),
      { code: "EPERM", syscall: "link" },
    );
  };
}

if (LOCK_TEST_STALL_WRITE) {
  const pattern = new RegExp(LOCK_TEST_STALL_WRITE);
  // The descriptor of the matching file once it is created; null after the halt.
  let created;
  fs.openSync = (file, flags, mode) => {
    const fd = openSync(file, flags, mode);
    if (created === undefined && flags === "wx" && pattern.test(String(file))) created = fd;
    return fd;
  };
  fs.writeSync = (fd, ...rest) => {
    if (fd === created) {
      created = null;
      halt();
    }
    return writeSync(fd, ...rest);
  };
}

if (LOCK_TEST_STALL_REMOVE) {
  const pattern = new RegExp(LOCK_TEST_STALL_REMOVE);
  let halted = false;
  fs.rmSync = (file, options) => {
    if (!halted && pattern.test(String(file))) {
      halted = true;
      halt();
    }
    return rmSync(file, options);
  };
}

syncBuiltinESMExports();
