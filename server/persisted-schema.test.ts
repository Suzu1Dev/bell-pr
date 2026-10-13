import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { lenientRead } from "./persisted-schema.js";

test("objects strip unknown keys at every depth instead of rejecting them", () => {
  const schema = z
    .object({
      name: z.string(),
      nested: z.object({ count: z.number() }).strict(),
      items: z.array(z.object({ id: z.string() }).strict()),
    })
    .strict();
  const written = {
    name: "a",
    fromNewerBuild: true,
    nested: { count: 1, alsoNew: "x" },
    items: [{ id: "1", extra: 2 }],
  };
  assert.equal(schema.safeParse(written).success, false);
  assert.deepEqual(lenientRead(schema).parse(written), {
    name: "a",
    nested: { count: 1 },
    items: [{ id: "1" }],
  });
});

test("string and array maximums grow by the cap factor while minimums stay", () => {
  const schema = z.object({
    text: z.string().trim().min(2).max(10),
    list: z.array(z.string()).min(1).max(3),
  });
  const lenient = lenientRead(schema);
  const doubled = { text: "x".repeat(20), list: ["a", "b", "c", "d", "e", "f"] };
  assert.equal(schema.safeParse(doubled).success, false);
  assert.deepEqual(lenient.parse(doubled), doubled);
  // The relaxed cap still holds (4x by default), and so do the minimums.
  assert.equal(lenient.safeParse({ text: "x".repeat(41), list: ["a"] }).success, false);
  assert.equal(lenient.safeParse({ text: "x", list: ["a"] }).success, false);
  assert.equal(lenient.safeParse({ text: "xx", list: [] }).success, false);
  assert.equal(
    lenient.safeParse({ text: "xx", list: Array(13).fill("a") }).success,
    false,
  );
  // Transforming checks such as trim still apply.
  assert.equal(lenient.parse({ text: "  ok  ", list: ["a"] }).text, "ok");
});

test("capFactor sets the margin and must not tighten the schema", () => {
  const schema = z.string().max(10);
  assert.equal(lenientRead(schema, { capFactor: 2 }).safeParse("x".repeat(20)).success, true);
  assert.equal(lenientRead(schema, { capFactor: 2 }).safeParse("x".repeat(21)).success, false);
  assert.equal(lenientRead(schema, { capFactor: 1 }).safeParse("x".repeat(11)).success, false);
  for (const capFactor of [0.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(() => lenientRead(schema, { capFactor }), RangeError);
});

test("unknown enum and literal values, numbers out of range and wrong types still fail", () => {
  const schema = z
    .object({
      kind: z.enum(["a", "b"]),
      version: z.literal(1),
      count: z.number().int().max(5),
      flag: z.boolean(),
      maxTeammates: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    })
    .strict();
  const lenient = lenientRead(schema);
  const valid = { kind: "a", version: 1, count: 5, flag: true, maxTeammates: 2 };
  assert.deepEqual(lenient.parse(valid), valid);
  for (const invalid of [
    { ...valid, kind: "c" },
    { ...valid, version: 2 },
    { ...valid, count: 6 },
    { ...valid, count: 1.5 },
    { ...valid, flag: "yes" },
    { ...valid, maxTeammates: 5 },
    { ...valid, kind: undefined },
  ])
    assert.equal(lenient.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("refinements, formats, transforms and defaults still run", () => {
  const ids = z
    .array(z.string().regex(/^[a-z]+$/).max(4))
    .max(2)
    .refine((values) => new Set(values).size === values.length, "duplicate");
  const schema = z
    .object({
      ids,
      url: z
        .string()
        .url()
        .max(30)
        .refine((value) => value.startsWith("https://"), "https only"),
      at: z.string().datetime(),
      label: z.string().transform((value) => value.toUpperCase()),
      mode: z.enum(["lite", "full"]).default("lite"),
      preferences: z
        .object({ order: z.array(z.string()) })
        .strict()
        .default({ order: [] }),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.label === "BAD")
        context.addIssue({ code: z.ZodIssueCode.custom, message: "bad label" });
    });
  const lenient = lenientRead(schema);
  const valid = {
    ids: ["ab", "cd"],
    url: "https://example.test/path",
    at: "2026-10-07T00:00:00.000Z",
    label: "ok",
  };
  assert.deepEqual(lenient.parse(valid), {
    ...valid,
    label: "OK",
    mode: "lite",
    preferences: { order: [] },
  });
  // Leniency reaches inside refinements and defaults too.
  const newer = {
    ...valid,
    ids: ["ab", "cd", "ef"],
    preferences: { order: ["a"], fromNewerBuild: true },
    fromNewerBuild: true,
  };
  assert.equal(schema.safeParse(newer).success, false);
  assert.deepEqual(lenient.parse(newer), {
    ...valid,
    ids: ["ab", "cd", "ef"],
    label: "OK",
    mode: "lite",
    preferences: { order: ["a"] },
  });
  for (const invalid of [
    { ...valid, ids: ["ab", "ab"] },
    { ...valid, ids: ["AB"] },
    { ...valid, url: "http://example.test" },
    { ...valid, url: "not a url" },
    { ...valid, at: "yesterday" },
    { ...valid, label: "bad" },
  ])
    assert.equal(lenient.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("optional, nullable, union, discriminated union, record, tuple and intersection are mapped", () => {
  const event = z.discriminatedUnion("type", [
    z.object({ type: z.literal("note"), text: z.string().max(3) }).strict(),
    z.object({ type: z.literal("count"), value: z.number() }).strict(),
  ]);
  const schema = z
    .object({
      maybe: z.object({ a: z.string() }).strict().optional(),
      nothing: z.object({ a: z.string() }).strict().nullable(),
      either: z.union([z.string().max(2), z.object({ b: z.number() }).strict()]),
      events: z.array(event),
      byRole: z.record(
        z.string().max(3),
        z.object({ calls: z.number() }).strict(),
      ),
      pair: z.tuple([z.string().max(2), z.object({ c: z.boolean() }).strict()]),
      both: z
        .object({ left: z.string() })
        .strict()
        .and(z.object({ right: z.string() }).passthrough()),
    })
    .strict();
  const written = {
    maybe: { a: "x", newer: 1 },
    nothing: null,
    either: { b: 1, newer: 1 },
    events: [
      { type: "note", text: "abcdef", newer: 1 },
      { type: "count", value: 2, newer: 1 },
    ],
    byRole: { leader: { calls: 1, newer: 1 } },
    pair: ["abc", { c: true, newer: 1 }],
    both: { left: "l", right: "r" },
  };
  assert.equal(schema.safeParse(written).success, false);
  const parsed = lenientRead(schema).parse(written);
  assert.deepEqual(parsed, {
    maybe: { a: "x" },
    nothing: null,
    either: { b: 1 },
    events: [
      { type: "note", text: "abcdef" },
      { type: "count", value: 2 },
    ],
    byRole: { leader: { calls: 1 } },
    pair: ["abc", { c: true }],
    both: { left: "l", right: "r" },
  });
  // An unknown discriminator value is still rejected.
  assert.equal(
    lenientRead(event).safeParse({ type: "other", text: "a" }).success,
    false,
  );
  assert.equal(
    lenientRead(event).safeParse({ type: "note", text: "x".repeat(13) }).success,
    false,
  );
});

test("catch, readonly, pipeline and branded schemas are mapped", () => {
  const inner = () => z.object({ a: z.string() }).strict();
  const schema = z
    .object({
      caught: inner().catch({ a: "fallback" }),
      frozen: inner().readonly(),
      piped: z.string().pipe(z.string().max(2)),
      branded: inner().brand<"Branded">(),
    })
    .strict();
  const written = {
    caught: { a: "kept", newer: 1 },
    frozen: { a: "x", newer: 1 },
    piped: "abc",
    branded: { a: "y", newer: 1 },
  };
  assert.equal(schema.safeParse(written).success, false);
  assert.deepEqual(lenientRead(schema).parse(written), {
    caught: { a: "kept" },
    frozen: { a: "x" },
    piped: "abc",
    branded: { a: "y" },
  });
});

test("passthrough objects keep unknown keys, so a round trip preserves them", () => {
  const schema = z.object({ version: z.literal(1) }).passthrough();
  assert.deepEqual(lenientRead(schema).parse({ version: 1, newer: { a: 1 } }), {
    version: 1,
    newer: { a: 1 },
  });
});

test("recursive and shared sub-schemas are rebuilt once and stay lenient", () => {
  interface Node {
    name: string;
    children: Node[];
  }
  const node: z.ZodType<Node> = z.lazy(() =>
    z.object({ name: z.string().max(2), children: z.array(node) }).strict(),
  );
  const tree = { name: "abc", extra: 1, children: [{ name: "de", children: [], extra: 2 }] };
  assert.equal(node.safeParse(tree).success, false);
  assert.deepEqual(lenientRead(node).parse(tree), {
    name: "abc",
    children: [{ name: "de", children: [] }],
  });
  const text = z.string().max(2);
  const shared = z.object({ a: text, b: text }).strict();
  assert.deepEqual(lenientRead(shared).parse({ a: "abc", b: "def" }), {
    a: "abc",
    b: "def",
  });
});

test("the original schema is left unchanged", () => {
  const schema = z.object({ text: z.string().max(2) }).strict();
  lenientRead(schema);
  assert.equal(schema.safeParse({ text: "abc" }).success, false);
  assert.equal(schema.safeParse({ text: "ab", extra: 1 }).success, false);
  assert.equal(schema._def.unknownKeys, "strict");
});
