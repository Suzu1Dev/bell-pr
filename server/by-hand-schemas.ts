/**
 * The structured output of Learn-by-hand agent turns (DESIGN v1.2): the
 * orientation turn (F3), the guide turn (F7) and the reviewer at Ready
 * (F8). Each has a strict zod schema with the write caps and a hand-written
 * JSON Schema for the CLIs (Codex --output-schema, Claude Code
 * --json-schema): every object closed, every property required, nullable
 * where optional, as server/team.ts does. Code never travels in these
 * answers: quotes are references that BELL cuts itself, and the review has
 * no fix field.
 *
 * `withSchemaFile` writes a schema to a temporary file for one turn and
 * removes it, as the conflict agent's turn does (server/sync-runs.ts).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { askEntries, byHandLimits, evidenceTypes } from "../shared/by-hand.js";
import { tasteDimensions } from "../shared/understanding.js";
import { jsonText } from "./team.js";
import { AppError } from "./types.js";

const limits = byHandLimits;
const filePath = z.string().trim().min(1).max(1024);
const line = z.number().int().min(1);
/** A JSON Schema value that may be null. */
const nullable = (type: string) => ({ type: [type, "null"] });

// The orientation turn (F3): the problem and impact, step names with
// files and never how, read-first ranges, and the premise check.

export const orientationSchema = z
  .object({
    summary: z.string().trim().min(1).max(limits.outlineSummaryChars),
    steps: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(limits.outlineTitleChars),
            files: z.array(filePath).max(limits.stepFiles),
          })
          .strict(),
      )
      .min(1)
      .max(limits.outlineSteps),
    readFirst: z
      .array(
        z
          .object({ path: filePath, startLine: line, endLine: line, why: z.string().trim().min(1).max(limits.readFirstWhyChars) })
          .strict(),
      )
      .max(limits.readFirst),
    premise: z
      .object({
        verdict: z.enum(["holds", "refuted", "unclear"]),
        statement: z.string().trim().min(1).max(1_000),
        evidence: z.string().trim().min(1).max(3_000),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type OrientationAnswer = z.infer<typeof orientationSchema>;

export const orientationJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, files: { type: "array", items: { type: "string" } } },
        required: ["title", "files"],
        additionalProperties: false,
      },
    },
    readFirst: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "integer" },
          endLine: { type: "integer" },
          why: { type: "string" },
        },
        required: ["path", "startLine", "endLine", "why"],
        additionalProperties: false,
      },
    },
    premise: {
      anyOf: [
        {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["holds", "refuted", "unclear"] },
            statement: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["verdict", "statement", "evidence"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
  },
  required: ["summary", "steps", "readFirst", "premise"],
  additionalProperties: false,
};

// The guide turn (F7): prose without code, references the server checks,
// quotes by reference that BELL cuts, options for R3, the topic and
// whether the person asked for code.

export const guideAnswerSchema = z
  .object({
    text: z.string().trim().max(900),
    question: z.string().trim().max(300).nullable(),
    refs: z
      .array(z.object({ path: filePath, line, endLine: line.nullable() }).strict())
      .max(limits.refs),
    quotes: z
      .array(
        z
          .object({
            path: filePath,
            startLine: line,
            endLine: line,
            from: z.enum(["base", "change"]),
            anchor: z.string().max(limits.anchorChars).nullable(),
          })
          .strict(),
      )
      .max(limits.quotes),
    options: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(limits.optionNameChars),
            tradeoff: z.string().trim().min(1).max(limits.tradeoffChars),
          })
          .strict(),
      )
      .min(2)
      .max(limits.options)
      .nullable(),
    topic: z.enum(askEntries),
    askedForCode: z.boolean(),
  })
  .strict();
export type GuideAnswer = z.infer<typeof guideAnswerSchema>;

export const guideAnswerJsonSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
    question: nullable("string"),
    refs: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, line: { type: "integer" }, endLine: nullable("integer") },
        required: ["path", "line", "endLine"],
        additionalProperties: false,
      },
    },
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "integer" },
          endLine: { type: "integer" },
          from: { type: "string", enum: ["base", "change"] },
          anchor: nullable("string"),
        },
        required: ["path", "startLine", "endLine", "from", "anchor"],
        additionalProperties: false,
      },
    },
    options: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, tradeoff: { type: "string" } },
            required: ["name", "tradeoff"],
            additionalProperties: false,
          },
        },
        { type: "null" },
      ],
    },
    topic: { type: "string", enum: [...askEntries] },
    askedForCode: { type: "boolean" },
  },
  required: ["text", "question", "refs", "quotes", "options", "topic", "askedForCode"],
  additionalProperties: false,
};

// The reviewer at Ready (F8): what it verified, what it checked (at least
// one item, so a bare "looks good" fails), at most three findings with
// evidence or a question. There is no fix field.

export const reviewerAnswerSchema = z
  .object({
    verified: z.string().trim().min(1).max(limits.reviewVerifiedChars),
    checked: z.array(z.string().trim().min(1).max(300)).min(1).max(limits.reviewChecked),
    findings: z
      .array(
        z
          .object({
            path: filePath,
            line: line.nullable(),
            observed: z.string().trim().min(1).max(limits.findingObservedChars),
            evidence: z
              .object({
                type: z.enum(evidenceTypes),
                path: filePath.nullable(),
                line: line.nullable(),
                quote: z.string().max(300).nullable(),
              })
              .strict(),
            why: z.string().trim().min(1).max(limits.findingWhyChars),
            question: z.string().trim().min(1).max(limits.findingQuestionChars),
            dimension: z.enum(tasteDimensions).nullable(),
          })
          .strict(),
      )
      .max(limits.reviewFindings),
  })
  .strict();
export type ReviewerAnswer = z.infer<typeof reviewerAnswerSchema>;

export const reviewerAnswerJsonSchema = {
  type: "object",
  properties: {
    verified: { type: "string" },
    checked: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          line: nullable("integer"),
          observed: { type: "string" },
          evidence: {
            type: "object",
            properties: {
              type: { type: "string", enum: [...evidenceTypes] },
              path: nullable("string"),
              line: nullable("integer"),
              quote: nullable("string"),
            },
            required: ["type", "path", "line", "quote"],
            additionalProperties: false,
          },
          why: { type: "string" },
          question: { type: "string" },
          dimension: { anyOf: [{ type: "string", enum: [...tasteDimensions] }, { type: "null" }] },
        },
        required: ["path", "line", "observed", "evidence", "why", "question", "dimension"],
        additionalProperties: false,
      },
    },
  },
  required: ["verified", "checked", "findings"],
  additionalProperties: false,
};

/** An agent's structured answer, or 422 `m.byHand.badAnswer` when it is not in the schema's form. */
export function parseByHandAnswer<T>(schema: z.ZodType<T>, answer: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText(answer));
  } catch {
    throw new AppError((m) => m.byHand.badAnswer, 422);
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new AppError((m) => m.byHand.badAnswer, 422);
  return result.data;
}

/** Writes `schema` to a temporary file for one agent turn and removes it after `turn`. */
export async function withSchemaFile<T>(
  schema: object,
  turn: (schemaPath: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-by-hand-schema-"));
  try {
    const schemaPath = path.join(directory, "schema.json");
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    return await turn(schemaPath);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
