import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { readDiff } from "./git.js";
import { git } from "./process.js";
import { AppError, type Run } from "./types.js";
import { scopeContains } from "./team.js";
import type { TeamTask } from "../shared/team.js";

/** A temporary Git object captures integrated predecessors without advancing the review branch. */
export async function createTeamSnapshot(
  run: Run,
  directory: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new AppError("工作已取消。", 409);
  const files = await readDiff(run);
  if (signal?.aborted) throw new AppError("工作已取消。", 409);
  if (!files.length) return run.baseSha;
  if (files.some((file) => file.blocked))
    throw new AppError("整合快照含有無法審閱的檔案，已停止派工。", 422);
  const indexPath = path.join(directory, `team-index-${randomUUID()}`);
  const env = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_TERMINAL_PROMPT: "0",
  };
  try {
    await git(run.worktreePath, ["read-tree", run.baseSha], { env, signal });
    await git(
      run.worktreePath,
      ["--literal-pathspecs", "add", "--", ...files.map((file) => file.path)],
      { env, signal },
    );
    const tree = (
      await git(run.worktreePath, ["write-tree"], { env, signal })
    ).stdout.trim();
    return (
      await git(
        run.worktreePath,
        [
          "-c",
          "user.name=BELL PR",
          "-c",
          "user.email=bell-pr@localhost.invalid",
          "commit-tree",
          tree,
          "-p",
          run.baseSha,
        ],
        {
          env,
          signal,
          input: "BELL PR local team snapshot (unpublished)\n",
        },
      )
    ).stdout.trim();
  } finally {
    await rm(indexPath, { force: true });
    await rm(`${indexPath}.lock`, { force: true });
  }
}

/** Only a task's declared, reviewable changes may enter the human-review workspace. */
export async function integrateTeamTask(
  run: Run,
  task: TeamTask,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new AppError("工作已取消。", 409);
  if (!task.worktreePath || !task.baseSha)
    throw new AppError("任務缺少隔離工作目錄。", 422);
  const head = (
    await git(task.worktreePath, ["rev-parse", "HEAD"], { signal })
  ).stdout.trim();
  if (head !== task.baseSha)
    throw new AppError("Teammate 改動 Git 提交狀態，已停止整合。", 422);
  const files = await readDiff({
    worktreePath: task.worktreePath,
    baseSha: task.baseSha,
  });
  if (signal?.aborted) throw new AppError("工作已取消。", 409);
  for (const file of files) {
    if (!task.files.some((scope) => scopeContains(scope, file.path)))
      throw new AppError(
        `Teammate 修改了未分配的檔案 ${file.path}；差異保留在其隔離工作目錄，未整合。`,
        422,
      );
    if (
      file.blocked ||
      /^(?:old|new|new file|deleted file) mode 120000$/m.test(file.patch)
    )
      throw new AppError(
        `Teammate 的 ${file.path} 需要人工處理，未整合。`,
        422,
      );
  }
  if (!files.length) return 0;
  const patch = files.map((file) => file.patch).join("\n");
  await git(
    run.worktreePath,
    ["apply", "--check", "--whitespace=nowarn", "-"],
    { input: patch, signal },
  );
  await git(run.worktreePath, ["apply", "--whitespace=nowarn", "-"], {
    input: patch,
    signal,
  });
  return files.length;
}
