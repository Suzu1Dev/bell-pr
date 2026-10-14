/**
 * Server logger.
 *
 * Until `initLog(dataDir)` runs, each call writes one line to stderr, as
 * the early startup code expects: `<ISO timestamp> <LEVEL> <message>
 * <JSON fields>`. Once the Workbench (or the Store) calls `initLog`, every
 * entry is also appended as one JSON line `{ts, level, msg, ...fields}` to
 * `<dataDir>/logs/bell-pr-YYYY-MM-DD.log` (UTC day, mode 0600). Old files
 * are pruned so that at most 7 files and 50 MB remain. stderr then shows
 * readable, coloured lines on a terminal; elsewhere (a service manager, a
 * container) it shows warnings and errors only, and the file has the rest.
 *
 * The level comes from BELLPR_LOG_LEVEL (debug, info, warn or error; info
 * by default). The message and every field pass through `redact()`; still,
 * never log prompts, tokens or keys on purpose.
 */
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { redact } from "./secrets.js";

type LogFields = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

const levelRank: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const filePattern = /^bell-pr-(\d{4}-\d{2}-\d{2})\.log$/;
const maxStringLength = 4000;
const maxEntries = 50;
const maxDepth = 4;
/** How many bytes are written between two checks of the size budget. */
const pruneEvery = 1024 * 1024;

/** Where lines go once initLog ran; tests replace the clock, the limits and stderr. */
export interface LogOptions {
  now?: () => Date;
  /** Daily files kept, the current one included; 7 by default. */
  maxFiles?: number;
  /** Bytes all log files may use together; 50 MB by default. */
  maxBytes?: number;
  stderr?: { write(text: string): unknown; isTTY?: boolean };
}

interface Sink {
  directory: string;
  now: () => Date;
  maxFiles: number;
  maxBytes: number;
  stderr: { write(text: string): unknown; isTTY?: boolean };
  day?: string;
  fd?: number;
  /** Bytes written since the size budget was last checked. */
  unchecked: number;
  /** The current file alone used the budget; nothing more is written today. */
  full: boolean;
  /** Writing failed; the file stays off until initLog runs again. */
  broken: boolean;
}

let sink: Sink | undefined;

function threshold(): Level {
  const value = process.env.BELLPR_LOG_LEVEL?.trim().toLowerCase();
  return value && value in levelRank ? (value as Level) : "info";
}

/** Bounds and redacts a field value so one entry stays one readable line. */
function clean(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return redact(
      value.length > maxStringLength
        ? `${value.slice(0, maxStringLength)}…`
        : value,
    );
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error)
    return {
      name: value.name,
      message: clean(value.message, depth + 1),
      ...(typeof (value as NodeJS.ErrnoException).code === "string"
        ? { code: (value as NodeJS.ErrnoException).code }
        : {}),
      ...(value.stack ? { stack: clean(value.stack, depth + 1) } : {}),
    };
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return undefined;
  if (depth >= maxDepth) return "[nested]";
  if (Array.isArray(value))
    return value.slice(0, maxEntries).map((item) => clean(item, depth + 1));
  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, maxEntries)
    .map(([key, item]) => [redact(key), clean(item, depth + 1)] as const)
    .filter(([, item]) => item !== undefined);
  return Object.fromEntries(entries);
}

function cleanFields(fields?: LogFields): Record<string, unknown> {
  const cleaned = fields ? (clean(fields, -1) as Record<string, unknown>) : {};
  // The envelope keys belong to the entry itself.
  for (const key of ["ts", "level", "msg"]) delete cleaned[key];
  return cleaned;
}

function serialize(fields: Record<string, unknown>) {
  try {
    return JSON.stringify(fields);
  } catch {
    return JSON.stringify({ logFields: "unserializable" });
  }
}

/** The stub's line: one entry per line, so a newline cannot forge another entry. */
function plainLine(
  time: Date,
  level: Level,
  msg: string,
  fields: Record<string, unknown>,
) {
  const parts = [
    time.toISOString(),
    level.toUpperCase(),
    msg.replace(/\r?\n|\r/g, "\\n"),
  ];
  if (Object.keys(fields).length) parts.push(serialize(fields));
  return `${parts.join(" ")}\n`;
}

const colors: Record<Level, string> = {
  debug: "\u001b[90m",
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
};

/** A terminal line: local time, level, message, then key=value pairs. */
function prettyLine(
  time: Date,
  level: Level,
  msg: string,
  fields: Record<string, unknown>,
) {
  const color =
    !process.env.NO_COLOR && process.env.FORCE_COLOR !== "0";
  const paint = (code: string, text: string) =>
    color ? `${code}${text}\u001b[0m` : text;
  const pairs = Object.entries(fields).map(([key, value]) => {
    const text =
      typeof value === "string" && /^[^\s"=]+$/.test(value)
        ? value
        : serialize(value as Record<string, unknown>);
    return `${paint("\u001b[2m", `${key}=`)}${text}`;
  });
  return `${[
    paint("\u001b[2m", time.toTimeString().slice(0, 8)),
    paint(colors[level], level.toUpperCase().padEnd(5)),
    msg.replace(/\r?\n|\r/g, "\\n"),
    ...pairs,
  ].join(" ")}\n`;
}

/** The daily files in `directory`, newest first. */
function logFiles(directory: string) {
  return readdirSync(directory)
    .filter((name) => filePattern.test(name))
    .sort()
    .reverse();
}

/**
 * Keeps at most `maxFiles` daily files and `maxBytes` in total, removing
 * the oldest first and never the file in use. Returns the total size kept.
 */
function prune(current: Sink) {
  const keep = `bell-pr-${current.day}.log`;
  let total = 0;
  const kept: { name: string; size: number }[] = [];
  for (const [index, name] of logFiles(current.directory).entries()) {
    const file = path.join(current.directory, name);
    if (name !== keep && index >= current.maxFiles) {
      unlinkSync(file);
      continue;
    }
    const size = statSync(file).size;
    total += size;
    kept.push({ name, size });
  }
  // `kept` is newest first; drop from the end until the budget fits.
  for (let index = kept.length - 1; index >= 0 && total > current.maxBytes; index--) {
    if (kept[index].name === keep) continue;
    unlinkSync(path.join(current.directory, kept[index].name));
    total -= kept[index].size;
  }
  current.unchecked = 0;
  return total;
}

/** Opens the file for `day`, closing the previous one, and prunes old files. */
function openDay(current: Sink, day: string) {
  if (current.fd !== undefined) closeSync(current.fd);
  current.fd = undefined;
  current.day = day;
  current.full = false;
  const fd = openSync(path.join(current.directory, `bell-pr-${day}.log`), "a", 0o600);
  current.fd = fd;
  if (prune(current) > current.maxBytes && fstatSync(fd).size > 0)
    current.full = true;
}

function appendToFile(current: Sink, time: Date, line: string) {
  if (current.broken) return;
  try {
    const day = time.toISOString().slice(0, 10);
    if (current.day !== day || current.fd === undefined) openDay(current, day);
    if (current.full) return;
    const bytes = Buffer.byteLength(line);
    writeSync(current.fd!, line);
    current.unchecked += bytes;
    if (current.unchecked >= pruneEvery && prune(current) > current.maxBytes) {
      current.full = true;
      writeSync(
        current.fd!,
        `${JSON.stringify({ ts: time.toISOString(), level: "warn", msg: "log.budget_reached", maxBytes: current.maxBytes })}\n`,
      );
    }
  } catch (error) {
    current.broken = true;
    if (current.fd !== undefined) {
      try {
        closeSync(current.fd);
      } catch {
        /* Already closed. */
      }
      current.fd = undefined;
    }
    current.stderr.write(
      plainLine(time, "warn", "log.file_unavailable", cleanFields({ error })),
    );
  }
}

function write(level: Level, msg: string, fields?: LogFields) {
  if (levelRank[level] < levelRank[threshold()]) return;
  const current = sink;
  const time = current ? current.now() : new Date();
  const message = redact(String(msg));
  const cleaned = cleanFields(fields);
  if (!current) {
    process.stderr.write(plainLine(time, level, message, cleaned));
    return;
  }
  appendToFile(
    current,
    time,
    `${serialize({ ts: time.toISOString(), level, msg: message, ...cleaned })}\n`,
  );
  if (current.stderr.isTTY)
    current.stderr.write(prettyLine(time, level, message, cleaned));
  else if (levelRank[level] >= levelRank.warn)
    current.stderr.write(plainLine(time, level, message, cleaned));
}

/**
 * Starts writing log files under `<dataDir>/logs`. Calling it again for the
 * same directory keeps the open file; another directory (or new options)
 * switches to it.
 */
export function initLog(dataDir: string, options: LogOptions = {}): void {
  const directory = path.join(path.resolve(dataDir), "logs");
  const configured = Object.keys(options).length > 0;
  if (sink && sink.directory === directory && !configured && !sink.broken)
    return;
  if (sink?.fd !== undefined) {
    try {
      closeSync(sink.fd);
    } catch {
      /* Already closed. */
    }
  }
  sink = undefined;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    process.stderr.write(
      plainLine(new Date(), "warn", "log.file_unavailable", cleanFields({ error })),
    );
    return;
  }
  sink = {
    directory,
    now: options.now ?? (() => new Date()),
    maxFiles: options.maxFiles ?? 7,
    maxBytes: options.maxBytes ?? 50 * 1024 * 1024,
    stderr: options.stderr ?? process.stderr,
    unchecked: 0,
    full: false,
    broken: false,
  };
}

/**
 * The newest `limit` lines of the log files in `<dataDir>/logs`, oldest
 * first, as they were written (already redacted). Reads only the end of
 * each file it needs.
 */
export async function recentLogLines(
  dataDir: string,
  limit = 500,
): Promise<string[]> {
  const directory = path.join(path.resolve(dataDir), "logs");
  let names: string[];
  try {
    names = (await readdir(directory))
      .filter((name) => filePattern.test(name))
      .sort()
      .reverse();
  } catch {
    return [];
  }
  const lines: string[] = [];
  for (const name of names) {
    if (lines.length >= limit) break;
    const wanted = limit - lines.length;
    lines.unshift(...(await tailLines(path.join(directory, name), wanted)));
  }
  return lines.slice(-limit);
}

/** The last `count` complete lines of a file, read backwards in chunks. */
async function tailLines(file: string, count: number): Promise<string[]> {
  const handle = await open(file, "r").catch(() => undefined);
  if (!handle) return [];
  try {
    const { size } = await handle.stat();
    const chunkSize = 64 * 1024;
    let position = size;
    // Bytes, decoded once at the end: a chunk boundary may split a
    // multi-byte character.
    const chunks: Buffer[] = [];
    let newlines = 0;
    while (position > 0) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, position);
      chunks.unshift(buffer);
      for (const byte of buffer) if (byte === 0x0a) newlines++;
      // One extra line: the first may be cut in the middle.
      if (newlines > count) break;
    }
    const lines = Buffer.concat(chunks)
      .toString("utf8")
      .split("\n")
      .filter(Boolean);
    if (position > 0) lines.shift();
    return lines.slice(-count);
  } finally {
    await handle.close();
  }
}

export const log = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
