import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { printPairQr, renderPairQr, shouldPrintQr } from "./pair-qr.js";

const url = "https://box.example.test:4310/pair#code=ABCD-EFGH";

function capture(isTTY?: boolean) {
  const writes: string[] = [];
  const out = { isTTY, write: (s: string) => void writes.push(s) };
  return { writes, out };
}

test("the pair QR fits an 80-column terminal inside a light quiet zone", () => {
  const lines = renderPairQr(url).trimEnd().split("\n");
  for (const line of lines) {
    assert.ok([...line].length <= 80, `${[...line].length} columns`);
    assert.match(line, /^[█▀▄ ]+$/u);
  }
  for (const line of lines.slice(0, -1)) {
    assert.ok(line.startsWith("████") && line.endsWith("████"), "4-module side margins");
  }
  // 4 light rows on top and bottom are 2 full block lines each side.
  assert.match(lines[0], /^█+$/u);
  assert.match(lines[1], /^█+$/u);
  assert.match(lines.at(-2) ?? "", /^█+$/u);
  // The last half-row is past the symbol: only its upper half is drawn.
  assert.match(lines.at(-1) ?? "", /^▀+$/u);
  // A ~100-character pair URL still fits.
  const long = `https://${"sub.".repeat(15)}example.com/pair#code=MNPQ-RSTV`;
  assert.ok(
    renderPairQr(long)
      .split("\n")
      .every((line) => [...line].length <= 80),
  );
});

test("shouldPrintQr needs a terminal and no --no-qr", () => {
  assert.equal(shouldPrintQr({ stdoutIsTTY: true }), true);
  assert.equal(shouldPrintQr({ stdoutIsTTY: true, noQr: true }), false);
  assert.equal(shouldPrintQr({ stdoutIsTTY: false }), false);
  assert.equal(shouldPrintQr({ stdoutIsTTY: false, noQr: false }), false);
});

test("printPairQr writes the QR and the URL line to a terminal, and never logs", (t) => {
  const logged: unknown[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    t.mock.method(console, method, (...args: unknown[]) => void logged.push(args));
  }
  t.mock.method(process.stderr, "write", (chunk: unknown) => void logged.push(chunk));

  const tty = capture(true);
  printPairQr(url, tty.out);
  assert.deepEqual(tty.writes, [renderPairQr(url), `${url}\n`]);

  // Too long to encode: the URL line alone, nothing thrown.
  const longUrl = `${url}${"x".repeat(300)}`;
  const tooLong = capture(true);
  printPairQr(longUrl, tooLong.out);
  assert.deepEqual(tooLong.writes, [`${longUrl}\n`]);

  assert.deepEqual(logged, []);
  // Half blocks only: no ANSI escapes, so NO_COLOR terminals see the same.
  for (const write of tty.writes) assert.ok(!write.includes("\x1b"));
});

test("printPairQr writes only the URL line when out is not a terminal", () => {
  for (const isTTY of [false, undefined]) {
    const plain = capture(isTTY);
    printPairQr(url, plain.out);
    assert.deepEqual(plain.writes, [`${url}\n`]);
    assert.doesNotMatch(plain.writes.join(""), /[█▀▄]/u);
  }
});

test("piped process.stdout gets the URL line and no QR", (t) => {
  const saved = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true, writable: true });
  t.after(() => {
    if (saved) Object.defineProperty(process.stdout, "isTTY", saved);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });
  const write = t.mock.method(process.stdout, "write", () => true);
  printPairQr(url, process.stdout);
  assert.deepEqual(
    write.mock.calls.map((call) => call.arguments[0]),
    [`${url}\n`],
  );
});

test("the pair code travels in the fragment, never in a query string", () => {
  const sources = ["./pair-qr.ts", "./pair-qr.test.ts", "../shared/qr.ts", "../shared/qr.test.ts"].map((path) =>
    readFileSync(new URL(path, import.meta.url), "utf8"),
  );
  const query = ["?", "code="].join("");
  for (const source of sources) assert.ok(!source.includes(query));
  assert.equal(new URL(url).search, "");
  assert.equal(new URL(url).hash, "#code=ABCD-EFGH");
});

test("the pair QR module imports nothing that could log", () => {
  const source = readFileSync(new URL("./pair-qr.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import .* from "(.+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["../shared/qr.js"]);
  assert.doesNotMatch(source, /console\.|logger|log\(/);
  const encoder = readFileSync(new URL("../shared/qr.ts", import.meta.url), "utf8");
  assert.doesNotMatch(encoder, /^import /m);
  assert.doesNotMatch(encoder, /console\./);
});
