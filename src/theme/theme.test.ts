import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = path.join(root, "scripts/tokenize-css.mjs");
// The script is plain JavaScript; a computed specifier keeps tsc from
// looking for type declarations.
const tokenizer = await import(pathToFileURL(scriptPath).href);
const tokens = tokenizer.loadTokens();

const lab = (L: number, a: number, b: number) => ({ L, a, b });

test("deltaE2000 matches the published CIEDE2000 test data", () => {
  // Sharma, Wu and Dalal (2005), pairs 1-3, 7 and 17-19.
  const pairs: [number[], number[], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
  ];
  for (const [first, second, expected] of pairs) {
    const distance = tokenizer.deltaE2000(
      lab(first[0], first[1], first[2]),
      lab(second[0], second[1], second[2]),
    );
    assert.ok(Math.abs(distance - expected) < 1e-4, `${first} / ${second}: ${distance}`);
  }
});

test("color parsing and WCAG contrast", () => {
  assert.deepEqual(tokenizer.parseHex("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(tokenizer.parseHex("#00000080").a, 128 / 255);
  assert.equal(tokenizer.parseHex("#12345"), undefined);
  assert.deepEqual(tokenizer.parseRgbFunction("rgb(244 247 241 / 42%)"), {
    r: 244,
    g: 247,
    b: 241,
    a: 0.42,
  });
  const white = tokenizer.parseHex("#ffffff");
  assert.equal(tokenizer.contrastRatio(white, tokenizer.parseHex("#000")), 21);
  assert.equal(
    tokenizer.contrastRatio(white, tokenizer.parseHex("#777")).toFixed(2),
    "4.48",
  );
});

test("tokenizeCss maps literals to the tokens meant for each property", () => {
  const small = 9;
  const css = [
    ":root {",
    "  --ink: #24342b;",
    '  --mono: "IBM Plex Mono", monospace;',
    "}",
    ".label {",
    "  color: #899088;",
    "  background: #fafbf9;",
    "  border: 1px solid #e5e8e3;",
    `  font: 600 ${small}px/1.4 var(--mono, monospace);`,
    "  box-shadow: 0 1px 3px #24391215;",
    "}",
    ".title {",
    "  color: var(--ink);",
    "  font-size: 12px;",
    '  font-family: "DM Sans", "Noto Sans TC", sans-serif;',
    "}",
    ".chip { color: #f5faf0; background: white; }",
    ".odd { border-color: #ff00ff; }",
    "",
  ].join("\n");
  const legacy = tokenizer.findLegacyProperties([{ css }], tokens);
  const { output, unmapped } = tokenizer.tokenizeCss(css, tokens, legacy);
  assert.equal(
    output,
    [
      ":root {",
      "}",
      ".label {",
      "  color: var(--color-text-muted);",
      "  background: var(--color-bg);",
      "  border: 1px solid var(--color-border);",
      "  font: 600 var(--text-2xs)/1.4 var(--font-mono);",
      "  box-shadow: var(--shadow-1);",
      "}",
      ".title {",
      "  color: var(--color-text);",
      "  font-size: var(--text-xs);",
      "  font-family: var(--font-sans);",
      "}",
      ".chip { color: var(--color-text-inverse); background: var(--color-surface); }",
      ".odd { border-color: #ff00ff; }",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    unmapped.map((item: { literal: string }) => item.literal),
    ["#ff00ff"],
  );
  // A second run has nothing left to do.
  assert.equal(tokenizer.tokenizeCss(output, tokens).output, output);
});

test("text colors map to text tokens, which meet 4.5:1, even when far", () => {
  const css = ".faint { color: #c2cbb6; }";
  const { output } = tokenizer.tokenizeCss(css, tokens);
  assert.equal(output, ".faint { color: var(--color-text-muted); }");
});

test("checkCss reports what must not come back", () => {
  const small = 10;
  const cdn = ["https://fonts", "googleapis", "com/css2?family=X"].join(".");
  const problems = tokenizer.checkCss(
    [
      `@import url("${cdn}");`,
      `.a { color: #123456; font-size: ${small}px; }`,
      `.b { font: 500 ${small}px/1.4 "IBM Plex Mono", monospace; }`,
      ".c { background: rgb(0 0 0 / 50%); border-color: white; }",
      ".d { color: var(--color-text); font: 500 var(--text-xs)/1.6 var(--font-mono); }",
    ].join("\n"),
  );
  assert.deepEqual(
    problems.map((item: { line: number; problem: string }) => `${item.line} ${item.problem.split(" (")[0]}`),
    [
      "1 loads a webfont from a CDN",
      "2 color literal #123456",
      `2 font size ${small}px is below 11px`,
      `3 font size ${small}px is below 11px`,
      "3 hard-coded font stack",
      "4 color literal rgb(0 0 0 / 50%)",
      "4 color literal white",
    ],
  );
});

test("every stylesheet outside src/theme uses the tokens", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--check"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("tokens.css defines the documented tokens", () => {
  const colors = [
    "bg",
    "surface",
    "surface-sunken",
    "border",
    "border-strong",
    "text",
    "text-secondary",
    "text-muted",
    "brand-700",
    "brand-600",
    "brand-500",
    "brand-100",
    "brand-50",
    "success",
    "success-bg",
    "warning",
    "warning-bg",
    "danger",
    "danger-bg",
    "info",
    "info-bg",
    "diff-add-bg",
    "diff-add-fg",
    "diff-del-bg",
    "diff-del-fg",
    "diff-selected",
  ];
  for (const name of colors)
    assert.ok(tokens.get(`--color-${name}`)?.rgb, `--color-${name}`);
  assert.equal(tokens.get("--color-brand-600").value, "#1f6d50");
  const scale = { "2xs": 11, xs: 12, sm: 13, md: 14, lg: 16, xl: 20, "2xl": 28, "3xl": 36 };
  for (const [step, px] of Object.entries(scale))
    assert.equal(tokens.get(`--text-${step}`)?.value, `${px}px`);
  for (let step = 1; step <= 10; step++)
    assert.equal(tokens.get(`--space-${step}`)?.value, `${step * 4}px`);
  for (const name of ["--radius-sm", "--radius-md", "--radius-lg", "--radius-pill", "--shadow-1", "--shadow-2", "--shadow-3", "--font-sans", "--font-mono"])
    assert.ok(tokens.has(name), name);
  assert.equal(
    tokens.get("--focus-ring").value,
    "0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-brand-600)",
  );
});

test("text tokens meet WCAG AA on every light background token", () => {
  const pairs: { fg: string; bg: string; ratio: number }[] =
    tokenizer.contrastReport(tokens);
  const failing = pairs.filter((pair) => pair.ratio < 4.5);
  assert.deepEqual(failing, []);
  const muted = (bg: string) =>
    pairs.find((pair) => pair.fg === "text-muted" && pair.bg === bg)!.ratio;
  assert.ok(muted("bg") >= 4.5 && muted("surface") >= 4.5);
});

test("fonts.css self-hosts woff2 files of the latin subsets only", () => {
  const css = readFileSync(path.join(root, "src/theme/fonts.css"), "utf8");
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  assert.equal(faces.length, 8);
  const weights = new Set<string>();
  for (const face of faces) {
    const urls = [...face.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]);
    assert.equal(urls.length, 1, face);
    const [url] = urls;
    assert.match(url, /^@fontsource(-variable)?\/[\w-]+\/files\/[\w-]+-latin(-ext)?-[\w-]+\.woff2$/);
    assert.ok(existsSync(path.join(root, "node_modules", url)), url);
    assert.match(face, /font-display: swap;/);
    assert.match(face, /unicode-range: U\+/);
    if (url.includes("ibm-plex-mono")) weights.add(/font-weight: (\d+);/.exec(face)![1]);
  }
  assert.deepEqual([...weights].sort(), ["400", "500", "600"]);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /https?:|\.woff\b/);
});

test("styles.css loads the tokens first and the fonts second", () => {
  const css = readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.deepEqual(css.split("\n").slice(0, 2), [
    '@import "./theme/tokens.css";',
    '@import "./theme/fonts.css";',
  ]);
});

test("Traditional Chinese text uses the system CJK fonts", () => {
  const css = readFileSync(path.join(root, "src/theme/tokens.css"), "utf8");
  const zh = /:lang\(zh-Hant\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(zh, /--font-sans: var\(--font-sans-base\), "PingFang TC", "Microsoft JhengHei",\s+"Noto Sans CJK TC", "Noto Sans TC", sans-serif;/);
  assert.match(css, /:root,\n\[lang\] \{\n {2}font-family: var\(--font-sans\);/);
});
