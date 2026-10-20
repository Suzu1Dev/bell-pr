/**
 * Learn by hand on the server (DESIGN v1.2 F1-F5, F11): the run's flow,
 * and the façade the routes call (`Workbench.byHand`).
 *
 * The flow functions are STUBS with final signatures: W2A fills them; until
 * then each throws 501 `m.byHand.notYet`, and `planByHand` makes a new
 * Learn-by-hand run fail with that message. The façade at the end of this
 * module is W1A's and final: every member refuses a run that is not Learn
 * by hand (409 `m.byHand.notByHand`) before it calls the flow, the guide
 * (server/by-hand-guide.ts, W2B) or the test runner
 * (server/by-hand-tests.ts, W2C). No member is gated by plan.
 *
 * - `planByHand(ctx, run, locale, signal)`: executeRun's Learn-by-hand
 *   branch, after the worktree and team checks: the read-only orientation
 *   turn (F3), its filtered outline in `byHand.guidePlan`, `team.tasks`
 *   kept empty, the premise and its help event, then `awaiting_plan`.
 *   Never a write turn (the guard in runAgent refuses one).
 * - `savePlan`, `revealOutline`, `updateStep`, `checkIn`, `leave`: the
 *   person's plan, the outline reveals (`plan` help, refused outside a
 *   fitted run's help set), step state and the R3 choice, the stuck card,
 *   and handing the task to the agent team.
 * - `ready(ctx, id, input)`: Ready for review at the current fingerprint
 *   (409 when stale; a second review needs a test run at this version,
 *   409 `m.byHand.testFirst`), and the review job `review:<id>` when asked.
 * - `template(ctx, id)`: the project's PR templates, verbatim.
 */
import type {
  ByHandCheckInInput,
  ByHandGuideInput,
  ByHandPlanInput,
  ByHandReadyInput,
  ByHandRevealInput,
  ByHandStepInput,
  ByHandTemplate,
  ByHandTestInput,
  ByHandTestReportInput,
  LiveTests,
  TestCommandInput,
  TestCommandView,
} from "../shared/by-hand.js";
import type { Locale } from "../shared/i18n/locale.js";
import * as guide from "./by-hand-guide.js";
import * as tests from "./by-hand-tests.js";
import { AppError, type Repository, type Run } from "./types.js";
import type { WorkbenchContext } from "./workbench.js";

const notYet = () => new AppError((m) => m.byHand.notYet, 501);

/** executeRun's Learn-by-hand branch: the orientation turn and the outline (F3). */
export async function planByHand(
  ctx: WorkbenchContext,
  run: Run,
  locale: Locale,
  signal: AbortSignal,
): Promise<void> {
  void [ctx, run, locale, signal];
  throw notYet();
}

/** PUT /api/runs/:id/by-hand/plan */
export async function savePlan(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandPlanInput,
): Promise<{ run: Run }> {
  void [ctx, id, input];
  throw notYet();
}

/** POST /api/runs/:id/by-hand/plan/reveal */
export async function revealOutline(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandRevealInput,
): Promise<{ run: Run }> {
  void [ctx, id, input];
  throw notYet();
}

/** PATCH /api/runs/:id/by-hand/steps/:stepId */
export async function updateStep(
  ctx: WorkbenchContext,
  id: string,
  stepId: string,
  input: ByHandStepInput,
): Promise<{ run: Run }> {
  void [ctx, id, stepId, input];
  throw notYet();
}

/** POST /api/runs/:id/by-hand/check-ins */
export async function checkIn(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandCheckInInput,
): Promise<{ run: Run }> {
  void [ctx, id, input];
  throw notYet();
}

/** POST /api/runs/:id/by-hand/ready */
export async function ready(
  ctx: WorkbenchContext,
  id: string,
  input: ByHandReadyInput,
): Promise<{ run: Run }> {
  void [ctx, id, input];
  throw notYet();
}

/** POST /api/runs/:id/by-hand/leave */
export async function leave(ctx: WorkbenchContext, id: string): Promise<{ run: Run }> {
  void [ctx, id];
  throw notYet();
}

/** GET /api/runs/:id/by-hand/template */
export async function template(
  ctx: WorkbenchContext,
  id: string,
): Promise<{ templates: ByHandTemplate[] }> {
  void [ctx, id];
  throw notYet();
}

/** What the routes call (server/routes/by-hand.ts): `Workbench.byHand`. */
export interface ByHandFacade {
  savePlan(id: string, input: ByHandPlanInput): Promise<{ run: Run }>;
  revealOutline(id: string, input: ByHandRevealInput): Promise<{ run: Run }>;
  planQuestions(id: string): Promise<{ run: Run }>;
  updateStep(id: string, stepId: string, input: ByHandStepInput): Promise<{ run: Run }>;
  guide(id: string, input: ByHandGuideInput): Promise<{ run: Run }>;
  checkIn(id: string, input: ByHandCheckInInput): Promise<{ run: Run }>;
  testCommand(id: string): Promise<TestCommandView>;
  /** The project's test command; for any project, before or without a run. */
  confirmTestCommand(repoId: string, input: TestCommandInput): Promise<{ repo: Repository }>;
  runTests(id: string, input: ByHandTestInput): Promise<{ run: Run }>;
  liveTests(id: string): Promise<LiveTests>;
  stopTests(id: string): Promise<{ run: Run }>;
  reportTests(id: string, input: ByHandTestReportInput): Promise<{ run: Run }>;
  ready(id: string, input: ByHandReadyInput): Promise<{ run: Run }>;
  leave(id: string): Promise<{ run: Run }>;
  template(id: string): Promise<{ templates: ByHandTemplate[] }>;
}

/** The façade (W1A, final): a Learn-by-hand run, else 409, then the work. */
export function byHandFacade(ctx: WorkbenchContext): ByHandFacade {
  const byHandRun = (id: string) => {
    if (!ctx.run(id).learnByHand) throw new AppError((m) => m.byHand.notByHand, 409);
  };
  return {
    async savePlan(id, input) {
      byHandRun(id);
      return savePlan(ctx, id, input);
    },
    async revealOutline(id, input) {
      byHandRun(id);
      return revealOutline(ctx, id, input);
    },
    async planQuestions(id) {
      byHandRun(id);
      return guide.planQuestions(ctx, id);
    },
    async updateStep(id, stepId, input) {
      byHandRun(id);
      return updateStep(ctx, id, stepId, input);
    },
    async guide(id, input) {
      byHandRun(id);
      return guide.guide(ctx, id, input);
    },
    async checkIn(id, input) {
      byHandRun(id);
      return checkIn(ctx, id, input);
    },
    async testCommand(id) {
      byHandRun(id);
      return tests.testCommand(ctx, id);
    },
    async confirmTestCommand(repoId, input) {
      ctx.repo(repoId);
      return tests.confirmTestCommand(ctx, repoId, input);
    },
    async runTests(id, input) {
      byHandRun(id);
      return tests.runTests(ctx, id, input);
    },
    async liveTests(id) {
      byHandRun(id);
      return tests.liveTests(ctx, id);
    },
    async stopTests(id) {
      byHandRun(id);
      return tests.stopTests(ctx, id);
    },
    async reportTests(id, input) {
      byHandRun(id);
      return tests.reportTests(ctx, id, input);
    },
    async ready(id, input) {
      byHandRun(id);
      return ready(ctx, id, input);
    },
    async leave(id) {
      byHandRun(id);
      return leave(ctx, id);
    },
    async template(id) {
      byHandRun(id);
      return template(ctx, id);
    },
  };
}
