/**
 * The human review gate and publishing: the PR draft, per-file review,
 * approval, and publishing exactly the reviewed files as one commit in a
 * GitHub Draft PR. Nothing reaches GitHub without that approval.
 */
import path from "node:path";
import { command, git, redact } from "./process.js";
import { parseGitHubSource, readDiff, reviewFingerprint } from "./git.js";
import { validBranchName } from "../shared/drafts.js";
import { draftPreflight } from "../shared/draft-checks.js";
import { AppError, type Run } from "./types.js";
import { networkConfig } from "./repositories.js";
import type { WorkbenchContext } from "./workbench.js";

const json = <T>(value: string) => JSON.parse(value) as T;

/** The draft, file reviews and approval change only in review or approved, never while publishing. */
export function editable(run: Run) {
  if (!["review", "approved"].includes(run.status) || run.publishing)
    throw new AppError("請等待工作完成後再審閱與編輯。", 409);
}

export async function saveDraft(
  ctx: WorkbenchContext,
  id: string,
  draft: Run["draft"],
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    editable(run);
    // An empty message is stored as absent so the title-only fallback applies.
    const commitMessage = draft.commitMessage?.trim();
    // Likewise an empty GitHub branch falls back to the run's own branch.
    const publishBranch = draft.publishBranch?.trim();
    if (publishBranch && !validBranchName(publishBranch))
      throw new AppError(
        "GitHub 分支名稱只能用英數字與 . _ - /，不能有 ..，也不能以 . 或 .lock 結尾。",
        422,
      );
    // Pushing the reviewed commit to the target branch would skip the PR entirely.
    if (publishBranch?.toLowerCase() === run.baseBranch.toLowerCase())
      throw new AppError(
        `GitHub 分支不能是目標分支 ${run.baseBranch}，否則會直接推送到目標分支而不是建立 PR；請用新的分支名稱。`,
        422,
      );
    // After a push, another branch would let a retry open a second PR.
    if (
      run.publishedBranch &&
      (publishBranch || run.branch) !== run.publishedBranch
    )
      throw new AppError(
        `先前發佈已推送到 GitHub 分支 ${run.publishedBranch}，推送後不能改分支，以免重複建立 PR。請還原分支名稱，或建立新工作。`,
        409,
      );
    run.draft = {
      title: draft.title,
      body: draft.body,
      ...(commitMessage ? { commitMessage } : {}),
      ...(publishBranch ? { publishBranch } : {}),
    };
    run.status = "review";
    delete run.approvedFingerprint;
    await ctx.store.save();
    return run;
  });
}

export async function review(
  ctx: WorkbenchContext,
  id: string,
  filePath: string,
  reviewed: boolean,
  displayedFingerprint: string,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    editable(run);
    const files = await ctx.diff(id);
    const file = files.find((value) => value.path === filePath);
    if (!file) throw new AppError("找不到此差異檔案。", 404);
    if (file.fingerprint !== displayedFingerprint)
      throw new AppError(
        "檔案差異已更新；請重新載入並審閱最新內容，再標記為已審閱。",
        409,
      );
    if (file.blocked) throw new AppError(file.blocked, 422);
    if (reviewed) run.reviewedFingerprints[filePath] = file.fingerprint;
    else delete run.reviewedFingerprints[filePath];
    run.reviewedFiles = Object.keys(run.reviewedFingerprints);
    run.status = "review";
    delete run.approvedFingerprint;
    await ctx.store.save();
    return run;
  });
}

export async function approve(
  ctx: WorkbenchContext,
  id: string,
  displayedDraft: Run["draft"],
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    editable(run);
    if (
      displayedDraft.title !== run.draft.title ||
      displayedDraft.body !== run.draft.body ||
      (displayedDraft.commitMessage?.trim() ?? "") !==
        (run.draft.commitMessage ?? "") ||
      (displayedDraft.publishBranch?.trim() ?? "") !==
        (run.draft.publishBranch ?? "")
    )
      throw new AppError(
        "PR 草稿已更新；請重新載入並確認最新標題與內容，再重新核准。",
        409,
      );
    const files = await ctx.diff(id);
    if (
      !files.length ||
      files.some(
        (file) =>
          file.blocked ||
          run.reviewedFingerprints[file.path] !== file.fingerprint,
      )
    ) {
      throw new AppError("請先審閱所有最新差異，並移除被擋下的檔案。", 409);
    }
    if (!run.draft.title.trim() || !run.draft.body.trim())
      throw new AppError("請先填寫 PR 標題與內容。", 422);
    const unfinished = draftPreflight({ body: run.draft.body }).find(
      (check) => check.kind === "block",
    );
    if (unfinished)
      throw new AppError(
        [unfinished.message, ...unfinished.details].join("\n"),
        422,
      );
    run.approvedFingerprint = reviewFingerprint(files, run.draft);
    run.status = "approved";
    await ctx.store.save();
    return run;
  });
}

/**
 * `acknowledged` lists the preflight items the person confirmed in the
 * publish dialog. They are recomputed here from the saved draft, so a stale
 * or partial list is rejected before anything is pushed.
 */
export async function publish(
  ctx: WorkbenchContext,
  id: string,
  displayedFingerprint: string,
  acknowledged: string[] = [],
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (
      !run.approvedFingerprint ||
      displayedFingerprint !== run.approvedFingerprint
    )
      throw new AppError(
        "核准版本已更新或失效；請重新載入、審閱並核准，再送出 PR。",
        409,
      );
    if (run.status === "published") return run;
    const repo = ctx.repo(run.repoId);
    if (run.status !== "approved" || !run.approvedFingerprint)
      throw new AppError("請先完成審閱並核准 PR。", 409);
    if (!repo.url || !parseGitHubSource(repo.url))
      throw new AppError(
        "此 Repository 尚未連結 GitHub origin，無法發佈。",
        422,
      );
    const files = await ctx.diff(id);
    if (
      run.status !== "approved" ||
      run.approvedFingerprint !== reviewFingerprint(files, run.draft)
    )
      throw new AppError("差異已變更，請重新審閱與核准。", 409);
    if (
      files.some(
        (file) =>
          file.blocked ||
          run.reviewedFingerprints[file.path] !== file.fingerprint,
      )
    )
      throw new AppError("最新差異尚未全部審閱。", 409);
    const headBranch = run.draft.publishBranch || run.branch;
    if (
      run.draft.publishBranch &&
      headBranch.toLowerCase() === run.baseBranch.toLowerCase()
    )
      throw new AppError(
        `GitHub 分支不能是目標分支 ${run.baseBranch}；請修改分支名稱並重新核准。`,
        422,
      );
    if (run.publishedBranch && run.publishedBranch !== headBranch)
      throw new AppError(
        `先前發佈已推送到 GitHub 分支 ${run.publishedBranch}；請還原分支名稱，或建立新工作。`,
        409,
      );
    // Runs approved before these checks existed are held to them as well.
    const checks = draftPreflight({
      body: run.draft.body,
      sources: run.draftPreparation?.context?.sources,
      proposalBody: run.draftPreparation?.proposal?.body,
    });
    const blocking = checks.find((check) => check.kind === "block");
    if (blocking)
      throw new AppError(
        [blocking.message, ...blocking.details].join("\n"),
        422,
      );
    const unconfirmed = checks.filter(
      (check) => check.kind === "confirm" && !acknowledged.includes(check.id),
    );
    if (unconfirmed.length)
      throw new AppError(
        `送出前請在預覽視窗逐項確認：${unconfirmed.map((check) => check.message).join(" ")}`,
        422,
      );
    run.publishing = true;
    delete run.error;
    await ctx.store.save();
    try {
      const githubUser = (
        await command("gh", ["api", "user", "--jq", ".login"], {
          timeoutMs: 15_000,
        })
      ).stdout.trim();
      if (!/^[A-Za-z0-9-]+$/.test(githubUser))
        throw new AppError("GitHub 使用者資訊不正確。", 422);
      const metadata = json<{
        viewerPermission: string;
        defaultBranchRef: { name: string };
      }>(
        (
          await command("gh", [
            "repo",
            "view",
            repo.fullName,
            "--json",
            "viewerPermission,defaultBranchRef",
          ])
        ).stdout,
      );
      if (metadata.defaultBranchRef.name !== run.baseBranch)
        throw new AppError(
          "遠端預設分支已變更，請從最新分支建立新工作。",
          409,
        );
      const remoteSha = (
        await command("gh", [
          "api",
          `repos/${repo.fullName}/git/ref/heads/${encodeURIComponent(run.baseBranch)}`,
          "--jq",
          ".object.sha",
        ])
      ).stdout.trim();
      if (remoteSha !== run.baseSha)
        throw new AppError(
          "目標分支已有新提交，請從最新版本建立新工作再審閱。",
          409,
        );
      const head = (
        await git(run.worktreePath, ["symbolic-ref", "--short", "HEAD"])
      ).stdout.trim();
      if (head !== run.branch)
        throw new AppError("工作分支已改變，已停止發佈。", 409);
      const previousHead = (
        await git(run.worktreePath, ["rev-parse", "HEAD"])
      ).stdout.trim();
      await git(run.worktreePath, [
        "merge-base",
        "--is-ancestor",
        run.baseSha,
        previousHead,
      ]);

      // Build a fresh index from the reviewed base, then stage only explicitly reviewed paths.
      // commit-tree produces one clean commit, excluding any unreviewed intermediate agent history.
      const indexPath = path.join(
        ctx.store.directory,
        `publish-index-${run.id}`,
      );
      const indexEnv = {
        ...process.env,
        GIT_INDEX_FILE: indexPath,
        GIT_TERMINAL_PROMPT: "0",
      };
      await git(run.worktreePath, ["read-tree", run.baseSha], {
        env: indexEnv,
      });
      await git(
        run.worktreePath,
        [
          "--literal-pathspecs",
          "add",
          "--",
          ...files.map((file) => file.path),
        ],
        { env: indexEnv },
      );
      const stagedFiles = (
        await git(
          run.worktreePath,
          [
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--name-only",
            "-z",
            run.baseSha,
            "--",
          ],
          { env: indexEnv },
        )
      ).stdout
        .split("\0")
        .filter(Boolean)
        .sort();
      if (
        JSON.stringify(stagedFiles) !==
        JSON.stringify(files.map((file) => file.path).sort())
      )
        throw new AppError("準備提交的檔案與已核准差異不同。", 409);
      for (const file of files) {
        const stagedPatch = (
          await git(
            run.worktreePath,
            [
              "--literal-pathspecs",
              "diff",
              "--cached",
              "--no-ext-diff",
              "--no-textconv",
              "--no-renames",
              run.baseSha,
              "--",
              file.path,
            ],
            { env: indexEnv },
          )
        ).stdout;
        if (stagedPatch !== file.patch)
          throw new AppError(
            `${file.path} 在準備提交時變更，請重新審閱。`,
            409,
          );
      }
      const latest = await readDiff(run);
      if (reviewFingerprint(latest, run.draft) !== run.approvedFingerprint)
        throw new AppError("檔案在發佈準備期间變更，請重新審閱。", 409);
      const tree = (
        await git(run.worktreePath, ["write-tree"], { env: indexEnv })
      ).stdout.trim();
      let commit = run.publishCommit;
      if (commit) {
        const priorTree = (
          await git(run.worktreePath, ["rev-parse", `${commit}^{tree}`])
        ).stdout.trim();
        if (priorTree !== tree)
          throw new AppError(
            "先前發佈已建立不同的提交。請建立新工作，以避免覆寫可能已推送的分支。",
            409,
          );
        const priorMessage = (
          await git(run.worktreePath, ["log", "-1", "--format=%B", commit])
        ).stdout.trim();
        if (priorMessage !== (run.draft.commitMessage?.trim() || run.draft.title))
          throw new AppError(
            "先前發佈的提交已帶有不同的提交訊息，推送後無法更改。請還原提交訊息，或建立新工作。",
            409,
          );
      } else {
        commit = (
          await git(
            run.worktreePath,
            ["commit-tree", tree, "-p", run.baseSha],
            {
              // The person's full message (subject, body, their own trailers)
              // or, when none was written, the title alone as before.
              input:
                (run.draft.commitMessage?.trim() || run.draft.title) + "\n",
            },
          )
        ).stdout.trim();
      }
      await git(run.worktreePath, [
        "update-ref",
        `refs/heads/${run.branch}`,
        commit,
        previousHead,
      ]);
      await git(run.worktreePath, ["read-tree", commit]);
      run.publishCommit = commit;
      await ctx.store.save();

      let headRepository = repo.fullName;
      let headOwner = repo.owner;
      if (
        !["ADMIN", "MAINTAIN", "WRITE"].includes(metadata.viewerPermission)
      ) {
        await command(
          "gh",
          ["repo", "fork", repo.fullName, "--clone=false", "--remote=false"],
          { timeoutMs: 120_000 },
        );
        headRepository = `${githubUser}/${repo.name}`;
        const fork = json<{ parent?: { nameWithOwner: string } }>(
          (
            await command("gh", [
              "repo",
              "view",
              headRepository,
              "--json",
              "parent",
            ])
          ).stdout,
        );
        if (
          fork.parent?.nameWithOwner.toLowerCase() !==
          repo.fullName.toLowerCase()
        )
          throw new AppError(
            "同名 Repository 不是目標專案的 fork，請先處理 GitHub fork。",
            409,
          );
        headOwner = githubUser;
      }
      run.headRepository = headRepository;
      await ctx.store.save();
      await git(
        run.worktreePath,
        [
          ...networkConfig,
          "push",
          "--",
          `https://github.com/${headRepository}.git`,
          `${commit}:refs/heads/${headBranch}`,
        ],
        { timeoutMs: 120_000 },
      );
      run.publishedBranch = headBranch;
      await ctx.store.save();
      const headRef = `${headOwner}:${headBranch}`;
      const existing = json<{ url: string; headRefOid: string }[]>(
        (
          await command("gh", [
            "pr",
            "list",
            "--repo",
            repo.fullName,
            "--head",
            headRef,
            "--state",
            "open",
            "--json",
            "url,headRefOid",
          ])
        ).stdout,
      );
      let prUrl = existing.find((pr) => pr.headRefOid === commit)?.url;
      if (!prUrl) {
        const result = await command(
          "gh",
          [
            "pr",
            "create",
            "--repo",
            repo.fullName,
            "--base",
            run.baseBranch,
            "--head",
            headRef,
            "--draft",
            "--title",
            run.draft.title,
            "--body-file",
            "-",
          ],
          { input: run.draft.body, timeoutMs: 120_000 },
        );
        prUrl = result.stdout.match(
          /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/,
        )?.[0];
      }
      if (!prUrl)
        throw new AppError(
          "GitHub 未回傳 PR URL，請先到 GitHub 確认，避免重複發佈。",
          502,
        );
      run.prUrl = prUrl;
      run.status = "published";
      ctx.log(run, "system", "已建立 GitHub Draft PR。");
    } catch (error) {
      run.error = redact(
        error instanceof Error ? error.message : "發佈失敗。",
      );
      if (run.publishCommit)
        run.error +=
          " 若推送已完成，分支會保留在 GitHub；重試前請確認遠端狀態。";
      ctx.log(run, "system", run.error);
      throw error;
    } finally {
      run.publishing = false;
      await ctx.store.save();
    }
    return run;
  });
}
