/**
 * A start contending for a data directory's lock, for tests that run it in
 * another PID namespace: it notes where it runs and whether the lock's pid
 * names a process there, then tries a start under the strict rule
 * (acquireWriterLock) and an ordinary start (startServer) on 127.0.0.1. It
 * prints one JSON line, { pidNamespace, holderPid, holderHere, strict,
 * ordinary }, each start "started" or the message it was refused with,
 * gives up whatever it took, and exits 1 when both were refused.
 *
 *   node --import tsx test/lock-contender.ts <dataDir>
 */
import { readlinkSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { resolveConfig } from "../server/config.js";
import { acquireWriterLock, readLock, startServer } from "../server/index.js";

const [dataDir] = process.argv.slice(2);

/** How kill(pid, 0) answers here: "alive", or its error code. */
function signalable(pid: number) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
}

async function freePort() {
  const probe = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => probe.once("listening", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function outcome(start: () => Promise<{ shutdown?: () => Promise<void>; release?: () => void }>) {
  try {
    const started = await start();
    await started.shutdown?.();
    started.release?.();
    return "started";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const holderPid = readLock(dataDir)?.pid;
const report = {
  pidNamespace: readlinkSync("/proc/self/ns/pid"),
  holderPid,
  holderHere: holderPid === undefined ? undefined : signalable(holderPid),
  strict: await outcome(() => acquireWriterLock(dataDir)),
  ordinary: await outcome(async () => {
    const env = { ...process.env, BELLPR_LOCALE: "en", BELLPR_NO_OPEN: "1", BELLPR_DATA_DIR: "" };
    return await startServer({
      config: resolveConfig({ host: "127.0.0.1", port: String(await freePort()), dataDir }, env),
      handleExit: false,
      print: () => {},
      warn: () => {},
    });
  }),
};
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.strict === "started" || report.ordinary === "started" ? 0 : 1);
