import type { Express } from "express";
import { z } from "zod";
import {
  askEntries,
  byHandLimits,
  checkInSignals,
  exitKinds,
  testPredictions,
} from "../../shared/by-hand.js";
import type { RouteDeps } from "./types.js";

/**
 * Learn by hand (DESIGN v1.2 §8): the person's plan, the guide, the test
 * command and BELL's runs of it, Ready for review, leaving, and the PR
 * template. Every route is open on every plan (the whole of Learn by hand
 * is Free) and every request schema is strict. The work is
 * `workbench.byHand`, which refuses a run that is not Learn by hand (409).
 * Guide turns, plan questions and test runs answer 202 and are polled
 * through the run (`byHand.busy`).
 */
const limits = byHandLimits;
const filePath = z.string().min(1).max(1024);
const stepId = z.string().min(1).max(64);
const empty = z.object({}).strict();

export const planSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            id: stepId.optional(),
            title: z.string().trim().min(1).max(limits.stepTitleChars),
            files: z.array(filePath).max(limits.stepFiles).optional(),
            how: z.string().max(limits.stepHowChars).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(limits.planSteps),
    tests: z.string().max(limits.planTestsChars).optional(),
    unsure: z.string().max(limits.planUnsureChars).optional(),
    prediction: z.string().max(limits.predictionChars).optional(),
  })
  .strict();

export const revealSchema = z.object({ mode: z.enum(["names", "compare"]) }).strict();

export const stepSchema = z
  .object({
    done: z.boolean().optional(),
    parked: z.boolean().optional(),
    why: z.string().max(limits.stepWhyChars).optional(),
    chosen: z
      .object({
        entryId: z.string().min(1).max(64),
        option: z.number().int().min(0).max(limits.options - 1),
        why: z.string().trim().min(1).max(limits.stepWhyChars),
      })
      .strict()
      .optional(),
    talked: z.literal(true).optional(),
  })
  .strict();

export const guideSchema = z
  .object({
    kind: z.enum(["ask", "hint", "test"]),
    stepId: stepId.optional(),
    rung: z.number().int().min(1).max(4).optional(),
    entry: z.enum(askEntries).optional(),
    question: z.string().max(limits.entryQuestionChars).optional(),
    tried: z.string().max(limits.triedChars).optional(),
    path: filePath.optional(),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  })
  .strict();

export const checkInSchema = z
  .object({
    stepId: stepId.optional(),
    signal: z.enum(checkInSignals),
    choice: z.enum(exitKinds).optional(),
  })
  .strict();

export const testCommandSchema = z
  .object({ command: z.string().trim().min(1).max(limits.commandChars) })
  .strict();

export const testRunSchema = z
  .object({
    prediction: z.enum(testPredictions).optional(),
    expect: z.string().max(limits.expectChars).optional(),
  })
  .strict();

export const testReportSchema = z
  .object({
    outcome: z.enum(["passed", "failed"]),
    output: z.string().max(limits.tailChars).optional(),
  })
  .strict();

export const readySchema = z
  .object({
    changeFingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    leastSure: z.string().max(limits.leastSureChars).optional(),
    review: z.boolean(),
  })
  .strict();

export function registerByHandRoutes(app: Express, { workbench }: RouteDeps) {
  const byHand = () => workbench.byHand;
  app.put("/api/runs/:id/by-hand/plan", async (req, res) => {
    res.json(await byHand().savePlan(req.params.id, planSchema.parse(req.body)));
  });
  app.post("/api/runs/:id/by-hand/plan/reveal", async (req, res) => {
    res.json(await byHand().revealOutline(req.params.id, revealSchema.parse(req.body)));
  });
  app.post("/api/runs/:id/by-hand/plan/questions", async (req, res) => {
    empty.parse(req.body ?? {});
    res.status(202).json(await byHand().planQuestions(req.params.id));
  });
  app.patch("/api/runs/:id/by-hand/steps/:stepId", async (req, res) => {
    const step = stepId.parse(req.params.stepId);
    res.json(await byHand().updateStep(req.params.id, step, stepSchema.parse(req.body)));
  });
  app.post("/api/runs/:id/by-hand/guide", async (req, res) => {
    res.status(202).json(await byHand().guide(req.params.id, guideSchema.parse(req.body)));
  });
  app.post("/api/runs/:id/by-hand/check-ins", async (req, res) => {
    res.json(await byHand().checkIn(req.params.id, checkInSchema.parse(req.body)));
  });
  app.get("/api/runs/:id/by-hand/test-command", async (req, res) => {
    res.json(await byHand().testCommand(req.params.id));
  });
  app.put("/api/repos/:id/test-command", async (req, res) => {
    res.json(await byHand().confirmTestCommand(req.params.id, testCommandSchema.parse(req.body)));
  });
  app.post("/api/runs/:id/by-hand/tests", async (req, res) => {
    res.status(202).json(await byHand().runTests(req.params.id, testRunSchema.parse(req.body ?? {})));
  });
  app.get("/api/runs/:id/by-hand/tests/live", async (req, res) => {
    res.json(await byHand().liveTests(req.params.id));
  });
  app.post("/api/runs/:id/by-hand/tests/stop", async (req, res) => {
    empty.parse(req.body ?? {});
    res.json(await byHand().stopTests(req.params.id));
  });
  app.post("/api/runs/:id/by-hand/tests/report", async (req, res) => {
    res.json(await byHand().reportTests(req.params.id, testReportSchema.parse(req.body)));
  });
  app.post("/api/runs/:id/by-hand/ready", async (req, res) => {
    res.json(await byHand().ready(req.params.id, readySchema.parse(req.body)));
  });
  app.post("/api/runs/:id/by-hand/leave", async (req, res) => {
    empty.parse(req.body ?? {});
    res.json(await byHand().leave(req.params.id));
  });
  app.get("/api/runs/:id/by-hand/template", async (req, res) => {
    res.json(await byHand().template(req.params.id));
  });
}
