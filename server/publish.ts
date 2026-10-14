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
import { assertConflictsResolved } from "./sync-runs.js";
import type { WorkbenchContext } from "./workbench.js";
import { currentLocale, sm } from "./i18n/index.js";

const now = () => new Date().toISOString();

const json = <T>(value: string) => JSON.parse(value) as T;

/** The draft, file reviews and approval change only in review or approved, never while publishing. */
export function editable(run: Run) {
  if (!["review", "approved"].includes(run.status) || run.publishing)
    throw new AppError((m) => m.run.publish.notEditable, 409);
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
      throw new AppError((m) => m.run.publish.roundKeepsPrText, 409);
    // An empty message is stored as absent so the title-only fallback applies.
    const commitMessage = draft.commitMessage?.trim();
    // Likewise an empty GitHub branch falls back to the run's own branch.
    const publishBranch = draft.publishBranch?.trim();
    if (publishBranch && !validBranchName(publishBranch))
      throw new AppError((m) => m.run.publish.invalidBranch, 422);
    // Pushing the reviewed commit to the target branch would skip the PR entirely.
    if (publishBranch?.toLowerCase() === run.baseBranch.toLowerCase())
      throw new AppError(
        (m) => m.run.publish.branchIsTarget({ branch: run.baseBranch }),
        422,
      );
    // After a push, another branch would let a retry open a second PR.
    if (
      run.publishedBranch &&
      (publishBranch || run.branch) !== run.publishedBranch
    )
      throw new AppError(
        (m) => m.run.publish.branchLocked({ branch: run.publishedBranch! }),
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
    if (!file) throw new AppError((m) => m.run.review.fileNotFound, 404);
    if (file.fingerprint !== displayedFingerprint)
      throw new AppError((m) => m.run.publish.fileChanged, 409);
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
      throw new AppError((m) => m.run.publish.draftChanged, 409);
    const files = await ctx.diff(id);
    if (
      !files.length ||
      files.some(
        (file) =>
          file.blocked ||
          run.reviewedFingerprints[file.path] !== file.fingerprint,
      )
    ) {
      throw new AppError((m) => m.run.publish.reviewAllFirst, 409);
    }
    if (!run.draft.title.trim() || !run.draft.body.trim())
      throw new AppError((m) => m.run.publish.prTextRequired, 422);
    await assertConflictsResolved(run);
    // A follow-up round pushes only a commit, so its message is what goes out.
    const round = activeFollowUp(run.followUps);
    if (round) {
      const message = run.draft.commitMessage?.trim();
      if (!message || findDraftPlaceholders(message).length)
        throw new AppError((m) => m.run.publish.roundMessageRequired, 422);
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
      throw new AppError((m) => m.run.publish.approvalStale, 409);
    if (run.status === "published") return run;
    const repo = ctx.repo(run.repoId);
    if (run.status !== "approved" || !run.approvedFingerprint)
      throw new AppError((m) => m.run.publish.approveFirst, 409);
    if (!repo.url || !parseGitHubSource(repo.url))
      throw new AppError((m) => m.run.publish.noGithubOrigin, 422);
    const files = await ctx.diff(id);
    if (
      run.status !== "approved" ||
      run.approvedFingerprint !== reviewFingerprint(files, run.draft)
    )
      throw new AppError((m) => m.run.publish.diffChanged, 409);
    if (
      files.some(
        (file) =>
          file.blocked ||
          run.reviewedFingerprints[file.path] !== file.fingerprint,
      )
    )
      throw new AppError((m) => m.run.publish.notAllReviewed, 409);
    const round = activeFollowUp(run.followUps);
    if (round) return publishFollowUp(ctx, run, round, files);
    if (run.prUrl)
      throw new AppError((m) => m.run.publish.prAlreadySent, 409);
    await assertConflictsResolved(run);
    const headBranch = run.draft.publishBranch || run.branch;
    if (
      run.draft.publishBranch &&
      headBranch.toLowerCase() === run.baseBranch.toLowerCase()
    )
      throw new AppError(
        (m) =>
          m.run.publish.branchIsTargetReapprove({ branch: run.baseBranch }),
        422,
      );
    if (run.publishedBranch && run.publishedBranch !== headBranch)
      throw new AppError(
        (m) =>
          m.run.publish.branchLockedPublish({ branch: run.publishedBranch! }),
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
        (m) =>
          m.run.publish.confirmFirst({
            items: unconfirmed.map((check) => check.message),
          }),
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
        throw new AppError((m) => m.run.publish.githubUserInvalid, 422);
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
        throw new AppError((m) => m.run.publish.defaultBranchChanged, 409);
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
          (m) =>
            run.publishCommit
              ? m.run.publish.targetMovedAfterCommit
              : m.run.publish.targetMoved,
          409,
        );
      const head = (
        await git(run.worktreePath, ["symbolic-ref", "--short", "HEAD"])
      ).stdout.trim();
      if (head !== run.branch)
        throw new AppError((m) => m.run.publish.branchChanged, 409);
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
          throw new AppError((m) => m.run.publish.priorCommitDiffers, 409);
        const priorMessage = (
          await git(run.worktreePath, ["log", "-1", "--format=%B", commit])
        ).stdout.trim();
        if (priorMessage !== (run.draft.commitMessage?.trim() || run.draft.title))
          throw new AppError((m) => m.run.publish.priorMessageDiffers, 409);
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
          throw new AppError((m) => m.run.publish.notAFork, 409);
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
        throw new AppError((m) => m.run.publish.noPrUrl, 502);
      run.prUrl = prUrl;
      run.status = "published";
      ctx.log(run, "system", sm().run.publish.prCreated);
    } catch (error) {
      run.error = redact(
        error instanceof Error ? error.message : sm().run.publish.failed,
      );
      if (run.publishCommit)
        run.error = sm().run.publish.failedAfterPush({ error: run.error });
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
    (m) => m.run.publish.roundReverts({ files: paths.slice(0, 10) }),
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
  if (!message)
    throw new AppError((m) => m.run.publish.roundMessageMissing, 422);
  await assertConflictsResolved(run);
  if (findDraftPlaceholders(message).length)
    throw new AppError((m) => m.run.publish.roundMessagePlaceholders, 422);
  if (!run.prUrl || !run.headRepository)
    throw new AppError((m) => m.run.publish.roundNoPushTarget, 409);
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
      sm().run.publish.roundPushed({
        round: roundNumber,
        branch,
        commit: commit.slice(0, 7),
      }),
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
      throw new AppError((m) => m.run.publish.branchChangedPush, 409);
    const previousHead = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    if (previousHead !== round.parentCommit && previousHead !== round.commit)
      throw new AppError((m) => m.run.publish.commitChangedPush, 409);
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
        (m) =>
          state === "MERGED" ? m.run.publish.prMerged : m.run.publish.prClosed,
        409,
      );
    const tree = await reviewedTree(ctx, run, files);
    const parentTree = (
      await git(run.worktreePath, ["rev-parse", `${round.parentCommit}^{tree}`])
    ).stdout.trim();
    if (tree === parentTree)
      throw new AppError((m) => m.run.publish.roundEmpty, 422);
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
        throw new AppError((m) => m.run.publish.roundCommitDiffers, 409);
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
    run.error = redact(
      error instanceof Error ? error.message : sm().run.publish.pushFailed,
    );
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
    throw new AppError((m) => m.run.publish.stagedFilesDiffer, 409);
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
        (m) => m.run.publish.fileChangedWhileStaging({ path: file.path }),
        409,
      );
  }
  const latest = await readDiff(run);
  if (reviewFingerprint(latest, run.draft) !== run.approvedFingerprint)
    throw new AppError((m) => m.run.publish.filesChangedWhilePublishing, 409);
  return (
    await git(run.worktreePath, ["write-tree"], { env: indexEnv })
  ).stdout.trim();
}
