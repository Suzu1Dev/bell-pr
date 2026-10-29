/**
 * Terminal QR code for `bell-pr pair`: `<pairUrl>#code=XXXX-XXXX`, so a
 * phone opens the /pair page with the code filled in from the hash. Not
 * drawn yet; this stub keeps the call site and `--no-qr` in place.
 */
export function printPairQr(_pairUrlWithCode: string, _out: { write(s: string): void }): void {
  // Intentionally empty until the QR encoder lands.
}
