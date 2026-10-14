/**
 * Creates an Ed25519 key pair for signing BELL PR license keys.
 *
 *   npx tsx tools/license/keygen.ts --kid <kid> [--dir <dir>]
 *
 * The private key is written as a PKCS8 PEM file, mode 0600, to
 * `<dir>/<kid>.pem` (default dir: ~/.config/bell-pr-licensing). It is never
 * written inside the repository and never over an existing file. The public
 * key (the JWK `x` value) is printed with the line to add to
 * `licensePublicKeys` in server/license-keys.ts. README.md explains the
 * whole workflow.
 */
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultKeyDirectory, insideRepository, isMain } from "./lib.js";

const usage =
  "Usage: npx tsx tools/license/keygen.ts --kid <kid> [--dir <dir>]\n";

export interface ToolDeps {
  stdout?: { write(text: string): unknown };
  stderr?: { write(text: string): unknown };
  /** The home directory for the default key folder; os.homedir() by default. */
  home?: string;
}

/** A key id: lowercase letters, digits and dashes, also used as the file name. */
export const kidPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;

export async function main(argv: string[], deps: ToolDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let values: { kid?: string; dir?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { kid: { type: "string" }, dir: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : error}\n${usage}`);
    return 2;
  }
  if (!values.kid || !kidPattern.test(values.kid)) {
    stderr.write(
      `--kid is required: 1-32 lowercase letters, digits or dashes, such as bellpr-2026.\n${usage}`,
    );
    return 2;
  }
  const directory = path.resolve(values.dir ?? defaultKeyDirectory(deps.home));
  const file = path.join(directory, `${values.kid}.pem`);
  if (insideRepository(file)) {
    stderr.write(
      `Refusing to write a private key inside the repository (${file}). Choose a folder outside it with --dir.\n`,
    );
    return 1;
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const x = publicKey.export({ format: "jwk" }).x!;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(file, pem, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    stderr.write(
      `${file} already exists; keygen never replaces a key. Choose another --kid.\n`,
    );
    return 1;
  }
  // writeFile applies the umask; the key must be readable by its owner only.
  await chmod(file, 0o600);
  stdout.write(
    [
      `Private key: ${file} (mode 0600). Back it up offline; anyone who has it can issue license keys.`,
      `Public key (x): ${x}`,
      "Add this entry to licensePublicKeys in server/license-keys.ts:",
      `  ${JSON.stringify(values.kid)}: ${JSON.stringify(x)},`,
      "",
    ].join("\n"),
  );
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
