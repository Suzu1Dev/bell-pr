import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { assertNoHan } from "../test-utils/render";

const script = fileURLToPath(
  new URL("../../scripts/check-i18n.mjs", import.meta.url),
);
let fixture = "";

function write(file: string, text: string) {
  const full = path.join(fixture, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function check(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: fixture,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "bellpr-check-i18n-"));
  write("src/han.ts", 'export const a = "ok";\nexport const b = "中文";\n');
  write(
    "src/joiners.ts",
    'export const list = ["a", "b"].join("、");\nexport const rule = "a；b";\n',
  );
  write(
    "src/clean.tsx",
    'export const text = "BELL PR — “quoted”, it’s… café";\nexport const chip = "Free · Pro";\n',
  );
  write(
    "src/pragma.ts",
    [
      "export const names = {",
      '  zh: "繁體中文", // i18n-allow: autonym',
      "};",
      "// i18n-allow: parser",
      "export const separator = /[，、]/;",
      'export const leak = "漏";',
      "",
    ].join("\n"),
  );
  write(
    "src/unknown.ts",
    [
      'export const t = "標題"; // i18n-allow: legacy',
      'export const u = "ok"; // i18n-allow:',
      'export const v = "名"; // i18n-allow autonym',
      "",
    ].join("\n"),
  );
  // Excluded: dictionaries, the zh-TW demo, shared zh-TW copy, tests and
  // vendored or generated folders.
  for (const file of [
    "src/i18n/zh-TW/common.ts",
    "server/i18n/zh-TW/run.ts",
    "src/demo/zh-TW.ts",
    "shared/i18n/plans.zh-TW.ts",
    "src/a.test.ts",
    "src/b.test.tsx",
    "vendor/lib/x.ts",
    "node_modules/pkg/index.ts",
    "dist/assets/app.ts",
    "build/out.ts",
  ])
    write(file, 'export default "中文";\n');
  write(
    "index.html",
    '<!doctype html>\n<html lang="zh-Hant">\n  <title>標題</title>\n</html>\n',
  );
  write(
    "good/index.html",
    '<!doctype html>\n<html lang="en">\n  <title>BELL PR</title>\n</html>\n',
  );
  write("good/app.ts", 'export const ok = "fine";\n');
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

test("flags Han, CJK punctuation, unknown pragmas and a non-English index.html", () => {
  const { status, stdout, stderr } = check("--paths", "src", "index.html");
  assert.equal(status, 1);
  assert.deepEqual(stdout.trim().split("\n"), [
    'index.html:2: index.html must declare <html lang="en">',
    "index.html:3: <title>標題</title>",
    'src/han.ts:2: export const b = "中文";',
    'src/joiners.ts:1: export const list = ["a", "b"].join("、");',
    'src/joiners.ts:2: export const rule = "a；b";',
    'src/pragma.ts:6: export const leak = "漏";',
    'src/unknown.ts:1: export const t = "標題"; // i18n-allow: legacy',
    'src/unknown.ts:1: unknown i18n-allow reason "legacy"; allowed: autonym, parser',
    "src/unknown.ts:2: i18n-allow needs a reason: autonym or parser",
    'src/unknown.ts:3: export const v = "名"; // i18n-allow autonym',
    'src/unknown.ts:3: malformed pragma; write "i18n-allow: <reason>"',
  ]);
  assert.match(stderr, /7 line\(s\) with Han characters or CJK punctuation, 4 other error\(s\)/);
});

test("skips excluded files even when they are named directly", () => {
  const { status, stdout } = check(
    "--paths",
    ".",
    "src/i18n/zh-TW/common.ts",
    "src/demo/zh-TW.ts",
    "vendor/lib/x.ts",
  );
  assert.equal(status, 1);
  assert.doesNotMatch(
    stdout,
    /zh-TW|\.test\.|vendor|node_modules|dist|build|clean\.tsx|han\.ts:1:/,
  );
});

test("passes a clean folder and an English index.html", () => {
  const { status, stdout } = check("--paths", "good", "src/clean.tsx");
  assert.equal(status, 0);
  assert.match(stdout, /3 file\(s\) checked, nothing to translate/);
});

test("--report prints the count per file and per area and exits 0", () => {
  const { status, stdout } = check("--report", "--paths", ".");
  assert.equal(status, 0);
  const lines = stdout.split("\n");
  assert.ok(lines.includes('  1  index.html (missing <html lang="en">)'));
  assert.ok(lines.includes("  2  src/joiners.ts"));
  assert.ok(lines.includes("  2  src/unknown.ts"));
  assert.ok(lines.includes("  1  src/pragma.ts"));
  assert.ok(lines.includes("  index.html: 1 line(s) in 1 file(s)"));
  assert.ok(lines.includes("  src: 6 line(s) in 4 file(s)"));
  assert.match(stdout, /total: 7 line\(s\) in 5 file\(s\)/);
  assert.match(stdout, /Other errors: 4/);
});

test("rejects bad arguments and missing paths", () => {
  assert.equal(check("--paths").status, 2);
  assert.equal(check("--paths", "missing.ts").status, 2);
  assert.equal(check("--verbose").status, 2);
});

test("assertNoHan and the checker flag the same characters", () => {
  const probes = [
    0x4e2d, // CJK unified ideograph
    0x3400, // extension A
    0x20000, // extension B, outside the BMP
    0xf900, // compatibility ideograph
    0x3005, // iteration mark
    0x3000, // ideographic space
    0x3001, // ideographic comma
    0x3002, // ideographic full stop
    0x300c, // corner bracket
    0xff0c, // full-width comma
    0xff1b, // full-width semicolon
    0xff21, // full-width A
    0xff71, // half-width katakana
    0xffe5, // full-width yen
    0x3042, // hiragana
    0x30fc, // katakana prolonged sound mark
    0x3105, // bopomofo
    0xac00, // hangul
    0x2014, // em dash
    0x2026, // ellipsis
    0x2019, // right single quotation mark
    0xb7, // middle dot, Han by script extension but an English separator
    0xe9, // e with acute
    0x1f600, // emoji
  ];
  write(
    "probe/chars.ts",
    probes
      .map((code) => `export const c${code} = "${String.fromCodePoint(code)}";`)
      .join("\n") + "\n",
  );
  const { stdout } = check("--paths", "probe");
  const flagged = new Set(
    [...stdout.matchAll(/^probe\/chars\.ts:(\d+):/gm)].map(
      (match) => probes[Number(match[1]) - 1],
    ),
  );
  for (const code of probes) {
    let rejected = false;
    try {
      assertNoHan(String.fromCodePoint(code));
    } catch {
      rejected = true;
    }
    assert.equal(rejected, flagged.has(code), `U+${code.toString(16)}`);
  }
  // Han and CJK punctuation are flagged; kana, hangul and Latin are not.
  assert.ok(flagged.has(0x4e2d) && flagged.has(0x20000) && flagged.has(0x3001));
  assert.ok(flagged.has(0xff1b) && flagged.has(0x3000));
  assert.ok(!flagged.has(0x3042) && !flagged.has(0xac00) && !flagged.has(0x2014));
  assert.ok(!flagged.has(0xb7));
});
