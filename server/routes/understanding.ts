import type { Express } from "express";
import { z } from "zod";
import {
  confidences,
  roadChoices,
  selfGrades,
  tasteDimensions,
  understandingLimits,
} from "../../shared/understanding.js";
import { sm } from "../i18n/index.js";
import type { RouteDeps } from "./types.js";

/**
 * The Explain-it-back check and the per-file "try first" attempts. Every
 * route is open on every plan: the understanding check is part of the
 * human review, never a Pro feature. The request schemas are strict.
 */
const changeFingerprintField = z.string().regex(/^[0-9a-f]{16}$/);
const forecastSchema = z
  .object({
    dimension: z.enum(tasteDimensions).optional(),
    question: z.string().max(understandingLimits.forecastChars).optional(),
  })
  .strict();

export const answersSchema = z
  .object({
    summary: z.string().max(understandingLimits.summaryChars).optional(),
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(1100),
            answer: z.string().max(understandingLimits.answerChars),
            confidence: z.enum(confidences),
            dontKnow: z.boolean().optional(),
          })
          .strict(),
      )
      .max(understandingLimits.items),
    changeFingerprint: changeFingerprintField,
    openedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const gradesSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(1100),
            grade: z.enum(selfGrades),
            correction: z.string().max(understandingLimits.correctionChars).optional(),
          })
          .strict(),
      )
      .max(understandingLimits.items),
    forecast: forecastSchema.optional(),
  })
  .strict();

export const summarySchema = z
  .object({
    changeFingerprint: changeFingerprintField,
    text: z.string().max(understandingLimits.summaryChars).optional(),
  })
  .strict();

export const attemptSchema = z
  .object({
    filePath: z.string().min(1).max(1024),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    quiz: z
      .object({
        answer: z.string().max(understandingLimits.answerChars).optional(),
        confidence: z.enum(confidences).optional(),
        grade: z.enum(selfGrades).optional(),
        skipped: z.boolean().optional(),
      })
      .strict()
      .optional(),
    road: z
      .object({
        guess: z.string().max(understandingLimits.lineChars).optional(),
        choice: z.enum(roadChoices).optional(),
        why: z.string().max(understandingLimits.lineChars).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (input) => input.quiz || input.road,
    () => ({ message: sm().understanding.attemptEmpty }),
  );

export function registerUnderstandingRoutes(
  app: Express,
  { workbench }: RouteDeps,
) {
  app.get("/api/runs/:id/understanding", async (req, res) => {
    res.json({ understanding: await workbench.understanding.status(req.params.id) });
  });
  app.put("/api/runs/:id/understanding/answers", async (req, res) => {
    res.json(
      await workbench.understanding.saveAnswers(
        req.params.id,
        answersSchema.parse(req.body),
      ),
    );
  });
  app.put("/api/runs/:id/understanding/grades", async (req, res) => {
    res.json(
      await workbench.understanding.saveGrades(
        req.params.id,
        gradesSchema.parse(req.body),
      ),
    );
  });
  app.post("/api/runs/:id/understanding/summary", async (req, res) => {
    res.json(
      await workbench.understanding.confirmSummary(
        req.params.id,
        summarySchema.parse(req.body),
      ),
    );
  });
  app.delete("/api/runs/:id/understanding", async (req, res) => {
    res.json(await workbench.understanding.restart(req.params.id));
  });
  app.put("/api/runs/:id/forecast", async (req, res) => {
    res.json(
      await workbench.understanding.saveForecast(
        req.params.id,
        forecastSchema.parse(req.body),
      ),
    );
  });
  app.patch("/api/runs/:id/attempts", async (req, res) => {
    res.json(
      await workbench.understanding.saveAttempt(
        req.params.id,
        attemptSchema.parse(req.body),
      ),
    );
  });
}
