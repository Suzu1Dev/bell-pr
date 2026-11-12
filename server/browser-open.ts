import { randomBytes } from "node:crypto";
import { constants, chmodSync, closeSync, lstatSync, mkdirSync, openSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Return false (or reject) when launching fails; void callbacks remain supported. */
export type BrowserOpener = (url: string) => unknown;
const lifetime = 60_000;

/** Keep credentials in a private redirect file, never in an opener's argv. */
export async function openBrowserFile(
  dataDir: string,
  target: string,
  opener: BrowserOpener | undefined,
  hint: () => void,
): Promise<() => void> {
  let file: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const onSignal = (signal: NodeJS.Signals) => {
    cleanup();
    // Preserve Node's default termination when there is no server handler.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    process.off("exit", cleanup);
    process.off("uncaughtExceptionMonitor", cleanup);
    for (const signal of signals) process.off(signal, onSignal);
    if (file) {
      try { unlinkSync(file); } catch { /* Already removed or unavailable. */ }
      file = undefined;
    }
  };
  try {
    const directory = path.resolve(dataDir, "browser-open");
    mkdirSync(directory, { mode: 0o700, recursive: true });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (process.getuid && stat.uid !== process.getuid())) throw new Error();
    chmodSync(directory, 0o700);
    for (const name of readdirSync(directory)) {
      if (!/^[a-f0-9]{32}\.html$/.test(name)) continue;
      const stale = path.join(directory, name);
      if (lstatSync(stale).mtimeMs <= Date.now() - lifetime) unlinkSync(stale);
    }
    if (!opener) { hint(); return cleanup; }
    const candidate = path.join(directory, `${randomBytes(16).toString("hex")}.html`);
    // Escape '<' so even an unusual URL cannot terminate the script element.
    const literal = JSON.stringify(target).replaceAll("<", "\\u003c");
    const fd = openSync(candidate, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    file = candidate;
    try {
      writeFileSync(fd, `<!doctype html><meta charset="utf-8"><script>location.replace(${literal})</script>`);
    } finally {
      closeSync(fd);
    }
    process.once("exit", cleanup);
    process.once("uncaughtExceptionMonitor", cleanup);
    for (const signal of signals) process.on(signal, onSignal);
    timer = setTimeout(cleanup, lifetime);
    timer.unref();
    if (await opener(pathToFileURL(file).href) === false) throw new Error();
  } catch {
    cleanup();
    hint();
  }
  return cleanup;
}
