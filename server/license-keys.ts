/**
 * The keys that check BELL PR license keys offline.
 *
 * `licensePublicKeys` maps a key id (the `kid` in a license payload) to the
 * public half of an Ed25519 signing key: the base64url `x` value of its JWK,
 * which `tools/license/keygen.ts` prints. Only public keys belong here; the
 * private key stays with the owner, outside the repository. While the map is
 * empty, no license key unlocks Pro (the trial still works). Keep an old key
 * id here as long as keys signed with it should keep working.
 *
 * `revokedLicenseIds` lists license ids (`lic_…`) that no longer unlock Pro,
 * for example after a refund. A revocation reaches only the builds released
 * after it, since every build carries its own copy of this list.
 *
 * Never add a development or test key: tests generate a throwaway key pair.
 */
export const licensePublicKeys: Readonly<Record<string, string>> = {};

export const revokedLicenseIds: ReadonlySet<string> = new Set<string>();
