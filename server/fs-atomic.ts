/**
 * Durable file writes. A reader never sees a half-written file, and a
 * crash at any point leaves either the old content or the new content.
 */
import { randomBytes } from "node:crypto";
import { open, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";

/**
 * Replaces `file` with `data`, so that the new content survives a crash
 * or power loss once the promise resolves:
 *
 * 1. writes a temporary file with a name unique to this process and call
 *    (`<name>.<pid>.<random>.tmp`, next to the target), with `mode`;
 * 2. flushes it to disk (`fsync`) and closes it;
 * 3. renames it over the target, which is atomic on one file system;
 * 4. flushes the directory, so the rename itself is on disk. Platforms
 *    that cannot open a directory for that (Windows) skip this step.
 *
 * A crash before the rename leaves the old file intact and the temporary
 * file behind; the startup janitor removes such `*.tmp` leftovers. The
 * directory must exist. The mode defaults to 0600 and is applied exactly,
 * whatever the umask.
 */
export async function writeDurable(
  file: string,
  data: string | Uint8Array,
  opts: { mode?: number } = {},
): Promise<void> {
  const mode = opts.mode ?? 0o600;
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `${path.basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx", mode);
    // open() applies the umask; the caller asked for this exact mode.
    if (process.platform !== "win32") await handle.chmod(mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDirectory(directory);
}

/** Flushes a directory entry change to disk where the platform allows it. */
async function syncDirectory(directory: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Windows cannot open a directory, and some file systems reject fsync
    // on one; the rename already happened, so this is only best effort.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
