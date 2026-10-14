import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./types.js";
import { activeFollowUp } from "../shared/followups.js";

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
          `無法讀取 ${statePath}：${error instanceof Error ? error.message : String(error)}。請檢查檔案是否為有效 JSON（version 1）。`,
          { cause: error },
        );
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
      for (const walkthrough of Object.values(run.walkthroughs ?? {})) {
        if (walkthrough.status === "generating") {
          walkthrough.status = "failed";
          walkthrough.error = "服務重新啟動，程式碼解說已中斷；可重試。";
        }
      }
      // A re-review interrupted by a crash leaves reviewer/tester agents "running" on a finished run.
      if (!["running", "queued"].includes(run.status) && !run.publishing) {
        for (const agent of run.agents)
          if (agent.status === "running") {
            agent.status = "failed";
            agent.detail = "服務重新啟動，重新審查已中斷；原有報告保留";
          }
      }
      // An interrupted conflict resolution keeps its edits for review.
      if (run.sync?.resolving && run.status === "running") {
        run.sync.resolving = false;
        run.sync.report =
          "服務重新啟動，解衝突已中斷；已改的檔案保留，可以自行完成，或再請 Agent 處理。";
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
        round.report =
          "服務重新啟動，解衝突已中斷；已改的檔案保留，可以自行完成，或再請 Agent 處理。";
      }
      if (round && (run.status === "running" || run.publishing)) {
        if (round.status === "running") {
          round.status = "review";
          round.error =
            "服務重新啟動，這輪修正已中斷；工作目錄保留的修改可以審閱、寫好提交訊息後推送，或放棄這輪修正。";
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
        run.error =
          "服務重新啟動，先前工作已中斷。工作目錄仍保留，可檢視差異；團隊工作可在任務板重試失敗的子任務，已整合的子任務不會重跑。";
        for (const agent of run.agents)
          if (agent.status === "running") agent.status = "failed";
        if (run.team) {
          run.team.phase = "failed";
          for (const task of run.team.tasks)
            if (task.status === "running") {
              task.status = "failed";
              task.error =
                "服務重新啟動，任務已中斷；隔離工作目錄保留，重試時會以新快照重新開始。";
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
