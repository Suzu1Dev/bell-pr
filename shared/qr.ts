/**
 * A small QR Code encoder: byte mode, error correction level M, versions
 * 1–10 (up to 213 bytes, enough for a pair URL with its code). It follows
 * ISO/IEC 18004 and returns the module matrix; rendering is the caller's job.
 */

/** Data codewords per block, error-correction codewords per block, by version. */
const blocksM: ReadonlyArray<{ ec: number; data: number[] }> = [
  { ec: 10, data: [16] },
  { ec: 16, data: [28] },
  { ec: 26, data: [44] },
  { ec: 18, data: [32, 32] },
  { ec: 24, data: [43, 43] },
  { ec: 16, data: [27, 27, 27, 27] },
  { ec: 18, data: [31, 31, 31, 31] },
  { ec: 22, data: [38, 38, 39, 39] },
  { ec: 22, data: [36, 36, 36, 37, 37] },
  { ec: 26, data: [43, 43, 43, 43, 44] },
];

/** Alignment pattern centres, by version. */
export const alignmentCentres: ReadonlyArray<readonly number[]> = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

export const maxQrVersion = blocksM.length;

/** `modules[y][x]` is true for a dark module. */
export interface QrCode {
  version: number;
  size: number;
  mask: number;
  modules: boolean[][];
}

/** Multiplies in GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1. */
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Reed–Solomon error-correction codewords for one block. */
export function reedSolomon(data: readonly number[], ecLength: number): number[] {
  // Generator polynomial (x - 2^0)(x - 2^1)…, leading coefficient dropped.
  const divisor = new Array<number>(ecLength).fill(0);
  divisor[ecLength - 1] = 1;
  let root = 1;
  for (let i = 0; i < ecLength; i++) {
    for (let j = 0; j < ecLength; j++) {
      divisor[j] = gfMultiply(divisor[j], root);
      if (j + 1 < ecLength) divisor[j] ^= divisor[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  const remainder = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder.shift() as number);
    remainder.push(0);
    for (let i = 0; i < ecLength; i++) remainder[i] ^= gfMultiply(divisor[i], factor);
  }
  return remainder;
}

/** The 15 format bits for level M and a mask, BCH-coded and XOR-masked. */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // 00 = level M
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const masks: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

export const qrMask = (mask: number, x: number, y: number): boolean => masks[mask](x, y);

function dataCapacity(version: number): number {
  return blocksM[version - 1].data.reduce((sum, n) => sum + n, 0);
}

/** Byte-mode segment, terminator and pad codewords. */
function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacityBits = dataCapacity(version) * 8;
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, capacityBits - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  return codewords;
}

/** Splits into blocks, adds error correction and interleaves. */
function interleave(data: number[], version: number): number[] {
  const { ec, data: lengths } = blocksM[version - 1];
  const blocks: number[][] = [];
  let offset = 0;
  for (const length of lengths) {
    blocks.push(data.slice(offset, offset + length));
    offset += length;
  }
  const ecBlocks = blocks.map((block) => reedSolomon(block, ec));
  const result: number[] = [];
  for (let i = 0; i < Math.max(...lengths); i++) {
    for (const block of blocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ec; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

class Matrix {
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly size: number) {
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }
}

function drawFunctionPatterns(matrix: Matrix, version: number): void {
  const { size } = matrix;
  for (let i = 0; i < size; i++) {
    matrix.setFunction(6, i, i % 2 === 0);
    matrix.setFunction(i, 6, i % 2 === 0);
  }
  // Finder patterns with their light separators.
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) {
          matrix.setFunction(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
  }
  const centres = alignmentCentres[version - 1];
  const last = centres.length - 1;
  centres.forEach((cy, i) =>
    centres.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          matrix.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }),
  );
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      matrix.setFunction(a, b, dark);
      matrix.setFunction(b, a, dark);
    }
  }
  drawFormat(matrix, 0); // reserves the format area; redrawn once the mask is chosen
}

function drawFormat(matrix: Matrix, mask: number): void {
  const { size } = matrix;
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  // Copy around the top-left finder.
  for (let i = 0; i <= 5; i++) matrix.setFunction(8, i, bit(i));
  matrix.setFunction(8, 7, bit(6));
  matrix.setFunction(8, 8, bit(7));
  matrix.setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i++) matrix.setFunction(14 - i, 8, bit(i));
  // Copy split between the other two finders.
  for (let i = 0; i < 8; i++) matrix.setFunction(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) matrix.setFunction(8, size - 15 + i, bit(i));
  matrix.setFunction(8, size - 8, true); // the dark module
}

/** Places codeword bits in the two-column zigzag, bottom-right first. */
function drawCodewords(matrix: Matrix, codewords: number[]): void {
  const { size } = matrix;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (matrix.isFunction[y][x]) continue;
        // Remainder bits after the last codeword stay light.
        matrix.modules[y][x] = i < codewords.length * 8 && ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

function applyMask(matrix: Matrix, mask: number): void {
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.isFunction[y][x] && qrMask(mask, x, y)) matrix.modules[y][x] = !matrix.modules[y][x];
    }
  }
}

/** The standard mask penalty (rules N1–N4); lower scans more reliably. */
function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;
  const finderLike = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true],
  ];
  for (const transpose of [false, true]) {
    const at = (a: number, b: number) => (transpose ? modules[b][a] : modules[a][b]);
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && at(a, b) === at(a, b - 1)) {
          run++;
          continue;
        }
        if (run >= 5) score += run - 2;
        run = 1;
      }
      for (let b = 0; b + 11 <= size; b++) {
        for (const pattern of finderLike) {
          if (pattern.every((dark, k) => at(a, b + k) === dark)) score += 40;
        }
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++;
      if (
        x + 1 < size &&
        y + 1 < size &&
        modules[y][x] === modules[y][x + 1] &&
        modules[y][x] === modules[y + 1][x] &&
        modules[y][x] === modules[y + 1][x + 1]
      ) {
        score += 3;
      }
    }
  }
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/** Encodes text as UTF-8 bytes. Throws a RangeError when it exceeds version 10. */
export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  // 4 mode bits + count bits + 8 per byte must fit the data capacity.
  while (version <= maxQrVersion && 4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCapacity(version) * 8) {
    version++;
  }
  if (version > maxQrVersion) throw new RangeError(`QR payload too long: ${bytes.length} bytes`);

  const size = version * 4 + 17;
  const codewords = interleave(dataCodewords(bytes, version), version);
  let best: QrCode | undefined;
  let bestScore = Infinity;
  for (let mask = 0; mask < masks.length; mask++) {
    const matrix = new Matrix(size);
    drawFunctionPatterns(matrix, version);
    drawCodewords(matrix, codewords);
    applyMask(matrix, mask);
    drawFormat(matrix, mask);
    const score = penalty(matrix.modules);
    if (score < bestScore) {
      bestScore = score;
      best = { version, size, mask, modules: matrix.modules };
    }
  }
  return best as QrCode;
}
