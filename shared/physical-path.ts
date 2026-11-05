/**
 * Physical paths for the worktree identity check (`server/process.ts`) and
 * the credential deny list (`shared/credential-denials.ts`), so both resolve
 * symbolic links the same way.
 */
import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * The path with symbolic links resolved. When it does not exist, the nearest
 * existing ancestor is resolved and the missing part is kept as given, so a
 * new `/var/a/b` on macOS is `/private/var/a/b`, as it will be once created.
 * Falls back to the absolute path when no ancestor resolves.
 */
export function physicalPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    // Missing or unreadable: resolve the nearest ancestor below.
  }
  const given = path.resolve(value);
  const missing: string[] = [];
  let ancestor = given;
  while (path.dirname(ancestor) !== ancestor) {
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
    try {
      return path.join(realpathSync(ancestor), ...missing);
    } catch {
      // Keep walking up.
    }
  }
  return given;
}
