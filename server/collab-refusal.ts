/**
 * How group work says no. Every refusal of /api/collab leaves through
 * collabErrors: its status, its `details.reason`, one sentence from group
 * work's own dictionary and, at most, the detail fields named here.
 *
 * The coordinator and git word their refusals for the host: such a message
 * can quote git's output, and with it a path of this computer. Their
 * sentences and details stay in the log; the person gets group work's.
 */
import type { ErrorRequestHandler } from "express";
import type { CollabRefusal } from "../shared/collab.js";
import { sm } from "./i18n/index.js";
import { log } from "./log.js";
import { redact } from "./secrets.js";
import { AppError } from "./types.js";

/** A refusal group work words itself; any other AppError is the coordinator's or git's. */
class CollabRefused extends AppError {}

/** A refusal in group work's words, with only details that may reach the person. */
export const refuse = (
  status: number,
  reason: string,
  message: ConstructorParameters<typeof AppError>[0],
  details: Record<string, unknown> = {},
) => new CollabRefused(message, status, { details: { reason, ...details } });
export const notJoined = () => refuse(403, "notJoined", (m) => m.collab.notJoined);
export const adminOnly = () => refuse(403, "adminOnly", (m) => m.collab.adminOnly);

/** A refusal's stable word, if it has one. */
export const reasonOf = (error: unknown) =>
  error instanceof AppError && typeof error.details?.reason === "string"
    ? error.details.reason
    : undefined;

/** The detail fields a refusal may carry to the person. */
const forwarded = ["conflicts", "retryAfter", "invalid", "unknown", "pending"] as const;

/** Group work's sentence for a refusal it did not word: by its reason, else a general one. */
function sentence(status: number, reason: string | undefined) {
  const words = sm().collab;
  const own =
    reason !== undefined && Object.hasOwn(words, reason)
      ? words[reason as keyof typeof words]
      : undefined;
  if (typeof own === "string") return own;
  if (status === 503) return words.stopped;
  return status >= 500 ? words.failed : words.refused;
}

/** The one place a refusal of /api/collab becomes a response. Registered after its routes. */
export const collabErrors: ErrorRequestHandler = (error, req, res, next) => {
  // Not a refusal: a body that does not parse or a fault, answered as everywhere else.
  if (!(error instanceof AppError)) {
    next(error);
    return;
  }
  // The coordinator answers 401 to an actor it does not know. Here that is a
  // participant problem, and a 401 would tell the page this device is unpaired.
  const refusal = error.statusCode === 401 ? notJoined() : error;
  const status = refusal.statusCode;
  const reason = reasonOf(refusal);
  const worded = refusal instanceof CollabRefused;
  // What the person is not told is in the log: a failure group work did not word.
  if (status >= 500 && !worded)
    log.error("Request failed", {
      method: req.method,
      path: req.baseUrl + req.path,
      status,
      error: redact(error.message),
    });
  const body: CollabRefusal = {
    ...(reason === undefined ? {} : { reason }),
    error: worded ? refusal.message : sentence(status, reason),
  };
  if (worded) {
    const details = refusal.details ?? {};
    for (const field of forwarded)
      if (Object.hasOwn(details, field)) Object.assign(body, { [field]: details[field] });
  }
  res.status(status).json(body);
};
