/**
 * Learn by hand: the guide's turns (DESIGN v1.2 F6-F8). STUB with final
 * signatures: W2B fills the bodies (and server/prompts/by-hand.ts); until
 * then each throws 501 `m.byHand.notYet`. The façade in server/by-hand.ts
 * has already refused a run that is not Learn by hand.
 *
 * Every turn is read-only and isolated, filtered (F7) before it is stored,
 * recorded through `recordHelp` (server/by-hand-record.ts), checked with
 * `helpAllowed` before it starts in a fitted run (409
 * `m.byHand.helpOutsideFit`), one guide turn per run at a time (409
 * `m.byHand.busy`), and registered in `ctx.byHandJobs` with its
 * AbortController in `ctx.controllers` under the same key (`guide:<id>`,
 * `review:<id>`), so Stop, cancel() and shutdown() abort it.
 *
 * - `guide(ctx, id, input)`: POST …/by-hand/guide (202): an ask by entry,
 *   a hint rung R1-R4 behind the attempt gate (`attemptSince`,
 *   `nextRungAllowed`; 409 `m.byHand.attemptFirst`), or "Explain this
 *   failure" (kind `test`). Resolves once the job is queued.
 * - `planQuestions(ctx, id)`: POST …/by-hand/plan/questions (202): one turn
 *   that sees the person's plan, never the outline; at most 3 per run.
 * - `review(ctx, run, input, signal)`: the structured review at Ready
 *   (F8), through `runIndependentReview` with the Learn-by-hand prompts
 *   and the reviewer schema; started by `ready()` in server/by-hand.ts.
 * - `chat(ctx, run, filePath, question, signal)`: after Ready, the
 *   per-file Ask tab's answer in a Learn-by-hand run (the guide's ask
 *   builder and the filter instead of the mentor prompt); returns the
 *   stored answer text.
 */
import type { ByHandGuideInput } from "../shared/by-hand.js";
import { AppError, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

const notYet = () => new AppError((m) => m.byHand.notYet, 501);

/** POST /api/runs/:id/by-hand/guide (202). */
export async function guide(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandGuideInput,
): Promise<{ run: Run }> {
  void [ctx, id, input];
  throw notYet();
}

/** POST /api/runs/:id/by-hand/plan/questions (202). */
export async function planQuestions(ctx: WorkbenchContext, id: string): Promise<{ run: Run }> {
  void [ctx, id];
  throw notYet();
}

/** The structured review at Ready (F8); `ready()` runs it as the job `review:<id>`. */
export async function review(
  ctx: WorkbenchContext,
  run: Run,
  input: { leastSure?: string },
  signal: AbortSignal,
): Promise<void> {
  void [ctx, run, input, signal];
  throw notYet();
}

/** The per-file Ask tab's answer in a Learn-by-hand run, after Ready (F6). */
export async function chat(
  ctx: WorkbenchContext,
  run: Run,
  filePath: string,
  question: string,
  signal: AbortSignal,
): Promise<string> {
  void [ctx, run, filePath, question, signal];
  throw notYet();
}
