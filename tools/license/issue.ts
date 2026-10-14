/**
 * Issues BELL PR license keys, signed with a private key from keygen.ts.
 *
 * One key for a named customer; the key goes to stdout:
 *
 *   npx tsx tools/license/issue.ts --kid <kid> --key <pem> --seats <n>
 *     [--email <e-mail>] [--name <name>]
 *     [--expires <ISO date> | --updates-months <n>] [--ledger <csv>]
 *
 * A pool of keys without an e-mail or name, one key per line in --out, for
 * a merchant that hands out keys from an uploaded list:
 *
 *   npx tsx tools/license/issue.ts --kid <kid> --key <pem> --seats <n>
 *     --pool <count> --out <file> [--expires … | --updates-months …]
 *
 * Without --expires the license is perpetual and covers the builds released
 * within --updates-months (12 by default) of issuing. Every key gets its own
 * `lic_` id and a row in the ledger CSV (default: ledger.csv next to the
 * private key). The ledger and --out must be outside the repository.
 */
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  licensePayloadSchema,
  verifyLicenseKey,
  type LicensePayload,
} from "../../server/license.js";
import { kidPattern, type ToolDeps } from "./keygen.js";
import {
  appendLedger,
  encodeLicenseKey,
  insideRepository,
  isMain,
  newLicenseId,
  type LedgerRow,
} from "./lib.js";

const usage = [
  "Usage: npx tsx tools/license/issue.ts --kid <kid> --key <pem> --seats <n>",
  "         [--email <e-mail>] [--name <name>] [--expires <ISO date> | --updates-months <n>] [--ledger <csv>]",
  "       npx tsx tools/license/issue.ts --kid <kid> --key <pem> --seats <n> --pool <count> --out <file>",
  "         [--expires <ISO date> | --updates-months <n>] [--ledger <csv>]",
  "",
].join("\n");

const options = {
  kid: { type: "string" },
  key: { type: "string" },
  seats: { type: "string" },
  email: { type: "string" },
  name: { type: "string" },
  expires: { type: "string" },
  "updates-months": { type: "string" },
  ledger: { type: "string" },
  pool: { type: "string" },
  out: { type: "string" },
} as const;

class UsageError extends Error {}

function wholeNumber(value: string | undefined, flag: string, min: number, max: number) {
  const number = Number(value);
  if (!value || !/^\d+$/.test(value) || number < min || number > max)
    throw new UsageError(`${flag} must be a whole number from ${min} to ${max}.`);
  return number;
}

/** The day `months` after `from`, as YYYY-MM-DD (UTC); a missing day moves to the month's end. */
export function addMonths(from: Date, months: number) {
  const target = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

async function readPrivateKey(file: string): Promise<KeyObject> {
  let key: KeyObject;
  try {
    key = createPrivateKey(await readFile(file, "utf8"));
  } catch (error) {
    throw new UsageError(
      `Cannot read the private key ${file}: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (key.asymmetricKeyType !== "ed25519")
    throw new UsageError(`${file} is not an Ed25519 private key from keygen.ts.`);
  return key;
}

export async function main(
  argv: string[],
  deps: ToolDeps & { now?: () => number } = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  try {
    let values: Partial<Record<keyof typeof options, string>>;
    try {
      ({ values } = parseArgs({
        args: argv,
        options,
        strict: true,
        allowPositionals: false,
      }));
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error));
    }
    if (!values.kid || !kidPattern.test(values.kid))
      throw new UsageError("--kid is required: the key id keygen.ts was run with.");
    if (!values.key) throw new UsageError("--key is required: the private key PEM file.");
    const seats = wholeNumber(values.seats, "--seats", 1, 1000);
    const pool =
      values.pool === undefined ? undefined : wholeNumber(values.pool, "--pool", 1, 10_000);
    if (pool !== undefined && (values.email !== undefined || values.name !== undefined))
      throw new UsageError("Pool keys carry no e-mail or name; leave out --email and --name.");
    if (pool !== undefined && !values.out)
      throw new UsageError("--pool needs --out <file> for the keys.");
    if (pool === undefined && values.out)
      throw new UsageError("--out is only for --pool.");
    if (values.expires !== undefined && values["updates-months"] !== undefined)
      throw new UsageError("Give either --expires or --updates-months, not both.");
    const email = values.email?.trim();
    if (email !== undefined && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320))
      throw new UsageError(`--email "${email}" is not an e-mail address.`);
    const name = values.name?.trim();
    if (name !== undefined && (!name || name.length > 200))
      throw new UsageError("--name must be 1 to 200 characters.");

    const now = new Date((deps.now ?? Date.now)());
    let exp: string | null = null;
    let upd: string | undefined;
    if (values.expires !== undefined) {
      const expires = Date.parse(values.expires);
      // The formats a key's payload accepts: a date, or a time with its offset.
      const format = licensePayloadSchema.shape.exp.safeParse(values.expires);
      if (!format.success || !Number.isFinite(expires))
        throw new UsageError(
          "--expires must be an ISO date such as 2027-12-31, or a time with its offset such as 2027-12-31T23:59:59Z.",
        );
      if (expires <= now.getTime())
        throw new UsageError("--expires must be in the future.");
      exp = values.expires;
    } else {
      const months =
        values["updates-months"] === undefined
          ? 12
          : wholeNumber(values["updates-months"], "--updates-months", 1, 120);
      upd = addMonths(now, months);
    }

    const keyFile = path.resolve(values.key);
    const ledger = path.resolve(values.ledger ?? path.join(path.dirname(keyFile), "ledger.csv"));
    const out = values.out ? path.resolve(values.out) : undefined;
    for (const file of [ledger, out])
      if (file && insideRepository(file))
        throw new UsageError(
          `Refusing to write license keys inside the repository (${file}). Choose a path outside it.`,
        );
    const privateKey = await readPrivateKey(keyFile);
    // Each key is checked with the public half before it is handed out.
    const x = createPublicKey(privateKey).export({ format: "jwk" }).x!;

    const rows: LedgerRow[] = [];
    const keys: string[] = [];
    for (let index = 0; index < (pool ?? 1); index += 1) {
      const payload: LicensePayload = {
        v: 1,
        kid: values.kid,
        id: newLicenseId(now.getTime()),
        ...(email ? { email } : {}),
        ...(name ? { name } : {}),
        plan: "pro",
        seats,
        iat: now.toISOString(),
        exp,
        ...(upd ? { upd } : {}),
      };
      const key = encodeLicenseKey(payload, privateKey);
      const check = verifyLicenseKey(key, {
        now,
        publicKeys: { [values.kid]: x },
        revoked: [],
        buildDate: now.toISOString().slice(0, 10),
      });
      if (!check.ok) throw new Error(`The new key does not verify: ${check.reason}`);
      keys.push(key);
      rows.push({
        issued_at: payload.iat,
        license_id: payload.id,
        kid: payload.kid,
        seats: String(seats),
        email: email ?? "",
        name: name ?? "",
        expires: exp ?? "",
        updates_until: upd ?? "",
        pool: out ? path.basename(out) : "",
        key,
      });
    }
    if (new Set(rows.map((row) => row.license_id)).size !== rows.length)
      throw new Error("Two keys got the same license id; issue the pool again.");

    if (out) {
      try {
        await writeFile(out, `${keys.join("\n")}\n`, { mode: 0o600, flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new UsageError(`${out} already exists; choose a new file for the pool.`);
        throw error;
      }
    }
    await appendLedger(ledger, rows);
    if (out)
      stdout.write(`Wrote ${keys.length} license keys to ${out}, one per line.\n`);
    else stdout.write(`${keys[0]}\n`);
    stderr.write(`Recorded in the ledger ${ledger}.\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    stderr.write(`${error.message}\n${usage}`);
    return 2;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
