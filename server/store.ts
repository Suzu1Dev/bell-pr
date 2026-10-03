import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./types.js";

export class Store {
  data: Database = { version: 1, repos: [], runs: [] };
  private writes: Promise<void> = Promise.resolve();
  constructor(public directory: string) {}

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(
        await readFile(path.join(this.directory, "state.json"), "utf8"),
      ) as Database;
      if (
        data.version !== 1 ||
        !Array.isArray(data.repos) ||
        !Array.isArray(data.runs)
      )
        throw new Error("Invalid state format");
      this.data = data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const run of this.data.runs) {
      if (run.draftPreparation?.status === "generating") {
        run.draftPreparation.status = "failed";
        run.draftPreparation.error =
          "服務重新啟動，PR 草稿建議已中斷；現有草稿保留，可重新產生。";
      }
      for (const explanation of Object.values(run.explanations ?? {})) {
        if (explanation.status === "generating") {
          explanation.status = "failed";
          explanation.error = "服務重新啟動，解說產生已中斷；可重試產生解說。";
        }
      }
      if (
        run.status === "running" ||
        run.status === "queued" ||
        run.publishing
      ) {
        run.status = "failed";
        run.publishing = false;
        run.error =
          "服務重新啟動，先前工作已中斷。工作目錄仍保留，可檢視差異並建立新工作。";
        for (const agent of run.agents)
          if (agent.status === "running") agent.status = "failed";
        if (run.team) {
          run.team.phase = "failed";
          for (const task of run.team.tasks)
            if (task.status === "running") {
              task.status = "failed";
              task.error = "服務重新啟動，任務已中斷；隔離工作目錄保留。";
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
