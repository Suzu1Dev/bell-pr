/**
 * What keygen.ts and issue.ts share: where keys live, license ids,
 * signing, and the ledger. Dev-only: tools/ is not part of the npm package
 * or the Docker image, and no secret it handles may enter the repository.
 */
import { randomBytes, sign, type KeyObject } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  licenseKeyPrefix,
  licensePayloadSchema,
  licenseSigningPrefix,
  type LicensePayload,
} from "../../server/license.js";

/** The repository these tools belong to; nothing secret may be written inside it. */
export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Where keygen puts private keys unless told otherwise. */
export function defaultKeyDirectory(home = os.homedir()) {
  return path.join(home, ".config", "bell-pr-licensing");
}

/** The path with symlinks resolved, also when its last parts do not exist yet. */
function realPath(file: string): string {
  const absolute = path.resolve(file);
  const missing: string[] = [];
  let existing = absolute;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...missing);
}

/** True when `file` is inside `root` (by default this repository), symlinks included. */
export function insideRepository(file: string, root = repoRoot): boolean {
  const relative = path.relative(realPath(root), realPath(file));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/** True when this module was started as the script (`npx tsx tools/license/<x>.ts`). */
export function isMain(moduleUrl: string, script = process.argv[1]) {
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID: 48 bits of time, then 80 random bits, in Crockford base32. */
export function ulid(now = Date.now(), random: Uint8Array = randomBytes(10)) {
  let time = "";
  let rest = now;
  for (let i = 0; i < 10; i += 1) {
    time = crockford[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  let bits = BigInt(`0x${Buffer.from(random).toString("hex")}`);
  let tail = "";
  for (let i = 0; i < 16; i += 1) {
    tail = crockford[Number(bits & 31n)] + tail;
    bits >>= 5n;
  }
  return time + tail;
}

/** A new license id: `lic_` and a ULID. */
export function newLicenseId(now = Date.now()) {
  return `lic_${ulid(now)}`;
}

/**
 * Signs a payload into a license key: `BELLPR1.<payload>.<signature>`,
 * with the payload as base64url JSON and an Ed25519 signature over
 * `bellpr-license-v1.<payload>`. The payload must pass the same schema the
 * server checks.
 */
export function encodeLicenseKey(payload: LicensePayload, privateKey: KeyObject) {
  const checked = licensePayloadSchema.parse(payload);
  const payloadText = Buffer.from(JSON.stringify(checked), "utf8").toString(
    "base64url",
  );
  const signature = sign(
    null,
    Buffer.from(licenseSigningPrefix + payloadText, "ascii"),
    privateKey,
  ).toString("base64url");
  return `${licenseKeyPrefix}.${payloadText}.${signature}`;
}

/** The ledger's columns, in order. */
export const ledgerColumns = [
  "issued_at",
  "license_id",
  "kid",
  "seats",
  "email",
  "name",
  "expires",
  "updates_until",
  "pool",
  "key",
] as const;
export type LedgerRow = Record<(typeof ledgerColumns)[number], string>;

/**
 * One CSV field: quoted when it holds a comma, a quote or a line break, and
 * with a leading quote mark when a spreadsheet would read it as a formula.
 */
export function csvField(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Appends rows to the ledger, creating it (mode 0600) with a header first. */
export async function appendLedger(file: string, rows: LedgerRow[]) {
  if (!existsSync(file))
    await writeFile(file, `${ledgerColumns.join(",")}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  const lines = rows.map(
    (row) => `${ledgerColumns.map((column) => csvField(row[column])).join(",")}\n`,
  );
  await appendFile(file, lines.join(""), { mode: 0o600 });
}
