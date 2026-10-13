/**
 * Server logger. This is a stub with the final API; the full implementation
 * replaces the body later, so callers only rely on the signatures.
 *
 * Each call writes one line to stderr:
 * `<ISO timestamp> <LEVEL> <message> <JSON fields>`. Debug lines appear only
 * when BELLPR_LOG_LEVEL=debug. Never pass tokens, keys or other secrets.
 */

type LogFields = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

function serialize(fields: LogFields) {
  try {
    return JSON.stringify(fields, (_key, value: unknown) => {
      if (value instanceof Error)
        return { name: value.name, message: value.message };
      if (typeof value === "bigint") return value.toString();
      return value;
    });
  } catch {
    return JSON.stringify({ logFields: "unserializable" });
  }
}

function write(level: Level, msg: string, fields?: LogFields) {
  if (
    level === "debug" &&
    process.env.BELLPR_LOG_LEVEL?.trim().toLowerCase() !== "debug"
  )
    return;
  // One entry per line: a newline inside the message cannot forge another entry.
  const parts = [
    new Date().toISOString(),
    level.toUpperCase(),
    msg.replace(/\r?\n|\r/g, "\\n"),
  ];
  if (fields && Object.keys(fields).length) parts.push(serialize(fields));
  process.stderr.write(`${parts.join(" ")}\n`);
}

export const log = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
