// The encoder is checked against published vectors and against a small
// byte-mode decoder written here from the standard, separately from the
// encoder: it finds the function patterns, unmasks, reads the zigzag,
// de-interleaves, checks every Reed–Solomon syndrome and parses the segment.
import assert from "node:assert/strict";
import test from "node:test";
import { encodeQr, formatBits, reedSolomon, versionBits, type QrCode } from "./qr.js";

// GF(256) tables over x^8 + x^4 + x^3 + x^2 + 1, for the syndromes.
const exp: number[] = [];
const log: number[] = [];
for (let i = 0, value = 1; i < 255; i++) {
  exp[i] = value;
  log[value] = i;
  value = value & 0x80 ? ((value << 1) ^ 0x11d) & 0xff : value << 1;
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : exp[(log[a] + log[b]) % 255]);

// ISO/IEC 18004 table 9, level M: [error-correction per block, data per block…].
const levelM: number[][] = [
  [10, 16],
  [16, 28],
  [26, 44],
  [18, 32, 32],
  [24, 43, 43],
  [16, 27, 27, 27, 27],
  [18, 31, 31, 31, 31],
  [22, 38, 38, 39, 39],
  [22, 36, 36, 36, 37, 37],
  [26, 43, 43, 43, 43, 44],
];
const alignment: number[][] = [
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
// Mask conditions with i = row, j = column, as the standard writes them.
const maskConditions: Array<(i: number, j: number) => boolean> = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

function reserved(version: number): boolean[][] {
  const size = version * 4 + 17;
  const mark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fill = (row: number, col: number, rows: number, cols: number) => {
    for (let r = row; r < row + rows; r++) for (let c = col; c < col + cols; c++) mark[r][c] = true;
  };
  fill(0, 0, 9, 9); // finder, separator, format
  fill(0, size - 8, 9, 8);
  fill(size - 8, 0, 8, 9); // includes the dark module
  fill(6, 0, 1, size); // timing
  fill(0, 6, size, 1);
  const centres = alignment[version - 1];
  const nearFinder = (n: number) => n === 6 || n === size - 7;
  for (const r of centres) {
    for (const c of centres) if (!(r === 6 && nearFinder(c)) && !(c === 6 && nearFinder(r))) fill(r - 2, c - 2, 5, 5);
  }
  if (version >= 7) {
    fill(0, size - 11, 6, 3);
    fill(size - 11, 0, 3, 6);
  }
  return mark;
}

/** Decodes a level-M byte-mode symbol; returns the text, or throws. */
function decode(qr: QrCode): { text: string; mask: number; remainderBits: number } {
  const m = qr.modules;
  const size = m.length;
  const version = (size - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1 && version <= 10);

  // Format: read MSB first around the top-left finder, then the second copy.
  const first = [...[0, 1, 2, 3, 4, 5, 7, 8].map((c) => m[8][c]), m[7][8], ...[5, 4, 3, 2, 1, 0].map((r) => m[r][8])];
  const second = [
    ...[1, 2, 3, 4, 5, 6, 7].map((k) => m[size - k][8]),
    ...[8, 7, 6, 5, 4, 3, 2, 1].map((k) => m[8][size - k]),
  ];
  const value = (bits: boolean[]) => bits.reduce((n, bit) => (n << 1) | (bit ? 1 : 0), 0);
  const format = value(first) ^ 0b101010000010010;
  assert.equal(value(second), value(first), "format copies differ");
  assert.equal(format >>> 13, 0b00, "level M");
  const mask = (format >>> 10) & 7;
  assert.equal(m[size - 8][8], true, "dark module");

  const fixed = reserved(version);
  const bits: number[] = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const row = upward ? size - 1 - k : k;
      for (const c of [col, col - 1]) {
        if (!fixed[row][c]) bits.push(m[row][c] !== maskConditions[mask](row, c) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const [ec, ...dataLengths] = levelM[version - 1];
  const total = dataLengths.reduce((a, b) => a + b, 0) + ec * dataLengths.length;
  const remainderBits = bits.length - total * 8;
  const codewords: number[] = [];
  for (let i = 0; i < total; i++) codewords.push(value(bits.slice(i * 8, i * 8 + 8).map((b) => b === 1)));

  // De-interleave and check each block's syndromes are all zero.
  const blocks = dataLengths.map(() => [] as number[]);
  let next = 0;
  for (let i = 0; i < Math.max(...dataLengths); i++) {
    dataLengths.forEach((length, b) => {
      if (i < length) blocks[b].push(codewords[next++]);
    });
  }
  const data = blocks.flat();
  for (let i = 0; i < ec; i++) blocks.forEach((block) => block.push(codewords[next++]));
  for (const block of blocks) {
    for (let s = 0; s < ec; s++) {
      const syndrome = block.reduce((acc, c) => mul(acc, exp[s]) ^ c, 0);
      assert.equal(syndrome, 0, "Reed–Solomon syndrome");
    }
  }

  const stream = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (byte >>> i) & 1));
  let pos = 0;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | stream[pos++];
    return v;
  };
  assert.equal(read(4), 0b0100, "byte mode");
  const length = read(version < 10 ? 8 : 16);
  const bytes = Uint8Array.from({ length }, () => read(8));
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), mask, remainderBits };
}

test("Reed–Solomon matches the published HELLO WORLD 1-M codewords", () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(reedSolomon(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test("format and version bits match the published tables", () => {
  assert.equal(formatBits(0), 0b101010000010010);
  assert.equal(formatBits(7), 0b100101010100000);
  assert.equal(versionBits(7), 0x07c94);
  assert.equal(versionBits(10), 0x0a4d3);
});

test("pair URLs carry the code in the fragment and round-trip through an independent decoder", () => {
  const urls = [
    "https://h.example/pair#code=ABCD-EFGH",
    "https://box.example.test:4310/pair#code=ABCD-EFGH",
    "http://192.168.100.200:4310/pair#code=0123-4567",
    "https://a-rather-long-machine-name.example.test:4310/pair#code=WXYZ-2345",
    `https://${"sub.".repeat(15)}example.com/pair#code=MNPQ-RSTV`, // ~100 characters
    `https://${"sub.".repeat(20)}example.com:4310/pair#code=MNPQ-RSTV`, // ~120 characters
    "https://例子.example/pair#code=ABCD-EFGH",
  ];
  for (const url of urls) {
    const qr = encodeQr(url);
    const { text, mask, remainderBits } = decode(qr);
    assert.equal(text, url);
    assert.match(text, /\/pair#code=[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.equal(new URL(text).search, "", "no query string");
    assert.equal(mask, qr.mask);
    assert.equal(remainderBits, qr.version >= 2 && qr.version <= 6 ? 7 : 0, `remainder bits v${qr.version}`);
  }
  assert.ok(encodeQr(urls[4]).version >= 6);
});

test("every version 1–10 decodes, and longer input is refused", () => {
  const capacity = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  capacity.forEach((bytes, i) => {
    const text = "x".repeat(bytes);
    const qr = encodeQr(text);
    assert.equal(qr.version, i + 1);
    assert.equal(qr.size, (i + 1) * 4 + 17);
    assert.equal(decode(qr).text, text);
    if (i < 9) assert.equal(encodeQr(text + "x").version, i + 2);
  });
  assert.throws(() => encodeQr("x".repeat(214)), RangeError);
});

// Matrices produced by a separate QR encoder (the one vendored in
// qrcode-terminal) with the same mask, for versions 3, 4, 5 and 8 (the last
// has version bits), one hex string per row, most significant bit leftmost.
const knownGood: Record<string, string[]> = {
  "https://h.example/pair#code=ABCD-EFGH": [
    "1fdab67f",
    "105f5141",
    "1745a45d",
    "1757295d",
    "1748da5d",
    "104a5b41",
    "1fd5557f",
    "001cfd00",
    "16e2dc4b",
    "04103ff1",
    "00e85426",
    "0e31c6d1",
    "18f5282c",
    "0d3b9a47",
    "1b7746a7",
    "0d86b432",
    "17f524ba",
    "0d24b1ae",
    "11d42184",
    "07111e14",
    "0cea99fc",
    "0011f91f",
    "1fd79f5a",
    "1057371b",
    "174861f4",
    "17535bb9",
    "17589005",
    "1044c15a",
    "1fd94f32",
  ],
  "https://box.example.test:4310/pair#code=ABCD-EFGH": [
    "1fdee4e7f",
    "104ec7441",
    "17457db5d",
    "175638a5d",
    "175212b5d",
    "105921141",
    "1fd55557f",
    "00174ff00",
    "117938df9",
    "17992828c",
    "167be4a8a",
    "1b29b3982",
    "0ffd907da",
    "1d11c7024",
    "106ee1ffe",
    "079f7c8d8",
    "10d49bd52",
    "1239a138e",
    "017f292ea",
    "02bb5dea2",
    "14fd0775b",
    "1625128e6",
    "055f5ea06",
    "079f8b842",
    "1ed53ddf3",
    "001528716",
    "1fd27415a",
    "104961910",
    "1757915fb",
    "17484f274",
    "174360d74",
    "1041b8e00",
    "1fdc9df41",
  ],
  "https://a-rather-long-machine-name.example.test:4310/pair#code=WXYZ-2345": [
    "1fca20b17f",
    "1040111b41",
    "175420f05d",
    "175d9c7b5d",
    "17553f215d",
    "105589cb41",
    "1fd555557f",
    "0016ddd700",
    "17c5920e7c",
    "079cad4882",
    "0eff7a8663",
    "0534e794c1",
    "17cb2a7e57",
    "0890d7a920",
    "1fc7650e7b",
    "1082708671",
    "0ec8452d77",
    "002530490a",
    "16ee4197b7",
    "0c1b50d2c1",
    "16c6887cd4",
    "04129ba18a",
    "097c6806bb",
    "1b376fc3b0",
    "05f8b22ef6",
    "109bed4980",
    "12daf64f4b",
    "15a3a7a629",
    "117aba5ff4",
    "0013d7b118",
    "1fcd75c555",
    "105971a51b",
    "175f860bf7",
    "175b30ccdd",
    "175705ce0f",
    "104991c359",
    "1fd1083c57",
  ],
  [`https://${"sub.".repeat(20)}example.com:4310/pair#code=MNPQ-RSTV`]: [
    "1fd2ed006b17f",
    "10574fdc1af41",
    "174649e6b9b5d",
    "175b4216efa5d",
    "174a1d7e2885d",
    "104e50c568c41",
    "1fd555555557f",
    "001a6dc749a00",
    "16e2ff7f6ed4b",
    "022442f9d2ae8",
    "07ce39a85692e",
    "0525acd0d935d",
    "08ceac7aa1925",
    "1e2c4acd2bead",
    "00c1a30d68e6e",
    "1903cf6285e91",
    "0ccad007e51d3",
    "0d2a6078f95bc",
    "1beedf557a38b",
    "100c56bb83428",
    "0dce538d4aeab",
    "17337e8d510f6",
    "01fa9bfcef3f4",
    "0d12444637b1d",
    "1b53afd4aff56",
    "1916f74533d1b",
    "03fd87fec37fe",
    "1f1bbf93b8303",
    "0350f3a630084",
    "10a246773e869",
    "005cea08bf7ef",
    "031f251ab071a",
    "07e15759ac1df",
    "051edaf46b1a2",
    "1fdace241ae82",
    "061eae0eff65e",
    "07f57bee03757",
    "0b307f4838d73",
    "08dbd593c2488",
    "0e344c2ff49a0",
    "1c4194fc36dfe",
    "0011dec49d317",
    "1fd909d60555f",
    "10539147cdb11",
    "174adeff66ff0",
    "175fa7415287a",
    "17529c0c562f0",
    "104a1da9e862c",
    "1fd30d393e603",
  ],
};

test("pair URLs match matrices from a separate encoder", () => {
  for (const [url, rows] of Object.entries(knownGood)) {
    const { size, modules } = encodeQr(url);
    const actual = modules.map((row) =>
      BigInt("0b" + row.map((dark) => (dark ? "1" : "0")).join(""))
        .toString(16)
        .padStart(Math.ceil(size / 4), "0"),
    );
    assert.deepEqual(actual, rows, url);
  }
});
