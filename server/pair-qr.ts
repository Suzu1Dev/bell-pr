/**
 * Prints the device pair URL (with its code) as a QR code in the terminal so
 * a phone can scan it. The QR goes only to the given terminal stream: this
 * module never logs, because the URL carries a live pairing code.
 */
import { encodeQr } from "../shared/qr.js";

const quietZone = 4;

/**
 * Two modules per character row with Unicode half blocks. Light modules
 * are drawn as blocks, so on the usual light-on-dark terminal the code reads
 * as dark modules on a light background with a light quiet zone.
 */
export function renderPairQr(url: string): string {
  const { size, modules } = encodeQr(url);
  const span = size + quietZone * 2;
  const light = (x: number, y: number) => {
    const mx = x - quietZone;
    const my = y - quietZone;
    return mx < 0 || my < 0 || mx >= size || my >= size || !modules[my][mx];
  };
  const lines: string[] = [];
  for (let y = 0; y < span; y += 2) {
    let line = "";
    for (let x = 0; x < span; x++) {
      const top = light(x, y);
      const bottom = y + 1 < span && light(x, y + 1);
      line += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n") + "\n";
}

export function shouldPrintQr(opts: { stdoutIsTTY: boolean; noQr?: boolean }): boolean {
  return opts.stdoutIsTTY && !opts.noQr;
}

/**
 * Writes the QR for `<pairUrl>#code=XXXX-XXXX` to `out`, then the same URL as
 * a plain text line. The code rides in the fragment so it never reaches a
 * server log or a Referer. `--no-qr` is the caller's to honour. Only a stream
 * that says it is a terminal gets the QR; anything else (a pipe, a file,
 * `process.stdout` when redirected) gets the URL line alone. No ANSI colour is
 * ever written, so NO_COLOR needs nothing more. A URL too long to encode
 * also gets the URL line alone.
 */
export function printPairQr(pairUrlWithCode: string, out: { write(text: string): unknown; isTTY?: boolean }): void {
  const stdoutIsTTY = (out as { isTTY?: boolean }).isTTY === true;
  if (shouldPrintQr({ stdoutIsTTY })) {
    try {
      out.write(renderPairQr(pairUrlWithCode));
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  out.write(`${pairUrlWithCode}\n`);
}
