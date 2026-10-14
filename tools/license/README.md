# License key tools

Developer tools for issuing BELL PR Pro license keys. They are not part of
the npm package or the Docker image (`package.json` `files`,
`.dockerignore`), and `scripts/check-pack.mjs` fails if `tools/` ever ends up
in the package.

**No secret lives in this repository.** The private signing key, the ledger
and key pools are always written outside it; the tools refuse paths inside
the repository, and `.gitignore` ignores `*.pem` and `*.key` as a second
guard. The repository only holds public keys, in `server/license-keys.ts`.

## How a key works

A license key is `BELLPR1.<payload>.<signature>`:

- the payload is base64url JSON:
  `{v: 1, kid, id: "lic_<ULID>", email?, name?, plan: "pro", seats, iat, exp, upd?}`;
- the signature is Ed25519 over the ASCII text
  `bellpr-license-v1.<payload>`, made with the private key named by `kid`.

BELL PR checks keys offline against `licensePublicKeys` in
`server/license-keys.ts`, so no license server is needed. `exp` is the end
of a time-limited license (`null` for a perpetual one), with 7 days of grace
after it. `upd` is the last release day the license covers: a build released
after it does not accept the key, and builds released before keep working
forever. `email` and `name` are optional, so keys from a pool carry neither.

## Workflow

### 1. Create the signing key (once per key id)

```sh
npx tsx tools/license/keygen.ts --kid bellpr-2026
```

This writes the private key to `~/.config/bell-pr-licensing/bellpr-2026.pem`
(mode 0600; `--dir <dir>` chooses another folder outside the repository) and
prints the public key. It never replaces an existing file. Add the printed
line to `licensePublicKeys` in `server/license-keys.ts` and release a build
with it; only builds that contain the public key accept keys signed with it.

### 2. Issue a key for a customer

```sh
npx tsx tools/license/issue.ts --kid bellpr-2026 \
  --key ~/.config/bell-pr-licensing/bellpr-2026.pem \
  --seats 1 --email customer@example.com --name "Customer Name"
```

The key is printed on stdout. By default it is perpetual and covers the
builds released within 12 months (`--updates-months <n>` changes that);
`--expires 2027-12-31` issues a time-limited license instead.

### 3. Or issue a pool for a merchant

Some merchants hand out keys from an uploaded list. Issue a pool of keys
without an e-mail or name, each with its own license id:

```sh
npx tsx tools/license/issue.ts --kid bellpr-2026 \
  --key ~/.config/bell-pr-licensing/bellpr-2026.pem \
  --seats 1 --pool 100 --out ~/bell-pr-pool-2026-10.csv
```

`--out` gets one key per line and no header; it must not exist yet. Upload
it to the merchant, then delete the local copy: the ledger keeps every key.

### The ledger

Every issued key is appended to a CSV ledger, by default `ledger.csv` next
to the private key (`--ledger <file>` chooses another file). Its columns are
`issued_at, license_id, kid, seats, email, name, expires, updates_until,
pool, key`. Use it to resend a lost key and to find the license id to
revoke. It contains every key, so keep it as private as the signing key.

Customers activate a key in Settings → License, with
`bell-pr license activate <key>` (or `-` to read it from standard input), or
with the `BELLPR_LICENSE_KEY` environment variable.

## Backups

Keep at least two offline copies of each private key and of the ledger, for
example on two encrypted USB drives. Losing a private key means no new keys
for that key id: create a new key id and ship its public key. Anyone who
gets a private key can issue keys; if that happens, stop using that key id,
create a new one, and reissue keys to the customers in the ledger.

## Revocation

To revoke a key (after a refund, for example), add its license id to
`revokedLicenseIds` in `server/license-keys.ts`. **A revocation takes
effect in builds released after the revocation**: every build carries its
own list, checked offline, and builds that were already released keep
accepting the key. To retire a whole signing key, remove its entry from
`licensePublicKeys`; builds released after that reject every key signed
with it.
