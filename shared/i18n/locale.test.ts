import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultLocale,
  formatters,
  htmlLang,
  intlLocale,
  locales,
  parseLocale,
} from "./locale.js";

test("parseLocale maps English and Traditional Chinese tags and rejects the rest", () => {
  const table: [unknown, string | undefined][] = [
    ["en", "en"],
    ["en-US", "en"],
    ["en-GB", "en"],
    ["EN-gb", "en"],
    [" en ", "en"],
    ["en_US.UTF-8", "en"],
    ["zh-TW", "zh-TW"],
    ["zh-tw", "zh-TW"],
    ["zh_TW.UTF-8", "zh-TW"],
    ["zh-Hant", "zh-TW"],
    ["zh-Hant-TW", "zh-TW"],
    ["zh-Hant-HK", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["zh-MO", "zh-TW"],
    ["zh-CN", undefined],
    ["zh-Hans", undefined],
    ["zh-Hans-TW", undefined],
    ["zh-SG", undefined],
    ["zh", undefined],
    ["ja", undefined],
    ["ja-JP", undefined],
    ["english", undefined],
    ["zh-TWN", undefined],
    ["", undefined],
    ["   ", undefined],
    ["<script>", undefined],
    [undefined, undefined],
    [null, undefined],
    [42, undefined],
    [{}, undefined],
    [["en"], undefined],
  ];
  for (const [input, expected] of table)
    assert.equal(parseLocale(input), expected, JSON.stringify(input));
});

test("the default locale is English and both locales map to html and Intl tags", () => {
  assert.equal(defaultLocale, "en");
  assert.deepEqual([...locales], ["en", "zh-TW"]);
  assert.equal(htmlLang("en"), "en");
  assert.equal(htmlLang("zh-TW"), "zh-Hant-TW");
  assert.equal(intlLocale("en"), "en-US");
  assert.equal(intlLocale("zh-TW"), "zh-TW");
});

test("list joins items with each locale's separators", () => {
  const en = formatters("en");
  const zh = formatters("zh-TW");
  assert.equal(en.list(["a", "b", "c"]), "a, b, and c");
  assert.equal(en.list(["a", "b"]), "a and b");
  assert.equal(en.list(["a", "b", "c"], { type: "unit" }), "a, b, c");
  assert.equal(en.list(["a"]), "a");
  assert.equal(en.list([]), "");
  assert.equal(zh.list(["甲", "乙", "丙"]), "甲、乙和丙");
  assert.equal(zh.list(["甲", "乙"]), "甲和乙");
});

test("unit lists enumerate without a conjunction in both locales", () => {
  const en = formatters("en");
  const zh = formatters("zh-TW");
  assert.equal(en.list(["a", "b"], { type: "unit" }), "a, b");
  assert.equal(en.list(["a"], { type: "unit" }), "a");
  assert.equal(en.list([], { type: "unit" }), "");
  // The legacy zh-TW UI joins files and models with the ideographic comma.
  assert.equal(
    zh.list(["src/a.ts", "src/b.ts", "src/c.ts"], { type: "unit" }),
    "src/a.ts、src/b.ts、src/c.ts",
  );
  assert.equal(
    zh.list(["claude-sonnet-4-5", "claude-haiku-4-5-20251001"], {
      type: "unit",
    }),
    "claude-sonnet-4-5、claude-haiku-4-5-20251001",
  );
  assert.equal(zh.list(["src/a.ts"], { type: "unit" }), "src/a.ts");
  assert.equal(zh.list([], { type: "unit" }), "");
  // Each type keeps its own result after the other one ran.
  assert.equal(zh.list(["甲", "乙"]), "甲和乙");
});

test("plural gives the locale's plural category", () => {
  const en = formatters("en");
  assert.equal(en.plural(1), "one");
  assert.equal(en.plural(0), "other");
  assert.equal(en.plural(2), "other");
  assert.equal(formatters("zh-TW").plural(1), "other");
});

test("number formats with grouping and accepts Intl options", () => {
  assert.equal(formatters("en").number(1234567.891), "1,234,567.891");
  assert.equal(formatters("zh-TW").number(1234567.891), "1,234,567.891");
  assert.equal(formatters("en").number(0.256, { style: "percent" }), "26%");
  assert.equal(
    formatters("zh-TW").number(1.25, { maximumFractionDigits: 1 }),
    "1.3",
  );
});

test("dates use each locale's style, with a 24-hour clock in zh-TW only", () => {
  // Local time, so the result does not depend on the machine's time zone.
  const afternoon = new Date(2026, 9, 13, 15, 5);
  const en = formatters("en");
  const zh = formatters("zh-TW");
  assert.equal(en.date(afternoon), "Oct 13, 2026");
  assert.equal(zh.date(afternoon), "2026年10月13日");
  assert.match(en.time(afternoon), /^3:05\sPM$/);
  assert.equal(zh.time(afternoon), "15:05");
  assert.match(en.dateTime(afternoon), /^Oct 13, 2026,\s3:05\sPM$/);
  // ICU may put a thin or narrow no-break space between the parts.
  assert.match(zh.dateTime(afternoon), /^2026\/10\/13\s15:05$/);
  // Caller options replace the default fields; the zh-TW clock still applies.
  assert.match(
    zh.dateTime(afternoon, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    /^10\/13\s15:05$/,
  );
  assert.match(zh.time(afternoon, { hour: "numeric", hour12: true }), /下午/);
  // Options that do not choose fields, such as timeZone, keep the defaults.
  assert.equal(zh.time(afternoon, { timeZone: undefined }), "15:05");
  // ISO strings and epoch milliseconds work like Date objects.
  assert.equal(
    en.date("2026-10-13T12:00:00Z", { timeZone: "UTC" }),
    "Oct 13, 2026",
  );
  assert.equal(
    en.date(Date.UTC(2026, 9, 13, 12), { timeZone: "UTC" }),
    "Oct 13, 2026",
  );
  assert.match(
    zh.dateTime("2026-10-13T15:05:00Z", { timeZone: "UTC" }),
    /^2026\/10\/13\s15:05$/,
  );
});

test("an invalid date returns the raw input instead of Invalid Date", () => {
  for (const locale of locales) {
    const fmt = formatters(locale);
    assert.equal(fmt.date("not a date"), "not a date");
    assert.equal(fmt.time("2026-13-45T99:00:00Z"), "2026-13-45T99:00:00Z");
    assert.equal(fmt.dateTime(""), "");
    assert.equal(fmt.dateTime(new Date(Number.NaN)), "");
    assert.equal(fmt.date(Number.NaN), "NaN");
  }
});

test("relative describes offsets in words", () => {
  assert.equal(formatters("en").relative(-1, "day"), "yesterday");
  assert.equal(formatters("en").relative(3, "hour"), "in 3 hours");
  assert.equal(formatters("zh-TW").relative(-1, "day"), "昨天");
});

test("formatters are built once per locale", () => {
  assert.equal(formatters("en"), formatters("en"));
  assert.notEqual(formatters("en"), formatters("zh-TW"));
});
