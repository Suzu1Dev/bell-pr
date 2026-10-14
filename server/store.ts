import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./types.js";
import { activeFollowUp } from "../shared/followups.js";
import { sm } from "./i18n/index.js";

export class Store {
  data: Database = { version: 1, repos: [], runs: [] };
  private writes: Promise<void> = Promise.resolve();
  constructor(public directory: string) {}

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const statePath = path.join(this.directory, "state.json");
    try {
      const data = JSON.parse(await readFile(statePath, "utf8")) as Database;
      if (
        data.version !== 1 ||
        !Array.isArray(data.repos) ||
        !Array.isArray(data.runs)
      )
        throw new Error("Invalid state format");
      this.data = data;
    } catch (error) {
      // A missing file is a first start; anything else names the file (no auto-repair).
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          sm().run.recovery.unreadableState({
            path: statePath,
            reason: error instanceof Error ? error.message : String(error),
          }),
          { cause: error },
        );
    }
    for (const run of this.data.runs) {
      const recovery = sm().run.recovery;
      if (run.draftPreparation?.status === "generating") {
        run.draftPreparation.status = "failed";
        run.draftPreparation.error = recovery.draft;
      }
      for (const explanation of Object.values(run.explanations ?? {})) {
        if (explanation.status === "generating") {
          explanation.status = "failed";
          explanation.error = recovery.explanation;
        }
      }
      // A re-review interrupted by a crash leaves reviewer/tester agents "running" on a finished run.
      if (!["running", "queued"].includes(run.status) && !run.publishing) {
        for (const agent of run.agents)
          if (agent.status === "running") {
            agent.status = "failed";
            agent.detail = recovery.review;
          }
      }
      // An interrupted conflict resolution keeps its edits for review.
      if (run.sync?.resolving && run.status === "running") {
        run.sync.resolving = false;
        run.sync.report = recovery.conflicts;
        run.status = "review";
        for (const agent of run.agents)
          if (agent.status === "running") agent.status = "failed";
        continue;
      }
      // An interrupted follow-up round leaves the published PR intact: its
      // edits stay in the checkout for review, push or discard.
      const round = activeFollowUp(run.followUps);
      if (round?.resolving) {
        round.resolving = false;
        round.report = recovery.conflicts;
      }
      if (round && (run.status === "running" || run.publishing)) {
        if (round.status === "running") {
          round.status = "review";
          round.error = recovery.round;
          // Rounds saved before startFollowUp cleared it still hold the last pushed message.
          delete run.draft.commitMessage;
        }
        run.status = "review";
        run.publishing = false;
        delete run.approvedFingerprint;
        for (const agent of run.agents)
          if (agent.status === "running") agent.status = "failed";
        continue;
      }
      if (
        run.status === "running" ||
        run.status === "queued" ||
        run.publishing
      ) {
        run.status = "failed";
        run.publishing = false;
        run.error = recovery.run;
        for (const agent of run.agents)
          if (agent.status === "running") agent.status = "failed";
        if (run.team) {
          run.team.phase = "failed";
          for (const task of run.team.tasks)
            if (task.status === "running") {
              task.status = "failed";
              task.error = recovery.task;
            }
        }
      }
    }
    await this.save();
  }

  save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        const temporary = path.join(this.directory, "state.json.tmp");
        await writeFile(temporary, snapshot, { mode: 0o600 });
        await rename(temporary, path.join(this.directory, "state.json"));
      });
    return this.writes;
  }
}
