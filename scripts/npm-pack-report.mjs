import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * `value` as the command or one argument of a spawnSync call that uses
 * `shell: true` exactly on Windows, as npm (npm.cmd) needs there. Node
 * passes that command line to cmd.exe unquoted, so a path with a space,
 * such as a temporary folder under C:\Users\Octo Cat, would split. Quoted
 * on Windows (a backslash before the closing quote doubled), unchanged
 * elsewhere.
 */
export function shellArg(value, platform = process.platform) {
  return platform === "win32" ? `"${value.replace(/(\\+)$/, "$1$1")}"` : value;
}

/** Finds npm's pack report among lifecycle output and bracketed build warnings. */
export function parsePackReport(stdout) {
  const offsets = (regex) => [...stdout.matchAll(regex)].map((match) => match.index);
  const starts = offsets(/^\[/gm);
  const ends = [stdout.length, ...offsets(/^\]/gm).map((index) => index + 1).reverse()];
  for (const start of starts)
    for (const end of ends) {
      if (end <= start) continue;
      try {
        const report = JSON.parse(stdout.slice(start, end));
        if (Array.isArray(report) && Array.isArray(report[0]?.files)) return report[0];
      } catch {
        // Not the report; try the next candidate.
      }
    }
  throw new Error("could not read the JSON report of npm pack.");
}

/**
 * The report npm prints for a pack, read back from a tarball that is
 * already packed: name and version from its package.json, the packed size,
 * and every file with its size. `contents` maps each path to its bytes.
 * npm writes a gzipped tar of ustar entries under package/, with a pax
 * header for a path that does not fit the ustar name fields.
 */
export function tarballReport(file) {
  const packed = readFileSync(file);
  const data = gunzipSync(packed);
  const text = (start, length) => {
    const bytes = data.subarray(start, start + length);
    const end = bytes.indexOf(0);
    return bytes.toString("utf8", 0, end === -1 ? length : end);
  };
  const contents = new Map();
  let paxPath;
  // Two zero blocks end the archive.
  for (let offset = 0; offset + 512 <= data.length && data[offset] !== 0; ) {
    const size = Number.parseInt(text(offset + 124, 12).trim() || "0", 8);
    // A size of -512 or less would keep the cursor in place, or move it back.
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`unreadable tar header at byte ${offset}.`);
    if (offset + 512 + size > data.length) throw new Error(`the tar entry at byte ${offset} is cut short.`);
    const type = text(offset + 156, 1) || "0";
    const ustar = data.toString("latin1", offset + 257, offset + 263) === "ustar\0";
    const prefix = ustar ? text(offset + 345, 155) : "";
    const name = paxPath ?? (prefix ? `${prefix}/${text(offset, 100)}` : text(offset, 100));
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      // Records of the form "<length> <key>=<value>\n"; only the path matters here.
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"))?.[1];
      continue;
    }
    paxPath = undefined;
    if (type === "5" || type === "g") continue;
    if (type !== "0" && type !== "7") throw new Error(`${name} is a tar entry of type "${type}", not a file.`);
    if (!name.startsWith("package/")) throw new Error(`${name} is outside package/, so this is not an npm package.`);
    contents.set(name.slice("package/".length), body);
  }
  let manifest;
  try {
    manifest = JSON.parse(contents.get("package.json").toString("utf8"));
  } catch {
    throw new Error("the tarball has no readable package/package.json.");
  }
  const files = [...contents].map(([name, bytes]) => ({ path: name, size: bytes.length }));
  return {
    name: manifest.name,
    version: manifest.version,
    filename: path.basename(file),
    size: packed.length,
    unpackedSize: files.reduce((total, entry) => total + entry.size, 0),
    entryCount: files.length,
    files,
    contents,
  };
}
