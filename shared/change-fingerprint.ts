/**
 * The fingerprint of a whole change, in a module of its own with no
 * imports, so modules that must stay plain (shared/by-hand.ts, which the
 * learning export loads) can use it. shared/understanding.ts re-exports it.
 */
const fnvOffset = 0xcbf29ce484222325n;
const fnvPrime = 0x100000001b3n;
const mask64 = 0xffffffffffffffffn;

/**
 * The fingerprint of the whole change: FNV-1a 64-bit, as 16 hex digits, of
 * the sorted `path:fingerprint` lines. Synchronous so the client, the demo
 * and the server compute it alike; it identifies a version of the change
 * and is not security-relevant.
 */
export function changeFingerprint(
  files: readonly { path: string; fingerprint: string }[],
) {
  const text = files
    .map((file) => `${file.path}:${file.fingerprint}`)
    .sort()
    .join("\n");
  let hash = fnvOffset;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * fnvPrime) & mask64;
  }
  return hash.toString(16).padStart(16, "0");
}
