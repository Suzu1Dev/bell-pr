import { buildLearningExport } from "../shared/learning-export.js";
import type { Repository, Run } from "./types.js";

/** The Markdown learning record for one run; see shared/learning-export.ts. */
export function learningExport(run: Run, repo?: Repository): string {
  return buildLearningExport(run, repo);
}
