import type { Express } from "express";
import { z } from "zod";
import {
  followUpFeedbackLimit,
  followUpNoteLimit,
  followUpRestatementLimit,
} from "../../shared/followups.js";
import { fixedLicense, requirePro } from "../license.js";
import type { RouteDeps } from "./types.js";

/**
 * Review follow-up rounds on a published PR: starting one from the selected
 * maintainer feedback and discarding the one waiting for review. Pushing a
 * round goes through POST /api/runs/:id/publish like a first publish.
 * Starting a round is Pro (prFeedback); a round that is already open can
 * still be discarded, reviewed and pushed on every plan.
 */
export function registerFollowUpsRoutes(
  app: Express,
  { workbench, license = fixedLicense("free") }: RouteDeps,
) {
  app.post("/api/runs/:id/follow-ups", requirePro(license, "prFeedback"), async (req, res) => {
    const input = z
      .object({
        feedbackUrls: z
          .array(z.string().url().max(1024))
          .max(followUpFeedbackLimit),
        note: z.string().max(followUpNoteLimit).optional(),
        // One line per selected comment in the person's own words; accepted
        // here so clients can send it, and required once restatements are
        // enforced (L2A).
        restatements: z
          .array(
            z
              .object({
                url: z.string().url().max(1024),
                text: z.string().max(followUpRestatementLimit),
              })
              .strict(),
          )
          .max(followUpFeedbackLimit)
          .optional(),
      })
      .strict()
      .parse(req.body);
    res.json({ run: await workbench.startFollowUp(req.params.id, input) });
  });
  app.post("/api/runs/:id/follow-ups/discard", async (req, res) => {
    res.json({ run: await workbench.discardFollowUp(req.params.id) });
  });
}
