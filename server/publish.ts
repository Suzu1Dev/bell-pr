/**
 * The human review gate and publishing: the PR draft, per-file review,
 * approval, and publishing exactly the reviewed files as one commit in a
 * GitHub Draft PR, or a follow-up round as one more commit on the PR's
 * branch. Nothing reaches GitHub without that approval.
 */
import path from "node:path";
import { command, git, redact } from "./process.js";
import { parseGitHubSource, readDiff, reviewFingerprint } from "./git.js";
import { validBranchName } from "../shared/drafts.js";
import {
  draftPreflight,
  findDraftPlaceholders,
} from "../shared/draft-checks.js";
import { activeFollowUp, type FollowUpRound } from "../shared/followups.js";
import { AppError, type DiffFile, type Run } from "./types.js";
import { networkConfig } from "./repositories.js";
import { assertRemoteHead, prHasCommit, remoteBranchHead } from "./pr-branch.js";
import { assertConflictsResolved, partlyPublished } from "./sync-runs.js";
import type { WorkbenchContext } from "./workbench.js";
import { currentLocale } from "./i18n/index.js";

const now = () => new Date().toISOString();

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
    if (
      activeFollowUp(run.followUps) &&
      (draft.title !== run.draft.title || draft.body !== run.draft.body)
    )
      throw new AppError(
        "這輪修正只推送新的 commit，PR 標題與說明維持原樣，不能在這裡修改。",
        409,
      );
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
    await assertConflictsResolved(run);
    // A follow-up round pushes only a commit, so its message is what goes out.
    const round = activeFollowUp(run.followUps);
    if (round) {
      const message = run.draft.commitMessage?.trim();
      if (!message || findDraftPlaceholders(message).length)
        throw new AppError(
          "請填好這輪修正的提交訊息，不要留下待填寫的內容。",
          422,
        );
      const unreviewable = await unreviewableRoundPaths(run, round, files);
      if (unreviewable.length) throw unreviewableError(unreviewable);
    } else {
      // The checks explain themselves in the request's locale; the
      // acknowledgements below match their ids, never their text.
      const unfinished = draftPreflight(
        { body: run.draft.body },
        currentLocale(),
      ).find((check) => check.kind === "block");
      if (unfinished)
        throw new AppError(
          [unfinished.message, ...unfinished.details].join("\n"),
          422,
        );
    }
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
    const round = activeFollowUp(run.followUps);
    if (round) return publishFollowUp(ctx, run, round, files);
    if (run.prUrl)
      throw new AppError(
        "這個 PR 已經送出；要推送新的修改，請從維護者回饋開始一輪修正。",
        409,
      );
    await assertConflictsResolved(run);
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
    const checks = draftPreflight(
      {
        body: run.draft.body,
        sources: run.draftPreparation?.context?.sources,
        proposalBody: run.draftPreparation?.proposal?.body,
      },
      currentLocale(),
    );
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
          run.publishCommit
            ? `目標分支已有新提交；${partlyPublished}`
            : "目標分支已有新提交；請先在 PR 草稿頁按「同步到最新目標分支」，審閱後再送出。",
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

      const tree = await reviewedTree(ctx, run, files);
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

/**
 * Paths whose pushed content a round changed but the review list cannot
 * show: a file put back to its base version or deleted drops out of the
 * diff against the base, yet it would change the pushed commit.
 */
async function unreviewableRoundPaths(
  run: Run,
  round: FollowUpRound,
  files: DiffFile[],
  tree?: string,
) {
  // A sync round's tree is the target branch plus the reviewed files.
  const base = round.mergeParent ?? round.parentCommit;
  const changed = (
    await git(
      run.worktreePath,
      tree
        ? ["diff-tree", "-r", "--no-renames", "--name-only", "-z", base, tree]
        : ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", base, "--"],
    )
  ).stdout
    .split("\0")
    .filter(Boolean);
  const listed = new Set(files.map((file) => file.path));
  return changed.filter((filePath) => !listed.has(filePath));
}

function unreviewableError(paths: string[]) {
  return new AppError(
    `這輪修正把已推送的檔案改回原始版本或刪除：${paths.slice(0, 10).join("、")}。這類修改無法在 BELL 逐檔審閱，因此不會推送；請還原這些檔案或放棄這輪修正。`,
    409,
  );
}

/**
 * Pushes an approved follow-up round as one commit on top of the PR head.
 * The PR title and description are left alone, and nothing is force-pushed:
 * GitHub's branch is checked before a commit is made, and the push itself
 * is a plain fast-forward. The caller holds the run lock.
 */
async function publishFollowUp(
  ctx: WorkbenchContext,
  run: Run,
  round: FollowUpRound,
  files: DiffFile[],
) {
  const message = run.draft.commitMessage?.trim();
  if (!message) throw new AppError("請填寫這輪修正的提交訊息。", 422);
  await assertConflictsResolved(run);
  if (findDraftPlaceholders(message).length)
    throw new AppError("提交訊息還有待填寫的內容，請改好再推送。", 422);
  if (!run.prUrl || !run.headRepository)
    throw new AppError("找不到這個 PR 的推送位置，無法推送修正。", 409);
  const branch = run.publishedBranch ?? run.branch;
  const roundNumber = (run.followUps?.indexOf(round) ?? 0) + 1;
  const finish = (commit: string) => {
    round.status = "published";
    round.publishedAt = now();
    run.publishCommit = commit;
    run.status = "published";
    ctx.log(
      run,
      "system",
      `已把第 ${roundNumber} 輪修正推送到 PR 分支 ${branch}（${commit.slice(0, 7)}）。`,
    );
  };
  run.publishing = true;
  delete run.error;
  await ctx.store.save();
  try {
    const head = (
      await git(run.worktreePath, ["symbolic-ref", "--short", "HEAD"])
    ).stdout.trim();
    if (head !== run.branch)
      throw new AppError("工作分支已改變，已停止推送。", 409);
    const previousHead = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    if (previousHead !== round.parentCommit && previousHead !== round.commit)
      throw new AppError("工作分支的提交已改變，已停止推送。", 409);
    // A retry after the push landed but before BELL recorded it, also when
    // the branch moved on or the PR was merged since.
    if (round.commit && (await prHasCommit(ctx, run, round.commit))) {
      finish(round.commit);
      return run;
    }
    const remoteHead = await remoteBranchHead(run);
    // Checked before anything local changes, so a refusal leaves the round discardable.
    assertRemoteHead(run, remoteHead, round.parentCommit);
    const state = (
      await command("gh", [
        "pr",
        "view",
        run.prUrl,
        "--json",
        "state",
        "--jq",
        ".state",
      ])
    ).stdout.trim();
    if (state !== "OPEN")
      throw new AppError(
        `這個 PR 已${state === "MERGED" ? "合併" : "關閉"}，不能再推送修正。`,
        409,
      );
    const tree = await reviewedTree(ctx, run, files);
    const parentTree = (
      await git(run.worktreePath, ["rev-parse", `${round.parentCommit}^{tree}`])
    ).stdout.trim();
    if (tree === parentTree)
      throw new AppError(
        "這輪沒有新的修改可以推送；可以放棄這輪修正。",
        422,
      );
    const unreviewable = await unreviewableRoundPaths(run, round, files, tree);
    if (unreviewable.length) throw unreviewableError(unreviewable);
    let commit = round.commit;
    if (commit) {
      // A retry after the commit was made: it must be the same reviewed content.
      const [priorTree, priorParents, priorMessage] = await Promise.all([
        git(run.worktreePath, ["rev-parse", `${commit}^{tree}`]),
        git(run.worktreePath, ["rev-list", "--parents", "-n", "1", commit]),
        git(run.worktreePath, ["log", "-1", "--format=%B", commit]),
      ]);
      if (
        priorTree.stdout.trim() !== tree ||
        priorParents.stdout.trim().split(/\s+/).slice(1).join(" ") !==
          [round.parentCommit, round.mergeParent].filter(Boolean).join(" ") ||
        priorMessage.stdout.trim() !== message
      )
        throw new AppError(
          "這輪修正先前已建立不同內容的 commit；請還原修改與提交訊息後再推送，或放棄這輪修正。",
          409,
        );
    } else {
      commit = (
        await git(
          run.worktreePath,
          [
            "commit-tree",
            tree,
            "-p",
            round.parentCommit,
            ...(round.mergeParent ? ["-p", round.mergeParent] : []),
          ],
          { input: `${message}\n` },
        )
      ).stdout.trim();
    }
    // Recorded before the branch moves, so an interruption from here on can
    // be retried (HEAD may be the parent or this commit) or discarded.
    round.commit = commit;
    await ctx.store.save();
    if (previousHead !== commit)
      await git(run.worktreePath, [
        "update-ref",
        `refs/heads/${run.branch}`,
        commit,
        previousHead,
      ]);
    await git(run.worktreePath, ["read-tree", commit]);
    // A plain push: GitHub rejects it if the branch moved since the check above.
    await git(
      run.worktreePath,
      [
        ...networkConfig,
        "push",
        "--",
        `https://github.com/${run.headRepository}.git`,
        `${commit}:refs/heads/${branch}`,
      ],
      { timeoutMs: 120_000 },
    );
    finish(commit);
  } catch (error) {
    run.error = redact(error instanceof Error ? error.message : "推送失敗。");
    ctx.log(run, "system", run.error);
    throw error;
  } finally {
    run.publishing = false;
    await ctx.store.save();
  }
  return run;
}

/**
 * Builds a fresh index from the reviewed base and stages only the reviewed
 * paths, checking each staged patch against what the person approved.
 * commit-tree then produces one clean commit, excluding any unreviewed
 * intermediate agent history.
 */
async function reviewedTree(
  ctx: WorkbenchContext,
  run: Run,
  files: DiffFile[],
) {
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
  return (
    await git(run.worktreePath, ["write-tree"], { env: indexEnv })
  ).stdout.trim();
}
