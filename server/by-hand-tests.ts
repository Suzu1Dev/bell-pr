/**
 * Learn by hand: the test command the person confirmed and BELL's runs of
 * it, as the person (DESIGN v1.2 F9). STUB with final signatures: W2C
 * fills the bodies (and server/test-command.ts); until then each throws
 * 501 `m.byHand.notYet`. The façade in server/by-hand.ts has already
 * refused a run that is not Learn by hand.
 *
 * Only a command confirmed in its own request runs, only on a click,
 * never automatically, with the secret variables stripped by pattern and
 * the process group killed on Stop, timeout and shutdown; one test job per
 * run, registered in `ctx.byHandJobs` and `ctx.controllers` as
 * `tests:<id>`.
 *
 * - `testCommand(ctx, id)`: GET …/by-hand/test-command, the suggestion and
 *   the confirmed command.
 * - `confirmTestCommand(ctx, repoId, input)`: PUT /api/repos/:id/test-command,
 *   stores `Repository.testCommand`; any change is a new confirmation.
 * - `runTests(ctx, id, input)`: POST …/by-hand/tests (202), with the
 *   person's prediction.
 * - `liveTests(ctx, id)`: GET …/by-hand/tests/live, the running job's tail.
 * - `stopTests(ctx, id)`: POST …/by-hand/tests/stop.
 * - `reportTests(ctx, id, input)`: POST …/by-hand/tests/report, a result
 *   from the person's own terminal, marked as reported.
 */
import type {
  ByHandTestInput,
  ByHandTestReportInput,
  LiveTests,
  TestCommandInput,
  TestCommandView,
} from "../shared/by-hand.js";
import { AppError, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

const notYet = () => new AppError((m) => m.byHand.notYet, 501);

/** GET /api/runs/:id/by-hand/test-command */
export async function testCommand(ctx: WorkbenchContext, id: string): Promise<TestCommandView> {
  void [ctx, id];
  throw notYet();
}

/** PUT /api/repos/:id/test-command */
export async function confirmTestCommand(
  ctx: WorkbenchContext,
  repoId: string,
  input: TestCommandInput,
): Promise<{ repo: Repository }> {
  void [ctx, repoId, input];
  throw notYet();
}

/** POST /api/runs/:id/by-hand/tests (202) */
export async function runTests(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandTestInput,
): Promise<{ run: Run }> {
  void [ctx, id, input];
  throw notYet();
}

/** GET /api/runs/:id/by-hand/tests/live */
export async function liveTests(ctx: WorkbenchContext, id: string): Promise<LiveTests> {
  void [ctx, id];
  throw notYet();
}

/** POST /api/runs/:id/by-hand/tests/stop */
export async function stopTests(ctx: WorkbenchContext, id: string): Promise<{ run: Run }> {
  void [ctx, id];
  throw notYet();
}

/** POST /api/runs/:id/by-hand/tests/report */
export async function reportTests(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandTestReportInput,
): Promise<{ run: Run }> {
  void [ctx, id, input];
  throw notYet();
}
